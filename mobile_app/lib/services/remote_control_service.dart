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
