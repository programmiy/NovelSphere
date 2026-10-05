class AnalyticsSummary {
  final int totalBooks;
  final int totalEpisodes;
  final int totalParagraphs;
  final int totalKrChars;
  final int totalJpChars;
  final int todayEpisodes;
  final int todayParagraphs;
  final int todayKrChars;
  final double avgCharsPerParagraph;
  final double avgParagraphsPerEpisode;
  final double avgCharsPerEpisode;
  final double expansionRatio;

  AnalyticsSummary({
    required this.totalBooks,
    required this.totalEpisodes,
    required this.totalParagraphs,
    required this.totalKrChars,
    required this.totalJpChars,
    this.todayEpisodes = 0,
    this.todayParagraphs = 0,
    this.todayKrChars = 0,
    required this.avgCharsPerParagraph,
    required this.avgParagraphsPerEpisode,
    required this.avgCharsPerEpisode,
    required this.expansionRatio,
  });

  factory AnalyticsSummary.fromJson(Map<String, dynamic> json) {
    return AnalyticsSummary(
      totalBooks: (json['total_books'] as num?)?.toInt() ?? 0,
      totalEpisodes: (json['total_episodes'] as num?)?.toInt() ?? 0,
      totalParagraphs: (json['total_paragraphs'] as num?)?.toInt() ?? 0,
      totalKrChars: (json['total_kr_chars'] as num?)?.toInt() ?? 0,
      totalJpChars: (json['total_jp_chars'] as num?)?.toInt() ?? 0,
      todayEpisodes: (json['today_episodes'] as num?)?.toInt() ?? 0,
      todayParagraphs: (json['today_paragraphs'] as num?)?.toInt() ?? 0,
      todayKrChars: (json['today_kr_chars'] as num?)?.toInt() ?? 0,
      avgCharsPerParagraph: (json['avg_chars_per_paragraph'] as num?)?.toDouble() ?? 0.0,
      avgParagraphsPerEpisode: (json['avg_paragraphs_per_episode'] as num?)?.toDouble() ?? 0.0,
      avgCharsPerEpisode: (json['avg_chars_per_episode'] as num?)?.toDouble() ?? 0.0,
      expansionRatio: (json['expansion_ratio'] as num?)?.toDouble() ?? 1.16,
    );
  }
}

class DailyTrendItem {
  final String date;
  final int count;
  final int krChars;
  final int jpChars;
  final int cumCount;
  final int cumChars;
  final double ma7Count;
  final double ma7Chars;

  DailyTrendItem({
    required this.date,
    required this.count,
    required this.krChars,
    required this.jpChars,
    required this.cumCount,
    required this.cumChars,
    required this.ma7Count,
    required this.ma7Chars,
  });

