import 'dart:convert';
import 'dart:io';
import 'package:archive/archive.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:network_info_plus/network_info_plus.dart';

import 'preferences_service.dart';
import 'local_db_service.dart';
import 'illustration_cache_service.dart';
import '../models/novel_illustration.dart';
import '../models/pending_upload.dart';

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

  /// 모바일에서 수정된 미전송 변경사항(독서 잔디, 찾아바꾸기, 오프라인 번역) 대기 건수
  static ValueNotifier<int> get unpushedCountNotifier => LocalDbService.pendingCountNotifier;

  /// 백그라운드 무음 다운로드 완료 시 서재 화면 실시간 자동 갱신용 노티파이어
  static final ValueNotifier<int> libraryRefreshNotifier = ValueNotifier<int>(0);

  /// 현재 동기화 진행 중 플래그 (중복 실행 방지)
  static final ValueNotifier<bool> isSyncingNotifier = ValueNotifier<bool>(false);

  /// [Active Reading Guard] 현재 뷰어에서 열람 중인 챕터 URL (독서 중 화면 튐 방어)
  static String? activeReadingUrl;

  /// 미업로드 큐 건수 갱신
  static Future<void> refreshUnpushedCount() async {
    try {
      await LocalDbService.getPendingChangeCount();
    } catch (_) {}
  }

  /// 현재 폰/태블릿에 대기 중인 업로드 변경사항 상세 분석 리포트 반환
  static Future<PendingUploadSummary> inspectPendingChanges() async {
    final rows = await LocalDbService.getPendingChanges();
    int readingLogsCount = 0;
    try {
      final db = await LocalDbService.database;
      final res = await db.rawQuery('SELECT COUNT(*) as cnt FROM reading_logs');
      readingLogsCount = (res.first['cnt'] as num?)?.toInt() ?? 0;
    } catch (_) {}
    await LocalDbService.getPendingChangeCount();
    return PendingUploadSummary.fromQueueRows(rows, readingLogsCount: readingLogsCount);
  }

  /// 현재 연결된 Wi-Fi가 사용자가 지정한 2개의 신뢰 Wi-Fi 중 하나인지 확인
  static Future<bool> isConnectedToTrustedWifi() async {
    final wifi1 = PreferencesService.trustedWifi1.trim();
    final wifi2 = PreferencesService.trustedWifi2.trim();

    if (wifi1.isEmpty && wifi2.isEmpty) {
      return true;
    }

    try {
      String? currentSsid = await _networkInfo.getWifiName();
      if (currentSsid != null && currentSsid.isNotEmpty && !currentSsid.contains('unknown')) {
        currentSsid = currentSsid.replaceAll('"', '').trim();

        if (wifi1.isNotEmpty && currentSsid.toLowerCase() == wifi1.toLowerCase()) {
          return true;
        }
        if (wifi2.isNotEmpty && currentSsid.toLowerCase() == wifi2.toLowerCase()) {
          return true;
        }
      }
      return await pingServer();
    } catch (e) {
      return await pingServer();
    }
  }

  /// PC 서버와의 연결 상태 확인 및 서버 정보(총 번역 문단 수 등) 반환
  static Future<Map<String, dynamic>?> checkServerStatus([String? customUrl]) async {
    final raw = customUrl ?? PreferencesService.serverUrl;
    final serverUrl = PreferencesService.normalizeServerUrl(raw);
    try {
      final res = await http.get(
        Uri.parse('$serverUrl/api/sync/ping'),
        headers: PreferencesService.authHeaders,
      ).timeout(const Duration(seconds: 4));
      if (res.statusCode == 200) {
        final data = jsonDecode(res.body) as Map<String, dynamic>;
        if (data['status'] == 'online') {
          return data;
        }
      }
    } catch (_) {}
    return null;
  }

  /// PC 서버와의 연결 상태 확인 (Ping)
  static Future<bool> pingServer([String? customUrl]) async {
    final status = await checkServerStatus(customUrl);
    return status != null;
  }

  /// [최초 1회 전체 동기화] PC 서버에서 최적화 모바일 DB 시드를 다운받아 로컬 DB로 구축하고,
  /// 다운로드 확인 즉시 PC 서버의 임시 파일을 삭제 요청합니다.
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

    final serverStatus = await checkServerStatus();
    if (serverStatus == null) {
      return SyncResult(
        success: false,
        message: 'PC 서버에 연결할 수 없습니다. PC 서버가 켜져 있는지 확인하세요.',
      );
    }

    final serverTransCount = (serverStatus['total_translations'] as num?)?.toInt() ?? 0;
    final mobileTransCount = await LocalDbService.getTotalSentenceCount();

    // 🚨 [데이터 무결성 방어] 서버의 DB가 폰의 DB보다 비정상적으로 급감한 경우에만 차단
    if (mobileTransCount > 1000 && serverTransCount < (mobileTransCount * 0.5)) {
      return SyncResult(
        success: false,
        message: '동기화 차단: PC 서버 문단 수($serverTransCount)가 모바일($mobileTransCount)의 절반 이하로 급감하여 데이터 유실 방지를 위해 중단되었습니다.',
      );
    }

    final serverUrl = PreferencesService.normalizeServerUrl(PreferencesService.serverUrl);
    final uri = Uri.parse('$serverUrl/api/sync/full-pack');

    try {
      final request = http.Request('GET', uri)..headers.addAll(PreferencesService.authHeaders);
      final response = await http.Client().send(request).timeout(const Duration(seconds: 90));

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

      final decompressed = GZipDecoder().decodeBytes(bytes);

      final localDbPath = await LocalDbService.getDbPath();
      final tempFile = File('$localDbPath.download.tmp');
      await tempFile.writeAsBytes(decompressed, flush: true);

      await LocalDbService.replaceSeedDatabase(tempFile);

      try {
        final allIllus = await LocalDbService.getAllIllustrations();
        await IllustrationCacheService.pruneAllExcept(allIllus.map((e) => e.id).toSet());
        await IllustrationCacheService.syncAllIllustrations(allIllus);
      } catch (e) {
        debugPrint('Full seed illustration cache warning: $e');
      }

      final nowTs = DateTime.now().millisecondsSinceEpoch ~/ 1000;
      await PreferencesService.setLastSyncedTimestamp(nowTs);

      if (packId.isNotEmpty) {
        try {
          await http.delete(Uri.parse('$serverUrl/api/sync/full-pack/$packId'), headers: PreferencesService.authHeaders);
        } catch (_) {}
      }

      libraryRefreshNotifier.value++;
      await refreshUnpushedCount();

      return SyncResult(
        success: true,
        message: '전체 소설 서재 동기화 완료! (로컬 저장소 재구축 완료)',
      );
    } catch (e) {
      return SyncResult(success: false, message: '동기화 중 오류 발생: $e');
    }
  }

  /// [스냅샷 기반 무음 자동 다운로드 트리거]
  /// PC 서버에서 스마트 백업 완료(SSE 'backup_sync_ready') 신호를 보냈을 때 무음 다운로드 수행
  static Future<void> triggerSilentDownloadIfAllowed() async {
    if (isSyncingNotifier.value) return;

    final isWifi = await isConnectedToTrustedWifi();
    if (!isWifi) return;

    debugPrint('[SyncService] 안전 백업 신호 수신 -> 무음 백그라운드 다운로드 가동');
    await performIncrementalDownload(silent: true, ignoreWifiCheck: true);
  }

  /// [PC -> 모바일 다운로드(Pull) 전용 파이프라인]
  /// 1. updated_at 기반 증분 번역 및 회차 패키지 수신
  /// 2. URL 기준 구 챕터 삭제로 폴더 이동/귀속 시 중복 원천 차단
  /// 3. PC 삭제 장부(Tombstone) 반영으로 소설/회차 자동 정리
  /// 4. 뷰어 열람 중인 챕터 튕김 방어(Active Reading Guard)
  static Future<SyncResult> performIncrementalDownload({
    bool ignoreWifiCheck = false,
    bool silent = false,
    Function(String statusMessage, int currentCount, int? totalEstimate)? onProgress,
  }) async {
    if (isSyncingNotifier.value) {
      return SyncResult(success: false, message: '이미 다른 동기화 작업이 진행 중입니다.');
    }

    if (!ignoreWifiCheck) {
      final isWifiAllowed = await isConnectedToTrustedWifi();
      if (!isWifiAllowed) {
        return SyncResult(
          success: false,
          message: '지정된 신뢰 Wi-Fi에 연결되어 있지 않아 동기화를 진행하지 않습니다.',
        );
      }
    }

    isSyncingNotifier.value = true;

    try {
      final serverStatus = await checkServerStatus();
      if (serverStatus == null) {
        return SyncResult(
          success: false,
          message: 'PC 서버에 연결할 수 없습니다. PC 서버가 켜져 있는지 확인하세요.',
        );
      }

      final serverTransCount = (serverStatus['total_translations'] as num?)?.toInt() ?? 0;
      final mobileTransCount = await LocalDbService.getTotalSentenceCount();

      // 🚨 [데이터 무결성 방어] 정상 삭제는 허용하고, 50% 이상 급감한 서버 재난만 차단
      if (mobileTransCount > 1000 && serverTransCount < (mobileTransCount * 0.5)) {
        return SyncResult(
          success: false,
          message: '동기화 차단: PC 서버 문단 수($serverTransCount)가 모바일($mobileTransCount)의 절반 이하로 급감하여 데이터 유실 방지를 위해 중단되었습니다.',
        );
      }

      final serverUrl = PreferencesService.normalizeServerUrl(PreferencesService.serverUrl);
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

        final decompressed = GZipDecoder().decodeBytes(pullRes.bodyBytes);
        final pullData = jsonDecode(utf8.decode(decompressed));

        final newTranslations = pullData['translations'] as List? ?? [];
        totalPulledTransCount += newTranslations.length;
        totalEstimate ??= pullData['total_remaining'] as int?;

        // 1. PC 삭제 장부 (Tombstone) 반영: PC에서 삭제된 소설/회차 로컬 DB 일괄 제거
        final deletions = pullData['deletions'] as List? ?? [];
        if (deletions.isNotEmpty) {
          final delBatch = db.batch();
          final affectedBooks = <String>{};
          final deletedIlluIds = <int>[];
          for (var item in deletions) {
            final eType = item['entity_type'] as String?;
            final eId = item['entity_id'] as String?;
            final pScope = item['parent_scope'] as String?;
            if (eType == 'chapter' && eId != null) {
              delBatch.delete('chapters', where: 'url = ?', whereArgs: [eId]);
              delBatch.delete('novel_illustrations', where: 'chapter_url = ?', whereArgs: [eId]);
              if (pScope != null) affectedBooks.add(pScope);
            } else if (eType == 'novel' && eId != null) {
              delBatch.delete('chapters', where: 'book_name = ?', whereArgs: [eId]);
              delBatch.delete('books', where: 'folder_name = ?', whereArgs: [eId]);
              delBatch.delete('novel_illustrations', where: 'book_name = ?', whereArgs: [eId]);
            } else if (eType == 'illustration' && eId != null) {
              final parsedId = int.tryParse(eId);
              if (parsedId != null && parsedId > 0) {
                deletedIlluIds.add(parsedId);
              }
            }
          }
          await delBatch.commit(noResult: true);
          if (deletedIlluIds.isNotEmpty) {
            await LocalDbService.deleteIllustrationsByIds(deletedIlluIds);
            try {
              await IllustrationCacheService.deleteByIds(deletedIlluIds);
            } catch (_) {}
          }

          for (var bName in affectedBooks) {
            final countRow = await db.rawQuery('SELECT COUNT(*) as cnt FROM chapters WHERE book_name = ?', [bName]);
            final totalChaps = (countRow.first['cnt'] as num?)?.toInt() ?? 0;
            if (totalChaps == 0) {
              await db.delete('books', where: 'folder_name = ?', whereArgs: [bName]);
            } else {
              await db.update('books', {'total_chapters': totalChaps}, where: 'folder_name = ?', whereArgs: [bName]);
            }
          }
        }

        // 2. 챕터 신규/수정 적재: [핵심 디테일] URL 기준 구 챕터 삭제 후 적재하여 폴더 이동/미분류 귀속 중복 100% 차단
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

            // ⚠️ [필수 디테일] book_name에 상관없이 동일 URL의 구 챕터를 먼저 깨끗이 삭제
            batch.delete(
              'chapters',
              where: 'url = ?',
              whereArgs: [cUrl],
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

          for (var bName in touchedBooks) {
            final countRow = await db.rawQuery('SELECT COUNT(*) as cnt FROM chapters WHERE book_name = ?', [bName]);
            final totalChaps = (countRow.first['cnt'] as num?)?.toInt() ?? 0;
            await db.rawInsert(
              'INSERT OR IGNORE INTO books (folder_name, total_chapters, is_visible) VALUES (?, ?, 1)',
              [bName, totalChaps],
            );
            await db.update('books', {'total_chapters': totalChaps}, where: 'folder_name = ?', whereArgs: [bName]);
          }
        }

        // 3. 활동 및 북마크 반영
        final activities = pullData['activities'] as List? ?? [];
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

        if (pullData['pinned_books'] != null) {
          final serverPinned = (pullData['pinned_books'] as List<dynamic>).map((e) => e.toString()).toList();
          final pinBatch = db.batch();
          pinBatch.update('books', {'is_pinned': 0});
          for (var pFolder in serverPinned) {
            pinBatch.update('books', {'is_pinned': 1}, where: 'folder_name = ?', whereArgs: [pFolder]);
          }
          await pinBatch.commit(noResult: true);
        }

        final highlights = pullData['highlights'] as List? ?? [];
        if (highlights.isNotEmpty) {
          await LocalDbService.syncHighlightsFromPc(highlights);
        }

        final illustrations = pullData['illustrations'] as List? ?? [];
        if (illustrations.isNotEmpty) {
          await LocalDbService.upsertIllustrationsFromPc(illustrations);
          try {
            final parsedIllus = illustrations
                .whereType<Map>()
                .map((raw) => NovelIllustration.fromMap(Map<String, dynamic>.from(raw)))
                .where((item) => item.id > 0)
                .toList();
            await IllustrationCacheService.syncAllIllustrations(parsedIllus);
          } catch (e) {
            debugPrint('Incremental illustration cache warning: $e');
          }
        }

        hasMore = pullData['has_more'] == true;
        currentSince = pullData['next_since'] as int? ?? currentSince;
        currentLastId = pullData['next_last_id'] as int? ?? 0;

        if (onProgress != null) {
          final formattedCount = _formatNumber(totalPulledTransCount);
          final estMsg = (totalEstimate != null && totalEstimate > 0)
              ? ' ($formattedCount / ~${_formatNumber(totalEstimate)}문장)'
              : ' ($formattedCount문장 반영)';
          onProgress('데이터 동기화 다운로드 중...$estMsg', totalPulledTransCount, totalEstimate);
        }

        if (hasMore) {
          await Future.delayed(const Duration(milliseconds: 120));
        } else {
          final syncTime = pullData['sync_time'] as int? ?? (DateTime.now().millisecondsSinceEpoch ~/ 1000);
          await PreferencesService.setLastSyncedTimestamp(syncTime);
        }
      }

      await LocalDbService.healDuplicateChapters();
      await LocalDbService.ensureBooksIntegrity();

      libraryRefreshNotifier.value++;

      final fPulled = _formatNumber(totalPulledTransCount);
      return SyncResult(
        success: true,
        message: '다운로드 동기화 완료! ($fPulled문장 반영)',
        updatedTranslations: totalPulledTransCount,
      );
    } catch (e) {
      return SyncResult(success: false, message: '다운로드 동기화 실패: $e');
    } finally {
      isSyncingNotifier.value = false;
    }
  }

  /// [모바일 -> PC 업로드(Push) 전용 파이프라인]
  /// 사용자가 명시적으로 [서버로 업로드] 버튼을 눌렀을 때만 동작하여 자동 덮어쓰기/충돌을 원천 차단
  static Future<SyncResult> performManualUpload({
    bool ignoreWifiCheck = false,
    Function(String statusMessage, int currentCount, int? totalEstimate)? onProgress,
  }) async {
    if (isSyncingNotifier.value) {
      return SyncResult(success: false, message: '이미 다른 동기화 작업이 진행 중입니다.');
    }

    if (!ignoreWifiCheck) {
      final isWifiAllowed = await isConnectedToTrustedWifi();
      if (!isWifiAllowed) {
        return SyncResult(
          success: false,
          message: '지정된 신뢰 Wi-Fi에 연결되어 있지 않아 업로드를 진행하지 않습니다.',
        );
      }
    }

    isSyncingNotifier.value = true;

    try {
      final serverStatus = await checkServerStatus();
      if (serverStatus == null) {
        return SyncResult(
          success: false,
          message: 'PC 서버에 연결할 수 없습니다. PC 서버가 켜져 있는지 확인하세요.',
        );
      }

      final pendingChanges = await LocalDbService.getPendingChanges();
      if (pendingChanges.isEmpty) {
        await refreshUnpushedCount();
        return SyncResult(success: true, message: '서버로 업로드할 모바일 변경사항이 없습니다.');
      }

      if (onProgress != null) {
        onProgress('모바일 변경사항 (${pendingChanges.length}건) 업로드 준비 중...', 0, pendingChanges.length);
      }

      List<Map<String, dynamic>> modifiedTrans = [];
      List<Map<String, dynamic>> activities = [];
      List<Map<String, dynamic>> glossaryRules = [];
      final Map<String, Map<String, dynamic>> highlightsToAdd = {};
      final Map<String, Map<String, dynamic>> highlightsToDelete = {};
      List<int> processedQueueIds = [];

      bool hasPinChange = false;
      for (var change in pendingChanges) {
        final qId = change['id'] as int;
        final type = change['change_type'] as String;
        final decoded = jsonDecode(change['payload_json'] as String);
        final payload = decoded is Map<String, dynamic>
            ? Map<String, dynamic>.from(decoded)
            : Map<String, dynamic>.from(decoded as Map);

        if (type == 'translation_edit') {
          payload.remove('before_translated');
          modifiedTrans.add(payload);
        } else if (type == 'activity') {
          payload.remove('change_reasons');
          activities.add(payload);
        } else if (type == 'glossary_rule') {
          glossaryRules.add(payload);
        } else if (type == 'highlight_add') {
          final key = '${payload['url'] ?? ''}#${payload['pid'] ?? ''}';
          highlightsToDelete.remove(key);
          highlightsToAdd[key] = payload;
        } else if (type == 'highlight_delete') {
          final url = payload['url']?.toString() ?? '';
          final pid = payload['pid']?.toString() ?? '';
          final key = '$url#$pid';
          highlightsToAdd.remove(key);
          if (url.isNotEmpty && pid.isNotEmpty) {
            highlightsToDelete[key] = {'url': url, 'pid': pid};
          }
        } else if (type == 'pin') {
          hasPinChange = true;
        }
        processedQueueIds.add(qId);
      }

      final highlightsPayload = highlightsToAdd.values.toList();
      final deletedHighlightsPayload = highlightsToDelete.values.toList();

      final db = await LocalDbService.database;
      List<String>? pinnedPayload;
      if (hasPinChange) {
        final pRows = await db.query('books', columns: ['folder_name'], where: 'is_pinned = 1');
        pinnedPayload = pRows.map((r) => r['folder_name'] as String).toList();
      }

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
        'highlights': highlightsPayload,
        'deleted_highlights': deletedHighlightsPayload,
      };

      final rawBytes = utf8.encode(jsonEncode(pushPayload));
      final compressedBytes = GZipEncoder().encode(rawBytes);

      final serverUrl = PreferencesService.normalizeServerUrl(PreferencesService.serverUrl);
      final pushRes = await http.post(
        Uri.parse('$serverUrl/api/sync/push'),
        headers: {
          'Content-Type': 'application/json',
          'Content-Encoding': 'gzip',
          ...PreferencesService.authHeaders,
        },
        body: compressedBytes,
      ).timeout(const Duration(seconds: 20));

      if (pushRes.statusCode != 200) {
        throw Exception('서버 업로드 거절 (HTTP ${pushRes.statusCode})');
      }

      final pushData = jsonDecode(pushRes.body);
      final pushedTransCount = (pushData['updated_translations'] as num?)?.toInt() ?? 0;
      final pushedActCount = (pushData['updated_activities'] as num?)?.toInt() ?? 0;
      final pushedRulesCount = (pushData['applied_glossary_rules'] as num?)?.toInt() ?? 0;
      final pushedHlCount = (pushData['applied_highlights'] as num?)?.toInt() ?? 0;
      final deletedHlCount = (pushData['deleted_highlights'] as num?)?.toInt() ?? 0;

      await LocalDbService.clearPendingChanges(processedQueueIds);
      await refreshUnpushedCount();

      final resultParts = <String>[];
      if (pushedTransCount > 0) resultParts.add('문장 수정 $pushedTransCount건');
      if (pushedRulesCount > 0) resultParts.add('찾아바꾸기 $pushedRulesCount건');
      if (pushedActCount > 0) resultParts.add('진도·상태 $pushedActCount건');
      if (pinnedPayload != null) resultParts.add('상단고정 ${pinnedPayload.length}권 반영');
      if (pushedHlCount > 0) resultParts.add('마킹 추가 $pushedHlCount건');
      if (deletedHlCount > 0) resultParts.add('마킹 해제 $deletedHlCount건');
      final detailMsg = resultParts.isEmpty ? '서버와 이미 동일함' : resultParts.join(', ');

      return SyncResult(
        success: true,
        message: '모바일 변경사항 업로드 완료! ($detailMsg)',
        updatedTranslations: pushedTransCount,
        updatedActivities: pushedActCount,
      );
    } catch (e) {
      return SyncResult(success: false, message: '업로드 동기화 실패: $e');
    } finally {
      isSyncingNotifier.value = false;
    }
  }

  /// [양방향 동기화: 하위 호환성 유지]
  /// 수동 업로드 후 최신 다운로드를 차례대로 실행
  static Future<SyncResult> performIncrementalSync({
    bool ignoreWifiCheck = false,
    Function(String statusMessage, int currentCount, int? totalEstimate)? onProgress,
  }) async {
    final upResult = await performManualUpload(
      ignoreWifiCheck: ignoreWifiCheck,
      onProgress: onProgress,
    );
    if (!upResult.success && upResult.message.contains('서버에 연결할 수 없습니다')) {
      return upResult;
    }

    final downResult = await performIncrementalDownload(
      ignoreWifiCheck: ignoreWifiCheck,
      onProgress: onProgress,
    );

    return SyncResult(
      success: downResult.success,
      message: '${upResult.message} | ${downResult.message}',
      updatedTranslations: upResult.updatedTranslations + downResult.updatedTranslations,
      updatedActivities: upResult.updatedActivities + downResult.updatedActivities,
    );
  }

  static String _formatNumber(int number) {
    return number.toString().replaceAllMapped(
      RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]},',
    );
  }

  /// [모바일 -> PC 긴급 역복구]
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
