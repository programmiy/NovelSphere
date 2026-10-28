import 'dart:convert';
import 'dart:io';
import 'package:archive/archive.dart';
import 'package:http/http.dart' as http;
import 'package:network_info_plus/network_info_plus.dart';

import 'preferences_service.dart';
import 'local_db_service.dart';

enum SyncStatus {
  idle,
  checkingWifi,
  notInTrustedWifi,
  serverUnreachable,
  syncing,
  completed,
  failed,
}

class SyncResult {
  final bool success;
  final String message;
  final int updatedTranslations;
  final int updatedActivities;

  SyncResult({
    required this.success,
    required this.message,
    this.updatedTranslations = 0,
    this.updatedActivities = 0,
  });
}

class SyncService {
  static final NetworkInfo _networkInfo = NetworkInfo();

  /// 현재 연결된 Wi-Fi가 사용자가 지정한 2개의 신뢰 Wi-Fi 중 하나인지 확인
  static Future<bool> isConnectedToTrustedWifi() async {
    final wifi1 = PreferencesService.trustedWifi1.trim();
    final wifi2 = PreferencesService.trustedWifi2.trim();

    // 사용자가 등록한 신뢰 Wi-Fi가 없는 경우(미설정 시 기본 허용 또는 경고)
    if (wifi1.isEmpty && wifi2.isEmpty) {
      return true;
    }

    try {
      String? currentSsid = await _networkInfo.getWifiName();
      if (currentSsid != null && currentSsid.isNotEmpty && !currentSsid.contains('unknown')) {
        // 따옴표 제거 (Android/iOS에서 "SSID" 형태로 오는 경우 처리)
        currentSsid = currentSsid.replaceAll('"', '').trim();

        if (wifi1.isNotEmpty && currentSsid.toLowerCase() == wifi1.toLowerCase()) {
          return true;
        }
        if (wifi2.isNotEmpty && currentSsid.toLowerCase() == wifi2.toLowerCase()) {
          return true;
        }
      }
      // Android 위치 권한 미허용 등으로 SSID가 unknown인 경우, PC 서버와 직접 핑 가능 여부로 로컬 Wi-Fi 판별
      return await pingServer();
    } catch (e) {
      return await pingServer();
    }
  }