  factory DailyTrendItem.fromJson(Map<String, dynamic> json) {
    return DailyTrendItem(
      date: json['date'] as String? ?? '',
      count: (json['count'] as num?)?.toInt() ?? 0,
      krChars: (json['kr_chars'] as num?)?.toInt() ?? 0,
      jpChars: (json['jp_chars'] as num?)?.toInt() ?? 0,
      cumCount: (json['cum_count'] as num?)?.toInt() ?? 0,
      cumChars: (json['cum_chars'] as num?)?.toInt() ?? 0,
      ma7Count: (json['ma7_count'] as num?)?.toDouble() ?? 0.0,
      ma7Chars: (json['ma7_chars'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class DowDistributionItem {
  final int dow;
  final String name;
  final String shortName;
  final int count;
  final int chars;
  final double pct;

  DowDistributionItem({
    required this.dow,
    required this.name,
    required this.shortName,
    required this.count,
    required this.chars,
    required this.pct,
  });

  factory DowDistributionItem.fromJson(Map<String, dynamic> json) {
    return DowDistributionItem(
      dow: (json['dow'] as num?)?.toInt() ?? 0,
      name: json['name'] as String? ?? '',
      shortName: json['short_name'] as String? ?? '',
      count: (json['count'] as num?)?.toInt() ?? 0,
      chars: (json['chars'] as num?)?.toInt() ?? 0,
      pct: (json['pct'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class HourlyDistributionItem {
  final int hour;
  final int count;
  final double pct;

  HourlyDistributionItem({
    required this.hour,
    required this.count,
    required this.pct,
  });

  factory HourlyDistributionItem.fromJson(Map<String, dynamic> json) {
    return HourlyDistributionItem(
      hour: (json['hour'] as num?)?.toInt() ?? 0,
      count: (json['count'] as num?)?.toInt() ?? 0,
      pct: (json['pct'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class AnalyticsActivity {
  final int todayEpisodes;
  final int todayParagraphs;
  final int todayKrChars;
  final int dailyAvgCount;
  final int dailyAvgChars;
  final int peakCount;
  final String peakDate;
  final int streakDays;
  final int last7dCount;
  final int last7dChars;
  final int peakHour;
  final int peakHourCount;
  final String peakDow;
  final int peakDowCount;
  final double weekdayPct;
  final double weekendPct;
  final List<DailyTrendItem> dailyTrends;
  final List<DowDistributionItem> dowDistribution;
  final List<HourlyDistributionItem> hourlyDistribution;

  AnalyticsActivity({
    this.todayEpisodes = 0,
    this.todayParagraphs = 0,
    this.todayKrChars = 0,
    required this.dailyAvgCount,
    required this.dailyAvgChars,
    required this.peakCount,
    required this.peakDate,
    required this.streakDays,
    required this.last7dCount,
    required this.last7dChars,
    required this.peakHour,
    required this.peakHourCount,
    required this.peakDow,
    required this.peakDowCount,
    required this.weekdayPct,
    required this.weekendPct,
    required this.dailyTrends,
    required this.dowDistribution,
    required this.hourlyDistribution,
  });

  factory AnalyticsActivity.fromJson(Map<String, dynamic> json) {
    return AnalyticsActivity(
      todayEpisodes: (json['today_episodes'] as num?)?.toInt() ?? 0,
      todayParagraphs: (json['today_paragraphs'] as num?)?.toInt() ?? 0,
      todayKrChars: (json['today_kr_chars'] as num?)?.toInt() ?? 0,
      dailyAvgCount: (json['daily_avg_count'] as num?)?.toInt() ?? 0,
      dailyAvgChars: (json['daily_avg_chars'] as num?)?.toInt() ?? 0,
      peakCount: (json['peak_count'] as num?)?.toInt() ?? 0,
      peakDate: json['peak_date'] as String? ?? '-',
      streakDays: (json['streak_days'] as num?)?.toInt() ?? 0,
      last7dCount: (json['last_7d_count'] as num?)?.toInt() ?? 0,
      last7dChars: (json['last_7d_chars'] as num?)?.toInt() ?? 0,
      peakHour: (json['peak_hour'] as num?)?.toInt() ?? 0,
      peakHourCount: (json['peak_hour_count'] as num?)?.toInt() ?? 0,
      peakDow: json['peak_dow'] as String? ?? '-',
      peakDowCount: (json['peak_dow_count'] as num?)?.toInt() ?? 0,
      weekdayPct: (json['weekday_pct'] as num?)?.toDouble() ?? 0.0,
      weekendPct: (json['weekend_pct'] as num?)?.toDouble() ?? 0.0,
      dailyTrends: (json['daily_trends'] as List<dynamic>?)
              ?.map((e) => DailyTrendItem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      dowDistribution: (json['dow_distribution'] as List<dynamic>?)
              ?.map((e) => DowDistributionItem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
      hourlyDistribution: (json['hourly_distribution'] as List<dynamic>?)
              ?.map((e) => HourlyDistributionItem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class LengthDistributionItem {
  final int tier;
  final String label;
  final int count;
  final double pct;
  final String desc;

  LengthDistributionItem({
    required this.tier,
    required this.label,
    required this.count,
    required this.pct,
    required this.desc,
  });

  factory LengthDistributionItem.fromJson(Map<String, dynamic> json) {
    return LengthDistributionItem(
      tier: (json['tier'] as num?)?.toInt() ?? 0,
      label: json['label'] as String? ?? '',
      count: (json['count'] as num?)?.toInt() ?? 0,
      pct: (json['pct'] as num?)?.toDouble() ?? 0.0,
      desc: json['desc'] as String? ?? '',
    );
  }
}

class AnalyticsQuality {
  final int healthScore;
  final double normalRate;
  final int emptyCount;
  final double emptyRate;
  final double abnormalRate;
  final int abnormalTotalCount;
  final double appliedRate;
  final int trashCount;
  final int whitelistCount;
  final int pendingFolderCount;
  final List<LengthDistributionItem> lengthDistribution;

  AnalyticsQuality({
    required this.healthScore,
    required this.normalRate,
    required this.emptyCount,
    required this.emptyRate,
    required this.abnormalRate,
    required this.abnormalTotalCount,
    required this.appliedRate,
    required this.trashCount,
    required this.whitelistCount,
    required this.pendingFolderCount,
    required this.lengthDistribution,
  });

  factory AnalyticsQuality.fromJson(Map<String, dynamic> json) {
    return AnalyticsQuality(
      healthScore: (json['health_score'] as num?)?.toInt() ?? 100,
      normalRate: (json['normal_rate'] as num?)?.toDouble() ?? 100.0,
      emptyCount: (json['empty_count'] as num?)?.toInt() ?? 0,
      emptyRate: (json['empty_rate'] as num?)?.toDouble() ?? 0.0,
      abnormalRate: (json['abnormal_rate'] as num?)?.toDouble() ?? 0.0,
      abnormalTotalCount: (json['abnormal_total_count'] as num?)?.toInt() ?? 0,
      appliedRate: (json['applied_rate'] as num?)?.toDouble() ?? 0.0,
      trashCount: (json['trash_count'] as num?)?.toInt() ?? 0,
      whitelistCount: (json['whitelist_count'] as num?)?.toInt() ?? 0,
      pendingFolderCount: (json['pending_folder_count'] as num?)?.toInt() ?? 0,
      lengthDistribution: (json['length_distribution'] as List<dynamic>?)
              ?.map((e) => LengthDistributionItem.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}

class AnalyticsScale {
  final double booksCount;
  final int manuscriptCount;
  final double readingHours;
  final double readingDays;
  final String novelFitBadge;
  final double paceFastHours;
  final double paceSlowHours;

  AnalyticsScale({
    required this.booksCount,
    required this.manuscriptCount,
    required this.readingHours,
    required this.readingDays,
    required this.novelFitBadge,
    required this.paceFastHours,
    required this.paceSlowHours,
  });

  factory AnalyticsScale.fromJson(Map<String, dynamic> json) {
    return AnalyticsScale(
      booksCount: (json['books_count'] as num?)?.toDouble() ?? 0.0,
      manuscriptCount: (json['manuscript_count'] as num?)?.toInt() ?? 0,
      readingHours: (json['reading_hours'] as num?)?.toDouble() ?? 0.0,
      readingDays: (json['reading_days'] as num?)?.toDouble() ?? 0.0,
      novelFitBadge: json['novel_fit_badge'] as String? ?? '최적 분량',
      paceFastHours: (json['pace_fast_hours'] as num?)?.toDouble() ?? 0.0,
      paceSlowHours: (json['pace_slow_hours'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class AnalyticsNovelRank {
  final int rank;
  final String name;
  final int episodeCount;
  final int paragraphCount;
  final int totalChars;
  final double avgParagraphsPerEp;
  final double sharePct;

  AnalyticsNovelRank({
    required this.rank,
    required this.name,
    required this.episodeCount,
    required this.paragraphCount,
    required this.totalChars,
    required this.avgParagraphsPerEp,
    required this.sharePct,
  });

  factory AnalyticsNovelRank.fromJson(Map<String, dynamic> json) {
    return AnalyticsNovelRank(
      rank: (json['rank'] as num?)?.toInt() ?? 0,
      name: json['name'] as String? ?? '',
      episodeCount: (json['episode_count'] as num?)?.toInt() ?? 0,
      paragraphCount: (json['paragraph_count'] as num?)?.toInt() ?? 0,
      totalChars: (json['total_chars'] as num?)?.toInt() ?? 0,
      avgParagraphsPerEp: (json['avg_paragraphs_per_ep'] as num?)?.toDouble() ?? 0.0,
      sharePct: (json['share_pct'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

class ServerAnalyticsData {
  final String scope;
  final AnalyticsSummary summary;
  final AnalyticsActivity activity;
  final AnalyticsQuality quality;
  final AnalyticsScale scale;
  final List<AnalyticsNovelRank> novels;

  ServerAnalyticsData({
    required this.scope,
    required this.summary,
    required this.activity,
    required this.quality,
    required this.scale,
    required this.novels,
  });

  factory ServerAnalyticsData.fromJson(Map<String, dynamic> json) {
    return ServerAnalyticsData(
      scope: json['scope'] as String? ?? '전체',
      summary: AnalyticsSummary.fromJson(json['summary'] as Map<String, dynamic>? ?? {}),
      activity: AnalyticsActivity.fromJson(json['activity'] as Map<String, dynamic>? ?? {}),
      quality: AnalyticsQuality.fromJson(json['quality'] as Map<String, dynamic>? ?? {}),
      scale: AnalyticsScale.fromJson(json['scale'] as Map<String, dynamic>? ?? {}),
      novels: (json['novels'] as List<dynamic>?)
              ?.map((e) => AnalyticsNovelRank.fromJson(e as Map<String, dynamic>))
              .toList() ??
          [],
    );
  }
}
