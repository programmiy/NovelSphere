import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../ui/viewer/reader_screen.dart';

final GlobalKey<NavigatorState> lanovelNavigatorKey = GlobalKey<NavigatorState>();

class LocalNotificationService {
  static final FlutterLocalNotificationsPlugin _notificationsPlugin =
      FlutterLocalNotificationsPlugin();

  static bool _isInitialized = false;

  /// 로컬 알림 플러그인 초기화 및 채널 등록
  static Future<void> init() async {
    if (_isInitialized) return;

    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidSettings);

    await _notificationsPlugin.initialize(
      initSettings,
      onDidReceiveNotificationResponse: _onNotificationTapped,
    );

    // Android 고우선순위 알림 채널 생성
    const androidChannel = AndroidNotificationChannel(
      'lanovel_tasks_channel',
      'LANOVEL 작업 알림',
      description: '소설 번역, 다운로드 완료 등의 실시간 알림 채널입니다.',
      importance: Importance.high,
      playSound: true,
      enableVibration: true,
    );

    final androidPlugin = _notificationsPlugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (androidPlugin != null) {
      await androidPlugin.createNotificationChannel(androidChannel);
    }

    _isInitialized = true;
  }

  /// 안드로이드 13+(API 33+) 알림 권한 요청
  static Future<bool> requestPermission() async {
    final androidPlugin = _notificationsPlugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (androidPlugin != null) {
      final granted = await androidPlugin.requestNotificationsPermission();
      return granted ?? false;
    }
    return true;
  }

  /// 안드로이드 시스템 상태표시줄 알림 팝업
  static Future<void> showNotification({
    required int id,
    required String title,
    required String body,
    String? payload,
  }) async {
    if (!_isInitialized) {
      await init();
    }

    const androidDetails = AndroidNotificationDetails(
      'lanovel_tasks_channel',
      'LANOVEL 작업 알림',
      channelDescription: '소설 번역, 다운로드 완료 등의 실시간 알림 채널입니다.',
      importance: Importance.high,
      priority: Priority.high,
      playSound: true,
      enableVibration: true,
      icon: '@mipmap/ic_launcher',
    );

    const details = NotificationDetails(android: androidDetails);

    await _notificationsPlugin.show(
      id,
      title,
      body,
      details,
      payload: payload,
    );
  }

  /// 사용자가 시스템 알림을 터치했을 때 처리 핸들러
  static void _onNotificationTapped(NotificationResponse response) {
    final payload = response.payload;
    if (payload == null || payload.isEmpty) return;

    try {
      final data = jsonDecode(payload) as Map<String, dynamic>;
      final bookTitle = data['book_title'] as String?;
      final chapterTitle = data['chapter_title'] as String?;

      if (bookTitle != null && bookTitle.isNotEmpty) {
        lanovelNavigatorKey.currentState?.push(
          MaterialPageRoute(
            builder: (_) => ReaderScreen(
              bookName: bookTitle,
              initialChapterTitle: chapterTitle,
            ),
          ),
        );
      }
    } catch (_) {}
  }
}
