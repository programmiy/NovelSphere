import 'dart:async';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'preferences_service.dart';

/// 리모컨 API 오류. [offline]이면 서버에 아예 연결하지 못한 경우(🔴 서버 오프라인).
class RemoteException implements Exception {
  final String message;
  final int? statusCode;
  final bool offline;
  RemoteException(this.message, {this.statusCode, this.offline = false});

  @override
  String toString() => message;
}

class RemoteCommandRecord {
  final String id;
  final String type;
  final String status; // pending / sent / done / failed / expired
  final String resultMessage;

  RemoteCommandRecord({
    required this.id,
    required this.type,
    required this.status,
    required this.resultMessage,
  });

  factory RemoteCommandRecord.fromJson(Map<String, dynamic> j) => RemoteCommandRecord(
        id: j['id'] as String? ?? '',
        type: j['type'] as String? ?? '',
        status: j['status'] as String? ?? '',
        resultMessage: j['result_message'] as String? ?? '',
      );
}

class RemoteStatus {
  final String state; // running, paused, delay_wait, censor_split, stalled, extension_offline, ...
  final String label; // 서버가 만들어준 한 줄 상태 글
  final bool extensionOnline;
  final String bookTitle;
  final String chapterTitle;
  final String url;
  final int percentage;
  final int delayRemainingSec;
  final bool nextScheduled;
  final bool turbo;
  final int? lastSeenAgoSec;
  final bool siteQueueSupported;
  final List<RemoteCommandRecord> recentCommands;

  RemoteStatus({
    required this.state,
    required this.label,
    required this.extensionOnline,
    required this.bookTitle,
    required this.chapterTitle,
    required this.url,
    required this.percentage,
    required this.delayRemainingSec,
    required this.nextScheduled,
    required this.turbo,
    required this.lastSeenAgoSec,
    required this.siteQueueSupported,
    required this.recentCommands,
  });

