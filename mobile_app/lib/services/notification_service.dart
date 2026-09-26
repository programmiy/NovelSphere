import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/app_notification.dart';
import 'preferences_service.dart';

class NotificationService {
  static final ValueNotifier<int> unreadCount = ValueNotifier<int>(0);
  static List<AppNotification> _notifications = [];
  static final Set<String> _readIds = {};

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
