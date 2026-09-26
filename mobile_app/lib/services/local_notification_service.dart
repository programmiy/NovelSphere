import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import '../ui/viewer/reader_screen.dart';

final GlobalKey<NavigatorState> lanovelNavigatorKey = GlobalKey<NavigatorState>();

class LocalNotificationService {
  static final FlutterLocalNotificationsPlugin _notificationsPlugin =
      FlutterLocalNotificationsPlugin();

  static bool _isInitialized = false;
  static const int dashboardNotificationId = 9001;

  /// 로컬 알림 플러그인 초기화 및 채널 등록
  static Future<void> init() async {
    if (_isInitialized) return;

    const androidSettings = AndroidInitializationSettings('@mipmap/ic_launcher');
    const initSettings = InitializationSettings(android: androidSettings);

    await _notificationsPlugin.initialize(
      initSettings,
      onDidReceiveNotificationResponse: _onNotificationTapped,
    );

    final androidPlugin = _notificationsPlugin.resolvePlatformSpecificImplementation<
        AndroidFlutterLocalNotificationsPlugin>();
    if (androidPlugin != null) {
      // 1. 개별 완료 알림 채널
      const androidChannel = AndroidNotificationChannel(
        'lanovel_tasks_channel',
        'LANOVEL 작업 알림',
        description: '소설 번역, 다운로드 완료 등의 실시간 알림 채널입니다.',
        importance: Importance.high,
        playSound: true,
        enableVibration: true,
      );
      await androidPlugin.createNotificationChannel(androidChannel);

      // 2. 배민 스타일 무음 고정 대시보드 현황판 채널 (진동/소리 0회, 단일 알림창 유지)
      const dashboardChannel = AndroidNotificationChannel(
        'lanovel_dashboard_channel',
        'LANOVEL 작업 현황판',
        description: '실시간 번역 작업 진행도 및 검수/API 오류 현황을 표시하는 대시보드 알림 채널입니다.',
        importance: Importance.low,
        playSound: false,
        enableVibration: false,
      );
      await androidPlugin.createNotificationChannel(dashboardChannel);
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

  /// 배민식 단일 대시보드 현황판 알림 갱신 (무음/무진동 갱신, 고정 ID 9001)
  static Future<void> updateDashboardNotification({
    required String title,
    required String body,
    required int progress,
    required int maxProgress,
    required List<String> detailLines,
    String? payload,
  }) async {
    if (!_isInitialized) {
      await init();
    }

    final bigTextStyle = BigTextStyleInformation(
      detailLines.join('\n'),
      contentTitle: title,
      summaryText: '$progress%',
    );

    final androidDetails = AndroidNotificationDetails(
      'lanovel_dashboard_channel',
      'LANOVEL 작업 현황판',
      channelDescription: '실시간 번역 작업 진행도 및 검수/API 오류 현황을 표시하는 대시보드 알림 채널입니다.',
      importance: Importance.low,
      priority: Priority.low,
      playSound: false,
      enableVibration: false,
      ongoing: true, // 배민 알림처럼 고정
      onlyAlertOnce: true, // 갱신 시 소리/진동 0회
      showProgress: true,
      maxProgress: maxProgress,
      progress: progress,
      styleInformation: bigTextStyle,
    );

    final details = NotificationDetails(android: androidDetails);
    await _notificationsPlugin.show(
      dashboardNotificationId,
      title,
      body,
      details,
      payload: payload,
    );
  }

  /// 대시보드 현황판 알림 닫기 (작업이 없을 때 완전 숨김)
  static Future<void> cancelDashboardNotification() async {
    await _notificationsPlugin.cancel(dashboardNotificationId);
  }

  /// 일반 알림 팝업
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
