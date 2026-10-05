import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../models/server_analytics.dart';
import '../../services/server_analytics_service.dart';
import '../settings/settings_screen.dart';
import '../themes/reader_themes.dart';

class ServerAnalyticsView extends StatefulWidget {
  final ReaderThemeData theme;

  const ServerAnalyticsView({super.key, required this.theme});

  @override
  State<ServerAnalyticsView> createState() => _ServerAnalyticsViewState();
}

class _ServerAnalyticsViewState extends State<ServerAnalyticsView> {
  bool _isLoading = true;
  String? _errorMessage;
  ServerAnalyticsData? _analyticsData;
  String _selectedScope = '__all__';
  final NumberFormat _fmt = NumberFormat('#,###');

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final data = await ServerAnalyticsService.fetchAnalytics(
      folderName: _selectedScope == '__all__' ? null : _selectedScope,
    );

    if (!mounted) return;

    if (data == null) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'PC 서버와 통신할 수 없습니다.\n서버가 실행 중이고 같은 Wi-Fi에 연결되어 있는지 확인해 주세요.';
      });
    } else {
      setState(() {
        _analyticsData = data;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;

    if (_isLoading && _analyticsData == null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: theme.accentColor),
            const SizedBox(height: 16),
            Text(
              '서버 번역 통계 데이터 불러오는 중...',
              style: TextStyle(color: theme.subTextColor, fontSize: 13),
            ),
          ],
        ),
      );
    }

    if (_errorMessage != null && _analyticsData == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.cloud_off_rounded, size: 56, color: theme.subTextColor.withOpacity(0.5)),
              const SizedBox(height: 16),
              Text(
                '서버 연결 대기 중',
                style: TextStyle(color: theme.textColor, fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                _errorMessage!,
                textAlign: TextAlign.center,
                style: TextStyle(color: theme.subTextColor, fontSize: 13, height: 1.5),
              ),
              const SizedBox(height: 20),
              Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  ElevatedButton.icon(
                    onPressed: _loadData,
                    icon: const Icon(Icons.refresh_rounded, size: 18),
                    label: const Text('다시 시도'),
                    style: ElevatedButton.styleFrom(
                      backgroundColor: theme.accentColor,
                      foregroundColor: Colors.white,
                    ),
                  ),
                  const SizedBox(width: 12),
                  OutlinedButton.icon(
                    onPressed: () {
                      Navigator.push(
                        context,
                        MaterialPageRoute(
                          builder: (_) => SettingsScreen(onThemeChanged: () => setState(() {})),
                        ),
                      ).then((_) => _loadData());
                    },
                    icon: const Icon(Icons.settings_rounded, size: 18),
                    label: const Text('서버 설정'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: theme.textColor,
                      side: BorderSide(color: theme.borderColor),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
    }

    final data = _analyticsData!;
    final summary = data.summary;
    final activity = data.activity;
    final quality = data.quality;
    final scale = data.scale;

    return RefreshIndicator(
      onRefresh: _loadData,
      color: theme.accentColor,
      backgroundColor: theme.surfaceColor,
      child: ListView(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
        children: [
          // 1. 헤더 & 스코프 선택
          _buildScopeSelector(theme, data),
          const SizedBox(height: 14),

          // 2. 오늘 번역 하이라이트 배너
          _buildTodayBanner(theme, summary),
          const SizedBox(height: 14),

          // 3. 종합 요약 KPI 그리드 (2x2)
          _buildKpiGrid(theme, summary),
          const SizedBox(height: 14),

          // 3. 번역 규모 & 독서 시간 환산 카드
          _buildScaleCard(theme, summary, scale),
          const SizedBox(height: 14),

          // 4. 데이터 품질 & 건강도 카드
          _buildQualityCard(theme, quality),
          const SizedBox(height: 14),

          // 5. 생산성 & 활동 프로필 카드
          _buildActivityCard(theme, activity),
          const SizedBox(height: 14),

          // 6. 요일별 생산성 분포 (월~일)
          if (activity.dowDistribution.isNotEmpty) ...[
            _buildDowChart(theme, activity.dowDistribution),
            const SizedBox(height: 14),
          ],

          // 7. 최근 일별 번역 활동 추이 (바 차트)
          if (activity.dailyTrends.isNotEmpty) ...[
            _buildTrendsChart(theme, activity.dailyTrends),
            const SizedBox(height: 14),
          ],

          // 8. 작품별 심층 번역 랭킹
          if (data.novels.isNotEmpty) ...[
            _buildNovelsRanking(theme, data.novels),
            const SizedBox(height: 24),
          ],
        ],
      ),
    );
  }

  Widget _buildTodayBanner(ReaderThemeData theme, AnalyticsSummary summary) {
    final hasToday = summary.todayEpisodes > 0;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [
            Colors.deepOrange.withOpacity(hasToday ? 0.12 : 0.05),
            theme.surfaceColor,
          ],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: hasToday ? Colors.deepOrange.withOpacity(0.5) : theme.borderColor,
          width: hasToday ? 1.5 : 1.0,
        ),
      ),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(
              color: hasToday 
                  ? Colors.deepOrange.withOpacity(0.18) 
                  : theme.subTextColor.withOpacity(0.1),
              shape: BoxShape.circle,
            ),
            child: Icon(
              Icons.local_fire_department_rounded,
              color: hasToday ? Colors.deepOrange : theme.subTextColor,
              size: 26,
            ),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text(
                      '오늘 번역한 페이지 (회차)',
                      style: TextStyle(
                        color: hasToday ? Colors.deepOrange : theme.subTextColor,
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const Spacer(),
                    if (hasToday)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: Colors.deepOrange,
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: const Text(
                          'TODAY',
                          style: TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold),
                        ),
                      ),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.baseline,
                  textBaseline: TextBaseline.alphabetic,
                  children: [
                    Text(
                      _fmt.format(summary.todayEpisodes),
                      style: TextStyle(
                        color: theme.textColor,
                        fontSize: 24,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    Text(
                      ' 화 (페이지)',
                      style: TextStyle(
                        color: theme.subTextColor,
                        fontSize: 13,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 2),
                Text(
                  hasToday
                      ? '${_fmt.format(summary.todayParagraphs)}개 문단 · ${_fmt.format(summary.todayKrChars)}자 번역'
                      : '오늘 아직 번역된 회차가 없습니다.',
                  style: TextStyle(
                    color: theme.subTextColor.withOpacity(0.85),
                    fontSize: 11,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildScopeSelector(ReaderThemeData theme, ServerAnalyticsData data) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderColor),
      ),
      child: Row(
        children: [
          Icon(Icons.filter_alt_outlined, color: theme.accentColor, size: 20),
          const SizedBox(width: 8),
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _selectedScope,
                isExpanded: true,
                dropdownColor: theme.surfaceColor,
                style: TextStyle(color: theme.textColor, fontSize: 13, fontWeight: FontWeight.w600),
                icon: Icon(Icons.arrow_drop_down, color: theme.subTextColor),
                items: [
                  const DropdownMenuItem(
                    value: '__all__',
                    child: Text('🌐 전체 작품 종합 분석'),
                  ),
                  ...data.novels.map((n) => DropdownMenuItem(
                        value: n.name,
                        child: Text('📖 ${n.name}'),
                      )),
                ],
                onChanged: (val) {
                  if (val != null && val != _selectedScope) {
                    setState(() {
                      _selectedScope = val;
                    });
                    _loadData();
                  }
                },
              ),
            ),
          ),
          IconButton(
            icon: Icon(Icons.refresh_rounded, color: theme.subTextColor, size: 20),
            tooltip: '통계 새로고침',
            onPressed: _loadData,
          ),
        ],
      ),
    );
  }

  Widget _buildKpiGrid(ReaderThemeData theme, AnalyticsSummary summary) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: _buildKpiTile(
                theme: theme,
                icon: Icons.library_books_rounded,
                title: '번역 작품 수',
                value: '${_fmt.format(summary.totalBooks)}개 소설',
                subText: '등록된 전체 도서',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _buildKpiTile(
                theme: theme,
                icon: Icons.auto_stories_rounded,
                title: '누적 번역 회차',
                value: '${_fmt.format(summary.totalEpisodes)}화',
                subText: '화당 ${_fmt.format(summary.avgCharsPerEpisode.toInt())}자',
              ),
            ),
          ],
        ),
        const SizedBox(height: 10),
        Row(
          children: [
            Expanded(
              child: _buildKpiTile(
                theme: theme,
                icon: Icons.text_snippet_rounded,
                title: '누적 번역 문단',
                value: '${_fmt.format(summary.totalParagraphs)}문단',
                subText: '평균 ${summary.avgCharsPerParagraph}자/문단',
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: _buildKpiTile(
                theme: theme,
                icon: Icons.translate_rounded,
                title: '한국어 번역 글자',
                value: '${(summary.totalKrChars / 10000).toStringAsFixed(1)}만 자',
                subText: '원문 대비 ${summary.expansionRatio}x 확장',
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildKpiTile({
    required ReaderThemeData theme,
    required IconData icon,
    required String title,
    required String value,
    required String subText,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(icon, size: 16, color: theme.accentColor),
              const SizedBox(width: 6),
              Text(
                title,
                style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.w500),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(color: theme.textColor, fontSize: 16, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 2),
          Text(
            subText,
            style: TextStyle(color: theme.subTextColor.withOpacity(0.8), fontSize: 10),
          ),
        ],
      ),
    );
  }

  Widget _buildScaleCard(ReaderThemeData theme, AnalyticsSummary summary, AnalyticsScale scale) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.menu_book_rounded, color: theme.accentColor, size: 20),
              const SizedBox(width: 8),
              Text(
                '번역 규모 & 독서 시간 환산',
                style: TextStyle(color: theme.textColor, fontSize: 15, fontWeight: FontWeight.bold),
              ),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: theme.accentColor.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  scale.novelFitBadge,
                  style: TextStyle(color: theme.accentColor, fontSize: 10, fontWeight: FontWeight.bold),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: _buildScaleItem(theme, '📖 단행본 환산', '약 ${scale.booksCount}권', '권당 10만 자 기준'),
              ),
              Expanded(
                child: _buildScaleItem(theme, '📝 200자 원고지', '${_fmt.format(scale.manuscriptCount)}매', '표준 원고지 기준'),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Row(
            children: [
              Expanded(
                child: _buildScaleItem(theme, '⏱️ 완독 예상 소요', '약 ${scale.readingHours}시간', '약 ${scale.readingDays}일 연속 완독'),
              ),
              Expanded(
                child: _buildScaleItem(theme, '⚡ 속독 / 정독', '${scale.paceFastHours}h / ${scale.paceSlowHours}h', '800자 / 350자 페이스'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildScaleItem(ReaderThemeData theme, String label, String value, String desc) {
    return Container(
      margin: const EdgeInsets.all(4),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: theme.background,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: theme.borderColor.withOpacity(0.6)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: TextStyle(color: theme.subTextColor, fontSize: 10)),
          const SizedBox(height: 4),
          Text(value, style: TextStyle(color: theme.textColor, fontSize: 13, fontWeight: FontWeight.bold)),
          const SizedBox(height: 2),
          Text(desc, style: TextStyle(color: theme.subTextColor.withOpacity(0.7), fontSize: 9)),
        ],
      ),
    );
  }

  Widget _buildQualityCard(ReaderThemeData theme, AnalyticsQuality quality) {
    final score = quality.healthScore;
    Color scoreColor = Colors.green;
    if (score < 70) {
      scoreColor = Colors.redAccent;
    } else if (score < 85) {
      scoreColor = Colors.orangeAccent;
    } else if (score < 95) {
      scoreColor = Colors.teal;
    }

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.verified_user_rounded, color: theme.accentColor, size: 20),
              const SizedBox(width: 8),
              Text(
                '데이터 품질 & 무결성 건강도',
                style: TextStyle(color: theme.textColor, fontSize: 15, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              // 건강도 점수 원형 표시
              Container(
                width: 72,
                height: 72,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: scoreColor.withOpacity(0.12),
                  border: Border.all(color: scoreColor, width: 3),
                ),
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(
                        '$score',
                        style: TextStyle(color: scoreColor, fontSize: 20, fontWeight: FontWeight.bold),
                      ),
                      Text(
                        '100점 만점',
                        style: TextStyle(color: scoreColor.withOpacity(0.8), fontSize: 8),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(width: 16),
              // 세부 품질 지표
              Expanded(
                child: Column(
                  children: [
                    _buildQualityRow(theme, '정상 번역률', '${quality.normalRate}%', Colors.green),
                    const SizedBox(height: 6),
                    _buildQualityRow(
                      theme,
                      '결측/빈 번역문',
                      '${_fmt.format(quality.emptyCount)}건 (${quality.emptyRate}%)',
                      quality.emptyCount > 0 ? Colors.orangeAccent : Colors.grey,
                    ),
                    const SizedBox(height: 6),
                    _buildQualityRow(
                      theme,
                      '이상번역 감지',
                      '${_fmt.format(quality.abnormalTotalCount)}건 (${quality.abnormalRate}%)',
                      quality.abnormalTotalCount > 0 ? Colors.redAccent : Colors.grey,
                    ),
                    const SizedBox(height: 6),
                    _buildQualityRow(theme, '웹페이지 적용률', '${quality.appliedRate}%', theme.accentColor),
                  ],
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildQualityRow(ReaderThemeData theme, String label, String value, Color color) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: TextStyle(color: theme.subTextColor, fontSize: 12)),
        Text(
          value,
          style: TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.bold),
        ),
      ],
    );
  }

  Widget _buildActivityCard(ReaderThemeData theme, AnalyticsActivity activity) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.bolt_rounded, color: theme.accentColor, size: 20),
              const SizedBox(width: 8),
              Text(
                '활동 & 생산성 프로필',
                style: TextStyle(color: theme.textColor, fontSize: 15, fontWeight: FontWeight.bold),
              ),
              const Spacer(),
              if (activity.streakDays > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.deepOrange.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    children: [
                      const Icon(Icons.local_fire_department_rounded, color: Colors.deepOrange, size: 14),
                      const SizedBox(width: 2),
                      Text(
                        '${activity.streakDays}일 연속 활동',
                        style: const TextStyle(color: Colors.deepOrange, fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
            ],
          ),
          const SizedBox(height: 12),
          _buildActivityMetric(
            theme,
            '일평균 생산량',
            '${_fmt.format(activity.dailyAvgCount)}문단 (${_fmt.format(activity.dailyAvgChars)}자/일)',
          ),
          const SizedBox(height: 8),
          _buildActivityMetric(
            theme,
            '역대 최고 기록일',
            '${activity.peakDate} (${_fmt.format(activity.peakCount)}문단)',
          ),
          const SizedBox(height: 8),
          _buildActivityMetric(
            theme,
            '가장 활발한 요일 & 시간대',
            '${activity.peakDow} (${_fmt.format(activity.peakDowCount)}문단) / ${activity.peakHour}시 (${_fmt.format(activity.peakHourCount)}문단)',
          ),
          const SizedBox(height: 12),
          // 평일 vs 주말 비중 막대
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    '평일 ${activity.weekdayPct}%',
                    style: TextStyle(color: theme.subTextColor, fontSize: 11),
                  ),
                  Text(
                    '주말 ${activity.weekendPct}%',
                    style: TextStyle(color: theme.subTextColor, fontSize: 11),
                  ),
                ],
              ),
              const SizedBox(height: 4),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: SizedBox(
                  height: 6,
                  child: Row(
                    children: [
                      Expanded(
                        flex: math.max(1, (activity.weekdayPct * 10).toInt()),
                        child: Container(color: theme.accentColor),
                      ),
                      Expanded(
                        flex: math.max(1, (activity.weekendPct * 10).toInt()),
                        child: Container(color: theme.accentColor.withOpacity(0.3)),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildActivityMetric(ReaderThemeData theme, String label, String value) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: TextStyle(color: theme.subTextColor, fontSize: 12)),
        Text(
          value,
          style: TextStyle(color: theme.textColor, fontSize: 12, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }

  Widget _buildDowChart(ReaderThemeData theme, List<DowDistributionItem> dowList) {
    final maxCount = dowList.map((e) => e.count).fold<int>(0, math.max);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.calendar_view_week_rounded, color: theme.accentColor, size: 20),
              const SizedBox(width: 8),
              Text(
                '요일별 생산성 분포 (월~일)',
                style: TextStyle(color: theme.textColor, fontSize: 15, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            crossAxisAlignment: CrossAxisAlignment.end,
            children: dowList.map((dow) {
              final double ratio = maxCount > 0 ? (dow.count / maxCount) : 0.0;
              final double barHeight = math.max(6.0, ratio * 70.0);
              final isWeekend = dow.dow == 0 || dow.dow == 6;

              return Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    '${dow.pct.toInt()}%',
                    style: TextStyle(
                      color: isWeekend ? Colors.deepOrange : theme.subTextColor,
                      fontSize: 9,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Container(
                    width: 24,
                    height: barHeight,
                    decoration: BoxDecoration(
                      color: isWeekend
                          ? Colors.deepOrange.withOpacity(0.85)
                          : theme.accentColor.withOpacity(0.85),
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    dow.shortName,
                    style: TextStyle(
                      color: isWeekend ? Colors.deepOrange : theme.textColor,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _buildTrendsChart(ReaderThemeData theme, List<DailyTrendItem> trends) {
    // 최근 최대 14일
    final recentTrends = trends.length > 14 ? trends.sublist(trends.length - 14) : trends;
    final maxCount = recentTrends.map((e) => e.count).fold<int>(0, math.max);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.show_chart_rounded, color: theme.accentColor, size: 20),
              const SizedBox(width: 8),
              Text(
                '최근 일별 번역량 추이',
                style: TextStyle(color: theme.textColor, fontSize: 15, fontWeight: FontWeight.bold),
              ),
              const Spacer(),
              Text(
                '최근 ${recentTrends.length}일',
                style: TextStyle(color: theme.subTextColor, fontSize: 11),
              ),
            ],
          ),
          const SizedBox(height: 14),
          SizedBox(
            height: 90,
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: recentTrends.map((t) {
                final ratio = maxCount > 0 ? (t.count / maxCount) : 0.0;
                final barHeight = math.max(6.0, ratio * 70.0);
                final dayLabel = t.date.length >= 5 ? t.date.substring(5) : t.date;

                return Expanded(
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 2),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.end,
                      children: [
                        Tooltip(
                          message: '${t.date}: ${_fmt.format(t.count)}문단 (${_fmt.format(t.krChars)}자)',
                          child: Container(
                            height: barHeight,
                            decoration: BoxDecoration(
                              color: theme.accentColor,
                              borderRadius: BorderRadius.circular(3),
                            ),
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          dayLabel,
                          style: TextStyle(
                            color: theme.subTextColor,
                            fontSize: 8,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNovelsRanking(ReaderThemeData theme, List<AnalyticsNovelRank> novels) {
    final topNovels = novels.take(10).toList();

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.military_tech_rounded, color: theme.accentColor, size: 20),
              const SizedBox(width: 8),
              Text(
                '작품별 번역 비중 & 랭킹',
                style: TextStyle(color: theme.textColor, fontSize: 15, fontWeight: FontWeight.bold),
              ),
            ],
          ),
          const SizedBox(height: 12),
          ...topNovels.map((n) {
            String medal = '${n.rank}';
            Color rankColor = theme.subTextColor;
            if (n.rank == 1) {
              medal = '🥇';
              rankColor = Colors.amber;
            } else if (n.rank == 2) {
              medal = '🥈';
              rankColor = Colors.blueGrey;
            } else if (n.rank == 3) {
              medal = '🥉';
              rankColor = Colors.brown;
            }

            return Padding(
              padding: const EdgeInsets.symmetric(vertical: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      SizedBox(
                        width: 24,
                        child: Text(
                          medal,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: rankColor,
                            fontSize: n.rank <= 3 ? 14 : 12,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(
                          n.name,
                          style: TextStyle(
                            color: theme.textColor,
                            fontSize: 13,
                            fontWeight: FontWeight.w600,
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      Text(
                        '${n.sharePct}%',
                        style: TextStyle(
                          color: theme.accentColor,
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        '${_fmt.format(n.episodeCount)}화 / ${_fmt.format(n.paragraphCount)}문단',
                        style: TextStyle(color: theme.subTextColor, fontSize: 11),
                      ),
                      Text(
                        '${_fmt.format(n.totalChars)}자',
                        style: TextStyle(color: theme.subTextColor, fontSize: 11),
                      ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  ClipRRect(
                    borderRadius: BorderRadius.circular(2),
                    child: LinearProgressIndicator(
                      value: (n.sharePct / 100.0).clamp(0.0, 1.0),
                      backgroundColor: theme.borderColor.withOpacity(0.5),
                      valueColor: AlwaysStoppedAnimation<Color>(theme.accentColor),
                      minHeight: 4,
                    ),
                  ),
                ],
              ),
            );
          }),
        ],
      ),
    );
  }
}
