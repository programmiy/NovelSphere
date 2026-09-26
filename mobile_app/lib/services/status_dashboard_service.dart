import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'local_notification_service.dart';
import 'preferences_service.dart';

class DashboardStatusData {
  final bool isActive;
  final String? bookTitle;
  final String? currentEpisodeTitle;
  final int currentSentence;
  final int totalSentences;
  final int percentage;
  final int episodeCount;
  final String statusText;
  final int reviewPendingCount;
  final int apiErrorsTotal;
  final String apiErrorsSummary;
  final Map<String, dynamic> apiErrorsByType;
  final int updatedAt;

  DashboardStatusData({
    required this.isActive,
    this.bookTitle,
    this.currentEpisodeTitle,
    required this.currentSentence,
    required this.totalSentences,
    required this.percentage,
    required this.episodeCount,
    required this.statusText,
    required this.reviewPendingCount,
    required this.apiErrorsTotal,
    required this.apiErrorsSummary,
    required this.apiErrorsByType,
    required this.updatedAt,
  });

  factory DashboardStatusData.fromJson(Map<String, dynamic> json) {
    final apiErrors = json['api_errors'] as Map<String, dynamic>? ?? {};
    return DashboardStatusData(
      isActive: json['is_active'] as bool? ?? false,
      bookTitle: json['book_title'] as String?,
      currentEpisodeTitle: json['current_episode_title'] as String?,
      currentSentence: (json['current_sentence'] as num?)?.toInt() ?? 0,
      totalSentences: (json['total_sentences'] as num?)?.toInt() ?? 0,
      percentage: (json['percentage'] as num?)?.toInt() ?? 0,
      episodeCount: (json['episode_count'] as num?)?.toInt() ?? 0,
      statusText: json['status_text'] as String? ?? '대기 중',
      reviewPendingCount: (json['review_pending_count'] as num?)?.toInt() ?? 0,
      apiErrorsTotal: (apiErrors['total'] as num?)?.toInt() ?? 0,
      apiErrorsSummary: apiErrors['summary_text'] as String? ?? '오류 없음',
      apiErrorsByType: (apiErrors['by_type'] as Map<String, dynamic>?) ?? {},
      updatedAt: (json['updated_at'] as num?)?.toInt() ?? 0,
    );
  }
}

class StatusDashboardService {
  static final ValueNotifier<DashboardStatusData?> currentStatus =
      ValueNotifier<DashboardStatusData?>(null);

  static Timer? _pollingTimer;
  static bool _isRunning = false;

  /// 대시보드 상태 동기화 서비스 시작 (초절전 15분 주기)
  static void start() {
    if (_isRunning) return;
    _isRunning = true;

    // 시작 시 즉시 1회 확인
    syncStatus();

    // 15분 주기 초절전 스마트 폴링 (배터리 소모 사실상 0)
    _pollingTimer?.cancel();
    _pollingTimer = Timer.periodic(const Duration(minutes: 15), (_) {
      syncStatus();
    });
  }

  /// 서비스 중지
  static void stop() {
    _isRunning = false;
    _pollingTimer?.cancel();
    _pollingTimer = null;
    _activeFastPollingTimer?.cancel();
    _activeFastPollingTimer = null;
  }

  static Timer? _activeFastPollingTimer;

  /// 앱 포그라운드 활성 상태 진입 시 (5초 주기 실시간 반영)
  static void enterForeground() {
    syncStatus();
    _activeFastPollingTimer?.cancel();
    _activeFastPollingTimer = Timer.periodic(const Duration(seconds: 5), (_) {
      syncStatus();
    });
  }

  /// 앱 백그라운드 전환 시 (15분 초절전 주기로 복귀)
  static void enterBackground() {
    _activeFastPollingTimer?.cancel();
    _activeFastPollingTimer = null;
  }

  /// 서버로부터 최신 종합 상태 조회 및 안드로이드 단일 대시보드 알림창 갱신
  static Future<DashboardStatusData?> syncStatus() async {
    try {
      final serverUrl = PreferencesService.serverUrl;
      final uri = Uri.parse('$serverUrl/api/status/summary');
      final res = await http.get(uri).timeout(const Duration(seconds: 4));

      if (res.statusCode == 200) {
        final data = DashboardStatusData.fromJson(
          jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>,
        );
        currentStatus.value = data;

        // 알림창 갱신 로직 (사용자 확인 코멘트 반영):
        // 1. 번역 작업이 없고 검수/오류도 없는 완전 대기 상태면 알림창을 아예 띄우지 않음(닫기)
        // 2. 작업이 진행 중이거나, 검수 대기 또는 API 오류가 있을 때만 단 1개의 현황판 카드로 노출
        if (PreferencesService.enableDashboardNotification) {
          if (!data.isActive && data.reviewPendingCount == 0 && data.apiErrorsTotal == 0) {
            await LocalNotificationService.cancelDashboardNotification();
          } else {
            final bookName = data.bookTitle ?? '번역 작업';
            final title = data.isActive
                ? '📚 LANOVEL 작업 현황: $bookName (${data.percentage}%)'
                : '📚 LANOVEL 작업 현황 (검수/오류 대기)';

            final detailLines = <String>[];
            if (data.isActive) {
              detailLines.add('• 진행: ${data.statusText}');
            } else {
              detailLines.add('• 상태: 번역 대기 중');
            }

            // 제미나이 API 오류 메시지 및 종류별 통계 노출
            detailLines.add('• Gemini API 오류: ${data.apiErrorsSummary}');

            // 검수 대기 항목 수
            if (data.reviewPendingCount > 0) {
              detailLines.add('• ⚠️ 검수 대기: ${data.reviewPendingCount}건 (탭하여 확인)');
            }

            final body = detailLines.join(' | ');

            await LocalNotificationService.updateDashboardNotification(
              title: title,
              body: body,
              progress: data.percentage,
              maxProgress: 100,
              detailLines: detailLines,
              payload: jsonEncode({
                'book_title': data.bookTitle,
                'chapter_title': data.currentEpisodeTitle,
              }),
            );
          }
        } else {
          await LocalNotificationService.cancelDashboardNotification();
        }

        return data;
      }
    } catch (e) {
      if (kDebugMode) {
        print('[StatusDashboardService] syncStatus failed: $e');
      }
    }
    return currentStatus.value;
  }
}
