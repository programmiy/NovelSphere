import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/app_notification.dart';
import 'app_update_service.dart';
import 'local_notification_service.dart';
import 'preferences_service.dart';
import 'status_dashboard_service.dart';

class NotificationService {
  static final ValueNotifier<int> unreadCount = ValueNotifier<int>(0);
  static final ValueNotifier<bool> isLocalStreamConnected = ValueNotifier<bool>(false);

  static List<AppNotification> _notifications = [];
  static final Set<String> _readIds = {};
  static final Set<String> _processedIds = {};

  static http.Client? _localStreamClient;
  static bool _isListening = false;
  static Timer? _localReconnectTimer;

  static List<AppNotification> get notifications => List.unmodifiable(_notifications);

  /// PC 서버로부터 최근 알림 목록 조회
  static Future<List<AppNotification>> fetchRecentNotifications() async {
    try {
      final serverUrl = PreferencesService.serverUrl;
      final uri = Uri.parse('$serverUrl/api/notifications/recent?limit=30');
      final res = await http.get(uri, headers: PreferencesService.authHeaders).timeout(const Duration(seconds: 4));

      if (res.statusCode == 200) {
        final data = jsonDecode(utf8.decode(res.bodyBytes));
        final list = (data['notifications'] as List? ?? [])
            .map((e) => AppNotification.fromJson(e as Map<String, dynamic>))
            .toList();

        for (final item in list) {
          _processedIds.add(item.id);
          if (_readIds.contains(item.id)) {
            item.isRead = true;
          }
        }

        _notifications = list;
        _updateUnreadCount();
        return _notifications;
      }
    } catch (_) {}
    return _notifications;
  }

  /// 실시간 로컬 알림 리스너 시작 (순수 로컬 SSE 스트림)
  static void startRealtimeListener() {
    if (_isListening) return;
    _isListening = true;
    _listenToLocalServerStream();
  }

  /// 실시간 알림 리스너 종료
  static void stopRealtimeListener() {
    _isListening = false;
    _localReconnectTimer?.cancel();
    _localReconnectTimer = null;
    _localStreamClient?.close();
    _localStreamClient = null;
    isLocalStreamConnected.value = false;
  }

  /// PC 서버 실시간 SSE 스트림 수신 (/api/notifications/stream)
  static Future<void> _listenToLocalServerStream() async {
    if (!_isListening) return;

    final serverUrl = PreferencesService.serverUrl;
    final streamUri = Uri.parse('$serverUrl/api/notifications/stream');

    _localStreamClient?.close();
    final client = http.Client();
    _localStreamClient = client;

    try {
      final request = http.Request('GET', streamUri);
      request.headers['Accept'] = 'text/event-stream';
      request.headers.addAll(PreferencesService.authHeaders);
      final response = await client.send(request).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        isLocalStreamConnected.value = true;
        String buffer = '';
        await for (final chunk in response.stream.transform(utf8.decoder)) {
          if (!_isListening) break;
          buffer += chunk;
          while (buffer.contains('\n')) {
            final newlineIndex = buffer.indexOf('\n');
            final line = buffer.substring(0, newlineIndex).trim();
            buffer = buffer.substring(newlineIndex + 1);

            if (line.startsWith('data:')) {
              final jsonStr = line.substring(5).trim();
              if (jsonStr.isNotEmpty) {
                try {
                  final data = jsonDecode(jsonStr) as Map<String, dynamic>;
                  if (data['type'] == 'app_update') {
                    // 서버로부터 새 버전 빌드 완료 SSE 신호 수신 시 즉시 무설치 자동 업데이트 가동
                    AppUpdateService.checkForUpdate(silent: true);
                  } else {
                    final itemType = data['type'] as String? ?? 'server';
                    final itemTitle = data['title'] as String? ?? 'LANOVEL 작업 알림';
                    final itemMsg = data['message'] as String? ?? '';
                    final itemPriority = data['priority'] as String? ?? 'default';

                    _processNotificationItem(
                      id: data['id']?.toString() ?? 'loc_${DateTime.now().millisecondsSinceEpoch}',
                      title: itemTitle,
                      message: itemMsg,
                      bookTitle: data['book_title'] as String?,
                      chapterTitle: data['chapter_title'] as String?,
                      clickUrl: data['click_url'] as String?,
                      type: itemType,
                      timestamp: (data['timestamp'] as num?)?.toInt(),
                    );

                    // 🚨 긴급 DB 경보, 10화 마일스톤, 번역 완료 또는 urgent/high 우선순위 알림일 경우 상단바 시스템 푸시 알림 즉시 팝업
                    if (itemType == 'db_alert' ||
                        itemType == 'episode_milestone' ||
                        itemType == 'complete' ||
                        itemPriority == 'urgent' ||
                        itemPriority == 'high') {
                      try {
                        LocalNotificationService.showNotification(
                          id: 7777,
                          title: itemTitle,
                          body: itemMsg,
                          payload: jsonEncode({
                            'type': itemType,
                            'book_title': data['book_title'],
                            'chapter_title': data['chapter_title'],
                          }),
                        );
                      } catch (_) {}
                    }

                    // 이벤트 수신 시 대시보드 상태도 즉시 갱신
                    StatusDashboardService.syncStatus();
                  }
                } catch (_) {}
              }
            }
          }
        }
      }
    } catch (_) {
      isLocalStreamConnected.value = false;
    } finally {
      isLocalStreamConnected.value = false;
      client.close();
      if (_isListening) {
        _localReconnectTimer?.cancel();
        _localReconnectTimer = Timer(const Duration(seconds: 10), () {
          if (_isListening) {
            _listenToLocalServerStream();
          }
        });
      }
    }
  }

  /// 알림 수신 공통 처리
  static void _processNotificationItem({
    required String id,
    required String title,
    required String message,
    String? bookTitle,
    String? chapterTitle,
    String? clickUrl,
    String type = 'general',
    int? timestamp,
  }) {
    if (_processedIds.contains(id)) return;
    _processedIds.add(id);

    final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final isDuplicateRecent = _notifications.take(5).any(
          (n) => n.title == title && n.message == message && (now - n.timestamp).abs() < 5,
        );
    if (isDuplicateRecent) return;

    final notif = AppNotification(
      id: id,
      title: title,
      message: message,
      type: type,
      bookTitle: bookTitle,
      chapterTitle: chapterTitle,
      clickUrl: clickUrl,
      priority: 'high',
      timestamp: timestamp ?? now,
      isRead: false,
    );

    _notifications.insert(0, notif);
    _updateUnreadCount();
  }

  /// 테스트 알림 발송 (사용자 검증용)
  static Future<bool> sendTestNotification() async {
    final hasPerm = await LocalNotificationService.requestPermission();
    if (!hasPerm) return false;

    try {
      await LocalNotificationService.showNotification(
        id: 9999,
        title: 'LANOVEL 알림 테스트',
        body: '스마트폰 상단바 시스템 푸시 알림이 정상 작동 중입니다!',
        payload: jsonEncode({
          'book_title': null,
          'chapter_title': null,
        }),
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  static void markAsRead(String id) {
    _readIds.add(id);
    for (final item in _notifications) {
      if (item.id == id) {
        item.isRead = true;
      }
    }
    _updateUnreadCount();
  }

  static void markAllAsRead() {
    for (final item in _notifications) {
      _readIds.add(item.id);
      item.isRead = true;
    }
    _updateUnreadCount();
  }

  static void _updateUnreadCount() {
    unreadCount.value = _notifications.where((n) => !n.isRead).length;
  }
}