  /// PC 서버와의 연결 상태 확인 (Ping)
  static Future<bool> pingServer([String? customUrl]) async {
    final raw = customUrl ?? PreferencesService.serverUrl;
    final serverUrl = PreferencesService.normalizeServerUrl(raw);
    try {
      final res = await http.get(
        Uri.parse('$serverUrl/api/sync/ping'),
        headers: PreferencesService.authHeaders,
      ).timeout(const Duration(seconds: 4));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body);
        return data['status'] == 'online';
      }
    } catch (_) {}
    return false;
  }

  /// [최초 1회 전체 동기화] PC 서버에서 최적화 모바일 DB 시드를 다운받아 로컬 DB로 구축하고,
  /// 다운로드 확인 즉시 PC 서버의 임시 파일을 삭제 요청합니다. (사용자 코멘트 반영)
  static Future<SyncResult> downloadFullSeed({Function(double)? onProgress, bool ignoreWifiCheck = true}) async {
    if (!ignoreWifiCheck) {
      final isWifiAllowed = await isConnectedToTrustedWifi();
      if (!isWifiAllowed) {
        return SyncResult(
          success: false,
          message: '지정된 신뢰 Wi-Fi 환경이 아닙니다. 배터리 및 데이터 보호를 위해 동기화가 제한됩니다.',
        );
      }
    }

    final serverUrl = PreferencesService.normalizeServerUrl(PreferencesService.serverUrl);
    final uri = Uri.parse('$serverUrl/api/sync/full-pack');

    try {
      final request = http.Request('GET', uri)..headers.addAll(PreferencesService.authHeaders);
      final response = await http.Client().send(request).timeout(const Duration(seconds: 60));

      if (response.statusCode != 200) {
        return SyncResult(success: false, message: '서버 시드 다운로드 실패 (HTTP ${response.statusCode})');
      }

      final packId = response.headers['x-pack-id'] ?? '';
      final contentLength = response.contentLength ?? 0;
      List<int> bytes = [];

      int received = 0;
      await for (var chunk in response.stream) {
        bytes.addAll(chunk);
        received += chunk.length;
        if (contentLength > 0 && onProgress != null) {
          onProgress(received / contentLength);
        }
      }

      // Gzip 압축 해제
      final decompressed = GZipDecoder().decodeBytes(bytes);

      // 로컬 DB 파일 덮어쓰기 (P0 안전 원자적 시드 교체 엔진 활용)
      final localDbPath = await LocalDbService.getDbPath();
      final tempFile = File('$localDbPath.download.tmp');
      await tempFile.writeAsBytes(decompressed, flush: true);

      // 기존 데이터 백업, 핸들 초기화, WAL 정리 및 무결성 복원
      await LocalDbService.replaceSeedDatabase(tempFile);

      // 동기화 시간 저장
      final nowTs = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      await PreferencesService.setLastSyncedTimestamp(nowTs);

      // [핵심] 전송 확인 후 PC 서버 임시 파일 즉시 삭제 요청 (사용자 코멘트 반영)
      if (packId.isNotEmpty) {
        try {
          await http.delete(Uri.parse('$serverUrl/api/sync/full-pack/$packId'), headers: PreferencesService.authHeaders);
        } catch (_) {}
      }

      return SyncResult(
        success: true,
        message: '전체 소설 서재 동기화 완료! (23만 문장 로컬 저장소 구축)',
      );
    } catch (e) {
      return SyncResult(success: false, message: '동기화 중 오류 발생: $e');
    }
  }

  /// [양방향 증분 동기화]
  /// 1. 앱에서 편집한 번역문, 독서 진도, 찾아바꾸기 룰을 압축하여 PC로 업로드 (Push)
  /// 2. PC에서 추가/수정된 데이터를 10,000건 단위 청크로 분할 다운로드하여 로컬에 반영 (Pull)
  /// 3. 대량 데이터도 타임아웃과 OOM 없이 안전하게 수신하고 최종 누적 문장 수를 산출합니다.
  static Future<SyncResult> performIncrementalSync({
    bool ignoreWifiCheck = false,
    Function(String statusMessage, int currentCount, int? totalEstimate)? onProgress,
  }) async {
    if (!ignoreWifiCheck) {
      final isWifiAllowed = await isConnectedToTrustedWifi();
      if (!isWifiAllowed) {
        return SyncResult(
          success: false,
          message: '지정된 신뢰 Wi-Fi에 연결되어 있지 않아 동기화를 진행하지 않습니다.',
        );
      }
    }

    final isAlive = await pingServer();
    if (!isAlive) {
      return SyncResult(
        success: false,
        message: 'PC 서버에 연결할 수 없습니다. PC 서버가 켜져 있는지 확인하세요.',
      );
    }

    final serverUrl = PreferencesService.normalizeServerUrl(PreferencesService.serverUrl);

    try {
      // --- Step 1: Push (모바일 -> PC) ---
      final pendingChanges = await LocalDbService.getPendingChanges();
      int pushedTransCount = 0;
      int pushedActCount = 0;

      if (pendingChanges.isNotEmpty) {
        if (onProgress != null) {
          onProgress('모바일 변경사항 PC 서버로 업로드 중...', 0, null);
        }
        List<Map<String, dynamic>> modifiedTrans = [];
        List<Map<String, dynamic>> activities = [];
        List<Map<String, dynamic>> glossaryRules = [];
        List<int> processedQueueIds = [];

        bool hasPinChange = false;
        for (var change in pendingChanges) {
          final qId = change['id'] as int;
          final type = change['change_type'] as String;
          final payload = jsonDecode(change['payload_json'] as String);

          if (type == 'translation_edit') {
            modifiedTrans.add(payload);
          } else if (type == 'activity') {
            activities.add(payload);
          } else if (type == 'glossary_rule') {
            glossaryRules.add(payload);
          } else if (type == 'pin') {
            hasPinChange = true;
          }
          processedQueueIds.add(qId);
        }

        // 고정핀 목록 및 최근 독서 잔디 수집
        final db = await LocalDbService.database;
        List<String>? pinnedPayload;
        if (hasPinChange) {
          final pRows = await db.query('books', columns: ['folder_name'], where: 'is_pinned = 1');
          pinnedPayload = pRows.map((r) => r['folder_name'] as String).toList();
        }

        // 최근 3일간 독서 기록 동기화
        List<Map<String, dynamic>> readingLogsPayload = [];
        try {
          final rLogs = await db.query('reading_logs', orderBy: 'id DESC', limit: 50);
          for (var r in rLogs) {
            readingLogsPayload.add({
              'date': r['date'],
              'read_seconds': r['read_seconds'],
              'pages_count': r['pages_count'],
              'book_title': r['book_title'],
              'chapter_title': r['chapter_title'],
            });
          }
        } catch (_) {}

        final pushPayload = {
          'push_timestamp': DateTime.now().millisecondsSinceEpoch ~/ 1000,
          'modified_translations': modifiedTrans,
          'activities': activities,
          'reading_logs': readingLogsPayload,
          'pinned_books': pinnedPayload,
          'glossary_rules': glossaryRules,
        };

        // Gzip 압축 후 전송
        final rawBytes = utf8.encode(jsonEncode(pushPayload));
        final compressedBytes = GZipEncoder().encode(rawBytes);

        final pushRes = await http.post(
          Uri.parse('$serverUrl/api/sync/push'),
          headers: {
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
            ...PreferencesService.authHeaders,
          },
          body: compressedBytes,
        ).timeout(const Duration(seconds: 15));

        if (pushRes.statusCode == 200) {
          final pushData = jsonDecode(pushRes.body);
          pushedTransCount = pushData['updated_translations'] ?? 0;
          pushedActCount = pushData['updated_activities'] ?? 0;
          // 성공한 큐 항목 비우기
          await LocalDbService.clearPendingChanges(processedQueueIds);
        }
      }

      // --- Step 2: Pull (PC -> 모바일 분할 청크 루프) ---
      int totalPulledTransCount = 0;
      int currentSince = PreferencesService.lastSyncedTimestamp;
      int currentLastId = 0;
      bool hasMore = true;
      int? totalEstimate;

      final db = await LocalDbService.database;

      while (hasMore) {
        final uri = Uri.parse('$serverUrl/api/sync/pull?since=$currentSince&last_id=$currentLastId&limit=10000');
        final pullRes = await http.get(uri, headers: PreferencesService.authHeaders).timeout(const Duration(seconds: 30));

        if (pullRes.statusCode != 200) {
          throw Exception('서버 응답 오류 (HTTP ${pullRes.statusCode})');
        }

        // Gzip 압축 해제
        final decompressed = GZipDecoder().decodeBytes(pullRes.bodyBytes);
        final pullData = jsonDecode(utf8.decode(decompressed));

        final newTranslations = pullData['translations'] as List? ?? [];
        final batchPulledCount = newTranslations.length;
        totalPulledTransCount += batchPulledCount;

        totalEstimate ??= pullData['total_remaining'] as int?;

        final activities = pullData['activities'] as List? ?? [];
        final updatedChapters = pullData['updated_chapters'] as List? ?? [];

        if (updatedChapters.isNotEmpty) {
          final touchedBooks = <String>{};
          final batch = db.batch();

          for (var chap in updatedChapters) {
            final bName = chap['book_name'] as String;
            final cTitle = chap['title'] as String;
            final cUrl = chap['url'] as String;
            final sOrder = chap['sort_order'] as int? ?? 0;
            final sCount = chap['sentence_count'] as int? ?? 0;
            final b64Blob = chap['compressed_content'] as String;
            final blobBytes = base64Decode(b64Blob);

            touchedBooks.add(bName);

            // 해당 URL의 기존 챕터 모두 제거 후 최신 통합 챕터로 일괄 저장
            batch.delete(
              'chapters',
              where: 'book_name = ? AND url = ?',
              whereArgs: [bName, cUrl],
            );
            batch.insert('chapters', {
              'book_name': bName,
              'title': cTitle,
              'url': cUrl,
              'sort_order': sOrder,
              'sentence_count': sCount,
              'compressed_content': blobBytes,
            });
          }

          await batch.commit(noResult: true);

          // 갱신된 책들의 total_chapters를 1회씩만 집계 갱신 및 신규 책 books 등록 보장
          for (var bName in touchedBooks) {
            final countRow = await db.rawQuery('SELECT COUNT(*) as cnt FROM chapters WHERE book_name = ?', [bName]);
            final totalChaps = (countRow.first['cnt'] as num?)?.toInt() ?? 0;
            await db.rawInsert('''
              INSERT OR IGNORE INTO books (folder_name, total_chapters, is_visible)
              VALUES (?, ?, 1)
            ''', [bName, totalChaps]);
            await db.update('books', {'total_chapters': totalChaps}, where: 'folder_name = ?', whereArgs: [bName]);
          }
        }

        // PC의 활동 정보를 로컬 DB에 일괄 반영 (첫 배치에만 수신)
        if (activities.isNotEmpty) {
          final actBatch = db.batch();
          for (var act in activities) {
            final fName = act['folderName'];
            if (fName == null) continue;
            actBatch.rawInsert('''
              INSERT INTO books (
                folder_name, last_read_timestamp, last_read_pid, last_read_chapter_title,
                is_completed, is_visible, is_bookmarked, notes, summary
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(folder_name) DO UPDATE SET
                last_read_timestamp = COALESCE(excluded.last_read_timestamp, books.last_read_timestamp),
                last_read_pid = COALESCE(excluded.last_read_pid, books.last_read_pid),
                last_read_chapter_title = COALESCE(excluded.last_read_chapter_title, books.last_read_chapter_title),
                is_completed = COALESCE(excluded.is_completed, books.is_completed, 0),
                is_visible = COALESCE(excluded.is_visible, books.is_visible, 1),
                is_bookmarked = COALESCE(excluded.is_bookmarked, books.is_bookmarked, 0),
                notes = COALESCE(excluded.notes, books.notes),
                summary = COALESCE(excluded.summary, books.summary);
            ''', [
              fName,
              act['last_read_timestamp'],
              act['last_read_pid'],
              act['last_read_chapter_title'],
              act['is_completed'] ?? 0,
              act['is_visible'] ?? 1,
              act['is_bookmarked'] ?? 0,
              act['notes'],
              act['summary'],
            ]);
          }
          await actBatch.commit(noResult: true);
        }

        // 상단 고정(pinned_books) 서버 동기화 반영
        if (pullData['pinned_books'] != null) {
          final serverPinned = (pullData['pinned_books'] as List<dynamic>).map((e) => e.toString()).toList();
          final pinBatch = db.batch();
          pinBatch.update('books', {'is_pinned': 0});
          for (var pFolder in serverPinned) {
            pinBatch.update('books', {'is_pinned': 1}, where: 'folder_name = ?', whereArgs: [pFolder]);
          }
          await pinBatch.commit(noResult: true);
        }

        hasMore = pullData['has_more'] == true;
        currentSince = pullData['next_since'] as int? ?? currentSince;
        currentLastId = pullData['next_last_id'] as int? ?? 0;

        // 실시간 진행 상태 통보
        if (onProgress != null) {
          final formattedCount = _formatNumber(totalPulledTransCount);
          final estMsg = (totalEstimate != null && totalEstimate > 0)
              ? ' ($formattedCount / ~${_formatNumber(totalEstimate)}문장)'
              : ' ($formattedCount문장 반영)';
          onProgress('데이터 동기화 다운로드 중...$estMsg', totalPulledTransCount, totalEstimate);
        }

        if (hasMore) {
          // 기기 발열 방지 및 부하 분산을 위한 짧은 지연 (120ms)
          await Future.delayed(const Duration(milliseconds: 120));
        } else {
          // 최종 완료 시 동기화 기준 시간 저장
          final syncTime = pullData['sync_time'] as int? ?? (DateTime.now().millisecondsSinceEpoch ~/ 1000);
          await PreferencesService.setLastSyncedTimestamp(syncTime);
        }
      }

      // 과거 분리된 중복 회차 자가 치유 실행 및 서재 무결성 동기화
      await LocalDbService.healDuplicateChapters();
      await LocalDbService.ensureBooksIntegrity();

      final fPushed = _formatNumber(pushedTransCount);
      final fPulled = _formatNumber(totalPulledTransCount);

      return SyncResult(
        success: true,
        message: '동기화 완료! (다운로드: $fPulled문장 / 업로드: $fPushed문장)',
        updatedTranslations: pushedTransCount + totalPulledTransCount,
        updatedActivities: pushedActCount,
      );
    } catch (e) {
      return SyncResult(success: false, message: '증분 동기화 실패: $e');
    }
  }

  static String _formatNumber(int number) {
    return number.toString().replaceAllMapped(
      RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]},',
    );
  }

  /// [모바일 -> PC 긴급 역복구]
  /// 모바일 앱 로컬 SQLite의 모든 챕터 데이터를 PC 서버로 전송하여,
  /// PC DB에 이미 있는 데이터는 100% 보존하고, PC에 없는 유실분만 안전하게 INSERT 추가합니다.
  static Future<Map<String, dynamic>> rescueUploadToPc({
    Function(String statusMessage, double progress)? onProgress,
  }) async {
    final isAlive = await pingServer();
    if (!isAlive) {
      return {
        'success': false,
        'message': 'PC 서버에 연결할 수 없습니다. PC 서버가 켜져 있는지 확인하세요.',
      };
    }

    final db = await LocalDbService.database;
    final chapters = await db.query('chapters');

    if (chapters.isEmpty) {
      return {
        'success': false,
        'message': '모바일 앱 로컬 DB에 보관된 챕터가 없습니다.',
      };
    }

    if (onProgress != null) {
      onProgress('모바일 챕터 데이터 준비 중 (${chapters.length}개)...', 0.1);
    }

    List<Map<String, dynamic>> chapPayloadList = [];
    for (int i = 0; i < chapters.length; i++) {
      final c = chapters[i];
      final blob = c['compressed_content'];
      if (blob == null) continue;

      String base64Content;
      if (blob is List<int>) {
        base64Content = base64Encode(blob);
      } else {
        continue;
      }

      chapPayloadList.add({
        'book_name': c['book_name'],
        'title': c['title'],
        'url': c['url'],
        'sort_order': c['sort_order'] ?? 0,
        'sentence_count': c['sentence_count'] ?? 0,
        'compressed_content': base64Content,
      });

      if (onProgress != null && i % 20 == 0) {
        final pct = 0.1 + (0.4 * (i / chapters.length));
        onProgress('챕터 데이터 인코딩 중 ($i/${chapters.length})...', pct);
      }
    }

    final serverUrl = PreferencesService.normalizeServerUrl(PreferencesService.serverUrl);
    final uri = Uri.parse('$serverUrl/api/sync/rescue-from-mobile');

    final payload = {
      'client_id': 'mobile_rescue',
      'chapters': chapPayloadList,
    };

    if (onProgress != null) {
      onProgress('Gzip 압축 및 PC 서버로 안전 전송 중...', 0.6);
    }

    final rawJsonBytes = utf8.encode(jsonEncode(payload));
    final compressedGzipBytes = GZipEncoder().encode(rawJsonBytes);

    if (onProgress != null) {
      onProgress('PC 서버에서 유실 데이터 계산 및 복원 중...', 0.8);
    }

    final res = await http.post(
      uri,
      headers: {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        ...PreferencesService.authHeaders,
      },
      body: compressedGzipBytes,
    ).timeout(const Duration(minutes: 5));

    if (res.statusCode == 200) {
      final resData = jsonDecode(utf8.decode(res.bodyBytes));
      return {
        'success': true,
        ...resData,
      };
    } else {
      return {
        'success': false,
        'message': '서버 복구 실패 (HTTP ${res.statusCode}): ${res.body}',
      };
    }
  }
}