  factory RemoteStatus.fromJson(Map<String, dynamic> j) => RemoteStatus(
        state: j['state'] as String? ?? 'other',
        label: j['label'] as String? ?? '❓ 알 수 없음',
        extensionOnline: j['extension_online'] as bool? ?? false,
        bookTitle: j['book_title'] as String? ?? '',
        chapterTitle: j['chapter_title'] as String? ?? '',
        url: j['url'] as String? ?? '',
        percentage: (j['percentage'] as num?)?.toInt() ?? 0,
        delayRemainingSec: (j['delay_remaining_sec'] as num?)?.toInt() ?? 0,
        nextScheduled: j['next_scheduled'] as bool? ?? false,
        turbo: j['turbo'] as bool? ?? false,
        lastSeenAgoSec: (j['last_seen_ago_sec'] as num?)?.toInt(),
        siteQueueSupported: j['site_queue_supported'] as bool? ?? false,
        recentCommands: ((j['recent_commands'] as List?) ?? [])
            .map((e) => RemoteCommandRecord.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class RemoteCommandResult {
  final bool deliveredViaWs;
  final bool extensionOnline;
  RemoteCommandResult({required this.deliveredViaWs, required this.extensionOnline});
}

/// '다음에 번역할 사이트 목록' 항목 (기능이 붙기 전까지는 빈 목록)
class SiteQueueItem {
  final String title;
  final String url;
  SiteQueueItem({required this.title, required this.url});
}

/// 연속 번역 목록 항목 (서버 `/api/remote/queue`)
class QueueItem {
  final int id;
  final String url;
  final String site;
  final String title;
  final String status; // pending / running / done / failed
  final String failReason;
  final int attempts;

  QueueItem({
    required this.id,
    required this.url,
    required this.site,
    required this.title,
    required this.status,
    required this.failReason,
    required this.attempts,
  });

  factory QueueItem.fromJson(Map<String, dynamic> j) => QueueItem(
        id: (j['id'] as num?)?.toInt() ?? 0,
        url: j['url'] as String? ?? '',
        site: j['site'] as String? ?? '',
        title: j['title'] as String? ?? '',
        status: j['status'] as String? ?? 'pending',
        failReason: j['fail_reason'] as String? ?? '',
        attempts: (j['attempts'] as num?)?.toInt() ?? 0,
      );
}

class QueueEvent {
  final int ts;
  final String kind;
  final String message;
  QueueEvent({required this.ts, required this.kind, required this.message});

  factory QueueEvent.fromJson(Map<String, dynamic> j) => QueueEvent(
        ts: (j['ts'] as num?)?.toInt() ?? 0,
        kind: j['kind'] as String? ?? '',
        message: j['message'] as String? ?? '',
      );
}

/// 목록 전체 상태 (항목 + 설정 + 최근 이슈)
class QueueOverview {
  final List<QueueItem> items;
  final bool running;
  final bool cinderella;
  final int pendingCount;
  final int failedCount;
  final List<QueueEvent> recentEvents;

  QueueOverview({
    required this.items,
    required this.running,
    required this.cinderella,
    required this.pendingCount,
    required this.failedCount,
    required this.recentEvents,
  });

  factory QueueOverview.fromJson(Map<String, dynamic> j) => QueueOverview(
        items: ((j['items'] as List?) ?? [])
            .map((e) => QueueItem.fromJson(e as Map<String, dynamic>))
            .toList(),
        running: j['running'] as bool? ?? false,
        cinderella: j['cinderella'] as bool? ?? false,
        pendingCount: (j['pending_count'] as num?)?.toInt() ?? 0,
        failedCount: (j['failed_count'] as num?)?.toInt() ?? 0,
        recentEvents: ((j['recent_events'] as List?) ?? [])
            .map((e) => QueueEvent.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

/// URL 추가 결과
class QueueAddResult {
  final int added;
  final int requeued;
  final List<String> rejectedReasons;
  QueueAddResult({required this.added, required this.requeued, required this.rejectedReasons});
}

class RemoteControlService {
  static const _timeout = Duration(seconds: 5);

  static Uri _uri(String path) => Uri.parse('${PreferencesService.serverUrl}/api/remote$path');

  static Map<String, String> get _headers => {
        'Content-Type': 'application/json',
        ...PreferencesService.authHeaders, // 동기화에 쓰는 기존 X-Lanovel-Key 를 그대로 사용
      };

  static Future<http.Response> _request(Future<http.Response> Function() call) async {
    try {
      final res = await call().timeout(_timeout);
      if (res.statusCode == 200) return res;
      String detail = '요청 실패 (${res.statusCode})';
      try {
        final body = jsonDecode(utf8.decode(res.bodyBytes));
        if (body is Map && body['detail'] != null) detail = body['detail'].toString();
      } catch (_) {}
      if (res.statusCode == 401) detail = '인증 실패: 설정의 PC 서버 보안 토큰을 확인하세요.';
      throw RemoteException(detail, statusCode: res.statusCode);
    } on RemoteException {
      rethrow;
    } on TimeoutException {
      throw RemoteException('서버 응답 없음', offline: true);
    } catch (_) {
      throw RemoteException('서버에 연결할 수 없습니다', offline: true);
    }
  }

  static Future<RemoteStatus> fetchStatus() async {
    final res = await _request(() => http.get(_uri('/status'), headers: _headers));
    return RemoteStatus.fromJson(jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>);
  }

  static Future<RemoteCommandResult> sendCommand(String type, {Map<String, dynamic>? params}) async {
    final res = await _request(() => http.post(
          _uri('/command'),
          headers: _headers,
          body: jsonEncode({'type': type, 'params': params ?? {}}),
        ));
    final json = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    return RemoteCommandResult(
      deliveredViaWs: json['delivered_via_ws'] as bool? ?? false,
      extensionOnline: json['extension_online'] as bool? ?? false,
    );
  }

  // ----------------------------- 연속 번역 목록 -----------------------------
  static Future<QueueOverview> fetchQueue() async {
    final res = await _request(() => http.get(_uri('/queue'), headers: _headers));
    return QueueOverview.fromJson(jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>);
  }

  static Future<QueueAddResult> addQueueUrls(List<String> urls) async {
    final res = await _request(() => http.post(
          _uri('/queue'),
          headers: _headers,
          body: jsonEncode({'urls': urls}),
        ));
    final j = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    return QueueAddResult(
      added: ((j['added'] as List?) ?? []).length,
      requeued: ((j['requeued'] as List?) ?? []).length,
      rejectedReasons: ((j['rejected'] as List?) ?? [])
          .map((e) => (e as Map)['reason']?.toString() ?? '')
          .where((s) => s.isNotEmpty)
          .toList(),
    );
  }

  static Future<void> removeQueueItem(int id) async {
    await _request(() => http.delete(_uri('/queue/$id'), headers: _headers));
  }

  static Future<void> reorderQueue(List<int> ids) async {
    await _request(() => http.post(
          _uri('/queue/reorder'),
          headers: _headers,
          body: jsonEncode({'ids': ids}),
        ));
  }

  static Future<void> retryQueueItem(int id) async {
    await _request(() => http.post(_uri('/queue/$id/retry'), headers: _headers));
  }

  /// 시작/정지(`running`)와 신데렐라(`cinderella`) 설정. null인 값은 바꾸지 않는다.
  static Future<void> setQueueConfig({bool? running, bool? cinderella}) async {
    await _request(() => http.put(
          _uri('/queue/config'),
          headers: _headers,
          body: jsonEncode({
            if (running != null) 'running': running,
            if (cinderella != null) 'cinderella': cinderella,
          }),
        ));
  }

  /// [예약] 다음에 번역할 사이트 목록. 서버가 아직 지원하지 않으면 빈 목록을 돌려준다.
  static Future<List<SiteQueueItem>> fetchSiteQueue() async {
    final res = await _request(() => http.get(_uri('/site_queue'), headers: _headers));
    final json = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
    return ((json['items'] as List?) ?? [])
        .map((e) => SiteQueueItem(
              title: (e as Map)['title']?.toString() ?? '',
              url: e['url']?.toString() ?? '',
            ))
        .toList();
  }
}
