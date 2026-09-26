import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/app_notification.dart';
import 'local_notification_service.dart';
import 'preferences_service.dart';

class NotificationService {
  static final ValueNotifier<int> unreadCount = ValueNotifier<int>(0);
  static List<AppNotification> _notifications = [];
  static final Set<String> _readIds = {};
  static final Set<String> _processedIds = {};

  static http.Client? _ntfyStreamClient;
  static http.Client? _localStreamClient;
  static bool _isListening = false;
  static Timer? _ntfyReconnectTimer;
  static Timer? _localReconnectTimer;
  static int _notificationIdCounter = 1000;

  static List<AppNotification> get notifications => List.unmodifiable(_notifications);

  /// PC 서버로부터 최근 알림 목록 조회
  static Future<List<AppNotification>> fetchRecentNotifications() async {
    try {
      final serverUrl = PreferencesService.serverUrl;
      final uri = Uri.parse('$serverUrl/api/notifications/recent?limit=30');
      final res = await http.get(uri).timeout(const Duration(seconds: 4));

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

  /// 실시간 알림 수신 리스너 시작 (로컬 SSE 및 ntfy 스트림 동시 가동)
  static void startRealtimeListener() {
    if (_isListening) return;
    _isListening = true;

    // 1. PC 서버 직접 연결 로컬 SSE 스트림 (순수 로컬 완전 독립)
    _listenToLocalServerStream();

    // 2. 외부 ntfy 스트림 (옵션 활성화 시)
    if (PreferencesService.enableNtfySync) {
      _listenToNtfyStream();
    }
  }

  /// 실시간 알림 리스너 종료
  static void stopRealtimeListener() {
    _isListening = false;
    _ntfyReconnectTimer?.cancel();
    _ntfyReconnectTimer = null;
    _localReconnectTimer?.cancel();
    _localReconnectTimer = null;

    _ntfyStreamClient?.close();
    _ntfyStreamClient = null;
    _localStreamClient?.close();
    _localStreamClient = null;
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
      final response = await client.send(request).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
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
                  _processNotificationItem(
                    id: data['id']?.toString() ?? 'loc_${DateTime.now().millisecondsSinceEpoch}',
                    title: data['title'] as String? ?? 'LANOVEL 작업 알림',
                    message: data['message'] as String? ?? '',
                    bookTitle: data['book_title'] as String?,
                    chapterTitle: data['chapter_title'] as String?,
                    clickUrl: data['click_url'] as String?,
                    type: data['type'] as String? ?? 'server',
                    timestamp: (data['timestamp'] as num?)?.toInt(),
                  );
                } catch (_) {}
              }
            }
          }
        }
      }
    } catch (_) {
    } finally {
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

  /// ntfy HTTP chunked JSON 스트림 수신 루프
  static Future<void> _listenToNtfyStream() async {
    if (!_isListening) return;
    if (!PreferencesService.enableNtfySync) return;

    final ntfyServer = PreferencesService.ntfyServer.replaceAll(RegExp(r'/+$'), '');
    final ntfyTopic = PreferencesService.ntfyTopic.trim();
    if (ntfyTopic.isEmpty) return;

    final streamUri = Uri.parse('$ntfyServer/$ntfyTopic/json?since=now');

    _ntfyStreamClient?.close();
    final client = http.Client();
    _ntfyStreamClient = client;

    try {
      final request = http.Request('GET', streamUri);
      request.headers['Accept'] = 'application/x-ndjson, application/json';
      final response = await client.send(request);

      if (response.statusCode == 200) {
        String buffer = '';
        await for (final chunk in response.stream.transform(utf8.decoder)) {
          if (!_isListening) break;
          buffer += chunk;
          while (buffer.contains('\n')) {
            final newlineIndex = buffer.indexOf('\n');
            final line = buffer.substring(0, newlineIndex).trim();
            buffer = buffer.substring(newlineIndex + 1);

            if (line.isNotEmpty) {
              _handleNtfyStreamLine(line);
            }
          }
        }
      }
    } catch (e) {
      if (kDebugMode) {
        print('[NotificationService] ntfy stream disconnected: $e');
      }
    } finally {
      client.close();
      if (_isListening && PreferencesService.enableNtfySync) {
        _ntfyReconnectTimer?.cancel();
        _ntfyReconnectTimer = Timer(const Duration(seconds: 5), () {
          if (_isListening && PreferencesService.enableNtfySync) {
            _listenToNtfyStream();
          }
        });
      }
    }
  }

  /// 단일 ntfy JSON 라인 파싱
  static void _handleNtfyStreamLine(String jsonLine) {
    try {
      final data = jsonDecode(jsonLine) as Map<String, dynamic>;
      final event = data['event'] as String?;
      if (event != 'message') return;

      final id = data['id']?.toString() ?? 'ntfy_${DateTime.now().millisecondsSinceEpoch}';
      final title = data['title'] as String? ?? 'LANOVEL 알림';
      final message = data['message'] as String? ?? '';
      final clickUrl = data['click'] as String?;

      String? bookTitle;
      String? chapterTitle;

      if (clickUrl != null && clickUrl.isNotEmpty) {
        final parsedUri = Uri.tryParse(clickUrl);
        if (parsedUri != null) {
          bookTitle = parsedUri.queryParameters['book'];
          chapterTitle = parsedUri.queryParameters['title'];
        }
      }

      if (bookTitle == null || bookTitle.isEmpty) {
        final match = RegExp(r'\[(.*?)\]').firstMatch(title);
        if (match != null) {
          bookTitle = match.group(1);
        }
      }

      _processNotificationItem(
        id: id,
        title: title,
        message: message,
        bookTitle: bookTitle,
        chapterTitle: chapterTitle,
        clickUrl: clickUrl,
        type: 'ntfy',
        timestamp: (data['time'] as num?)?.toInt(),
      );
    } catch (_) {}
  }

  /// 알림 수신 공통 처리 (중복 방지, 인앱 목록 적재, 안드로이드 시스템 상태바 팝업)
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
    // 중복 수신 방지 (로컬 SSE와 ntfy 동시 발송 시에도 1회만 처리)
    if (_processedIds.contains(id)) return;
    _processedIds.add(id);

    // 제목/본문 동일 알림 최근 5초 이내 중복 방지
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

    // 안드로이드 시스템 상태표시줄 푸시 알림 팝업
    if (PreferencesService.enableSystemNotification) {
      final payload = jsonEncode({
        'book_title': bookTitle,
        'chapter_title': chapterTitle,
      });

      LocalNotificationService.showNotification(
        id: _notificationIdCounter++,
        title: title,
        body: message,
        payload: payload,
      );
    }
  }

  /// 테스트 알림 발송 (사용자 검증용)
  static Future<void> sendTestNotification() async {
    final hasPerm = await LocalNotificationService.requestPermission();
    if (!hasPerm) return;

    final testId = _notificationIdCounter++;
    await LocalNotificationService.showNotification(
      id: testId,
      title: 'LANOVEL 알림 테스트',
      body: '스마트폰 상단바 시스템 푸시 알림이 정상 작동 중입니다!',
      payload: jsonEncode({
        'book_title': null,
        'chapter_title': null,
      }),
    );
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
