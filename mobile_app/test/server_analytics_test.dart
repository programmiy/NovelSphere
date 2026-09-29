import 'package:flutter_test/flutter_test.dart';
import 'package:lanovel_reader/models/server_analytics.dart';

void main() {
  group('ServerAnalyticsData JSON deserialization test', () {
    test('successfully parses full analytics payload', () {
      final jsonSample = {
        "status": "success",
        "scope": "전체",
        "summary": {
          "total_books": 5,
          "total_episodes": 42,
          "total_paragraphs": 8900,
          "total_kr_chars": 750000,
          "total_jp_chars": 640000,
          "avg_chars_per_paragraph": 84.3,
          "avg_paragraphs_per_episode": 211.9,
          "avg_chars_per_episode": 17857.1,
          "expansion_ratio": 1.17
        },
        "activity": {
          "daily_avg_count": 450,
          "daily_avg_chars": 38000,
          "peak_count": 1100,
          "peak_date": "2026-09-28",
          "streak_days": 7,
          "last_7d_count": 3150,
          "last_7d_chars": 266000,
          "daily_trends": [
            {
              "date": "2026-09-28",
              "count": 500,
              "kr_chars": 42000,
              "jp_chars": 36000,
              "cum_count": 500,
              "cum_chars": 42000,
              "ma7_count": 500.0,
              "ma7_chars": 42000.0
            }
          ],
          "hourly_distribution": [
            {"hour": 14, "count": 120, "pct": 1.3}
          ],
          "peak_hour": 21,
          "peak_hour_count": 350,
          "dow_distribution": [
            {
              "dow": 1,
              "name": "월요일",
              "short_name": "월",
              "count": 1500,
              "chars": 120000,
              "pct": 16.9
            }
          ],
          "peak_dow": "월요일",
          "peak_dow_count": 1500,
          "weekday_count": 6500,
          "weekend_count": 2400,
          "weekday_pct": 73.0,
          "weekend_pct": 27.0
        },
        "quality": {
          "health_score": 98,
          "normal_rate": 99.5,
          "empty_count": 5,
          "empty_rate": 0.5,
          "abnormal_rate": 0.2,
          "applied_rate": 92.0,
          "trash_count": 10,
          "whitelist_count": 3,
          "pending_folder_count": 0,
          "abnormal_total_count": 10,
          "length_distribution": [
            {
              "tier": 1,
              "label": "초단문 (0~30자)",
              "count": 900,
              "pct": 10.1,
              "desc": "짧은 감탄사"
            }
          ]
        },
        "scale": {
          "books_count": 7.5,
          "manuscript_count": 3750,
          "reading_hours": 25.0,
          "reading_days": 1.0,
          "novel_fit_badge": "최적 (3,000~4,500자 표준)",
          "pace_fast_hours": 15.6,
          "pace_slow_hours": 35.7
        },
        "novels": [
          {
            "rank": 1,
            "name": "마도서 번역기록",
            "episode_count": 20,
            "paragraph_count": 4500,
            "total_chars": 380000,
            "avg_paragraphs_per_ep": 225.0,
            "share_pct": 50.6
          }
        ]
      };

      final data = ServerAnalyticsData.fromJson(jsonSample);

      expect(data.scope, '전체');
      expect(data.summary.totalBooks, 5);
      expect(data.summary.totalEpisodes, 42);
      expect(data.summary.totalParagraphs, 8900);
      expect(data.summary.totalKrChars, 750000);
      expect(data.summary.expansionRatio, 1.17);

      expect(data.activity.streakDays, 7);
      expect(data.activity.peakDate, '2026-09-28');
      expect(data.activity.dailyTrends.length, 1);
      expect(data.activity.dowDistribution.first.name, '월요일');

      expect(data.quality.healthScore, 98);
      expect(data.quality.normalRate, 99.5);
      expect(data.scale.booksCount, 7.5);

      expect(data.novels.length, 1);
      expect(data.novels.first.name, '마도서 번역기록');
      expect(data.novels.first.sharePct, 50.6);
    });

    test('handles empty or missing nested fields with fallback defaults', () {
      final data = ServerAnalyticsData.fromJson({});
      expect(data.scope, '전체');
      expect(data.summary.totalBooks, 0);
      expect(data.activity.streakDays, 0);
      expect(data.quality.healthScore, 100);
      expect(data.scale.novelFitBadge, '최적 분량');
      expect(data.novels, isEmpty);
    });
  });
}
