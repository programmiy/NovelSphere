import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../services/preferences_service.dart';
import '../../services/sync_service.dart';
import '../../services/character_fixer_service.dart';
import '../../services/ai_review_service.dart';
import '../../services/special_batch_service.dart';
import '../themes/reader_themes.dart';
import '../themes/hyper_aesthetic_theme.dart';
import '../glossary/character_fixer_screen.dart';
import '../ai_review/ai_review_screen.dart';
import '../ai_review/ai_reretranslate_screen.dart';
import '../special_batch/special_batch_screen.dart';

/// LANOVEL 4대 통합 검수 센터 (Comprehensive Review Center)
class ReviewCenterScreen extends StatefulWidget {
  const ReviewCenterScreen({super.key});

  @override
  State<ReviewCenterScreen> createState() => _ReviewCenterScreenState();
}

class _ReviewCenterScreenState extends State<ReviewCenterScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;
  bool _isServerOnline = false;
  bool _isLoadingCounts = true;

  // 4대 검수 시스템별 실시간 대기 건수
  int _charFixCount = 0;
  int _aiReviewCount = 0;
  int _aiReretranslateCount = 0;
  int _specialBatchCount = 0;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _checkServerAndCounts();
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  Future<void> _checkServerAndCounts() async {
    setState(() => _isLoadingCounts = true);
    final online = await SyncService.pingServer();

    int charFix = 0;
    int aiRev = 0;
    int aiRere = 0;
    int specBatch = 0;

    if (online) {
      try {
        final fList = await CharacterFixerService.fetchFolders();
        for (var f in fList) {
          charFix += (f['total_sentences'] as num?)?.toInt() ?? 0;
        }
      } catch (_) {}

      try {
        final q = await AiReviewService.fetchQueue();
        aiRev = q.length;
      } catch (_) {}

      try {
        final rere = await AiReviewService.fetchReretranslateQueue();
        for (var l in rere.values) {
          aiRere += l.length;
        }
      } catch (_) {}

      try {
        final novels = await SpecialBatchService.fetchNovels();
        for (var n in novels) {
          specBatch += n.stagedCount;
        }
      } catch (_) {}
    }

    if (!mounted) return;
    setState(() {
      _isServerOnline = online;
      _charFixCount = charFix;
      _aiReviewCount = aiRev;
      _aiReretranslateCount = aiRere;
      _specialBatchCount = specBatch;
      _isLoadingCounts = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surfaceColor.withOpacity(0.92),
        elevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                gradient: const LinearGradient(colors: [Colors.purpleAccent, Colors.deepPurple]),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.fact_check_rounded, color: Colors.white, size: 20),
            ),
            const SizedBox(width: 10),
            Text(
              '검수 센터',
              style: TextStyle(color: theme.textColor, fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
              decoration: BoxDecoration(
                color: _isServerOnline
                    ? const Color(0xFF10B981).withOpacity(0.15)
                    : Colors.redAccent.withOpacity(0.15),
                borderRadius: BorderRadius.circular(6),
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Container(
                    width: 6,
                    height: 6,
                    decoration: BoxDecoration(
                      color: _isServerOnline ? const Color(0xFF10B981) : Colors.redAccent,
                      shape: BoxShape.circle,
                    ),
                  ),
                  const SizedBox(width: 4),
                  Text(
                    _isServerOnline ? '서버 연결됨' : '오프라인',
                    style: TextStyle(
                      color: _isServerOnline ? const Color(0xFF10B981) : Colors.redAccent,
                      fontSize: 10,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: '현황 새로고침',
            onPressed: () {
              HapticFeedback.lightImpact();
              _checkServerAndCounts();
            },
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: ListView(
        // 하단 플로팅 글래스 독(110px 여백) 확보
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 120),
        children: [
          // 1. 통합 검수 현황 요약 대시보드 배너
          _buildSummaryBanner(theme, primary),
          const SizedBox(height: 16),

          // 2. 4대 검수 시스템 카드 리스트
          Text(
            '4대 검수 파이프라인 (Admin Systems)',
            style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 15),
          ),
          const SizedBox(height: 10),

          // 시스템 1: 인명·용어 교정기 (/db_editor)
          _buildSystemCard(
            title: '인명·용어 교정기',
            subtitle: '고유명사 및 인명 용어집 (/db_editor)',
            description: '틴더식 스와이프 검수 • 오독 통계 자동 발굴 • 실시간 Diff 인스펙터',
            icon: Icons.auto_fix_high_rounded,
            badge: '틴더 검수',
            badgeColor: Colors.deepOrangeAccent,
            color: theme.accentColor,
            queueCount: _charFixCount,
            queueUnit: '문단',
            theme: theme,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const CharacterFixerScreen()),
              ).then((_) => _checkServerAndCounts());
            },
          ),
          const SizedBox(height: 12),

          // 시스템 2: AI 번역 검수 스튜디오 (/ai_review)
          _buildSystemCard(
            title: 'AI 번역 검수 스튜디오',
            subtitle: 'AI 단락 번역 품질 검수 (/ai_review)',
            description: '슬라이드 스와이프 승인/거절 • 되돌리기 • Reroll • 이상치 정밀 교정',
            icon: Icons.swipe_rounded,
            badge: '슬라이드 검수',
            badgeColor: Colors.amber,
            color: Colors.amber,
            queueCount: _aiReviewCount,
            queueUnit: '건 대기',
            theme: theme,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const AiReviewScreen()),
              ).then((_) => _checkServerAndCounts());
            },
          ),
          const SizedBox(height: 12),

          // 시스템 3: AI 재재번역 센터 (/ai_reretranslate)
          _buildSystemCard(
            title: 'AI 재재번역 센터',
            subtitle: 'AI 2차 재번역 센터 (/ai_reretranslate)',
            description: 'Gemini 4대 모델별 티어링 큐 • 다중 모델 재번역 비교 및 즉시 승격',
            icon: Icons.psychology_rounded,
            badge: '4대 LLM 큐',
            badgeColor: Colors.cyanAccent,
            color: Colors.cyan,
            queueCount: _aiReretranslateCount,
            queueUnit: '건 대기',
            theme: theme,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const AiReretranslateScreen()),
              ).then((_) => _checkServerAndCounts());
            },
          ),
          const SizedBox(height: 12),

          // 시스템 4: 특별 적재 검수기 (/special_batch)
          _buildSystemCard(
            title: '특별 적재 검수기',
            subtitle: '특별 적재 배치 검수기 (/special_batch)',
            description: '외부 수집/보정본 문단 검수 • 소설별 일괄 승인 • 본 DB 즉시 승격',
            icon: Icons.bolt_rounded,
            badge: '배치 승격',
            badgeColor: Colors.purpleAccent,
            color: Colors.purpleAccent,
            queueCount: _specialBatchCount,
            queueUnit: '건 대기',
            theme: theme,
            onTap: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const SpecialBatchScreen()),
              ).then((_) => _checkServerAndCounts());
            },
          ),
        ],
      ),
    );
  }

  /// 통합 검수 현황 요약 배너
  Widget _buildSummaryBanner(ReaderThemeData theme, Color primary) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: theme.borderColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: primary.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(Icons.hub_rounded, color: primary, size: 20),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'LANOVEL 4대 통합 검수 허브',
                      style: TextStyle(
                        color: theme.textColor,
                        fontSize: 14.5,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      'PC 웹 관리자(admin.html)의 4대 검수 파이프라인을 모바일에서 100% 동일하게 제어합니다.',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11),
                    ),
                  ],
                ),
              ),
            ],
          ),
          const SizedBox(height: 14),
          Divider(height: 1, color: theme.borderColor.withOpacity(0.5)),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildMetricItem('인명 교정', _charFixCount, '문단', theme.accentColor, theme),
              _buildMetricItem('AI 검수', _aiReviewCount, '건', Colors.amber, theme),
              _buildMetricItem('재재번역', _aiReretranslateCount, '건', Colors.cyan, theme),
              _buildMetricItem('특별 적재', _specialBatchCount, '건', Colors.purpleAccent, theme),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildMetricItem(String label, int count, String unit, Color color, ReaderThemeData theme) {
    return Column(
      children: [
        Text(
          _isLoadingCounts ? '-' : '$count$unit',
          style: TextStyle(
            color: color,
            fontSize: 14,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 2),
        Text(
          label,
          style: TextStyle(color: theme.subTextColor, fontSize: 11),
        ),
      ],
    );
  }

  /// 개별 시스템 카드 위젯
  Widget _buildSystemCard({
    required String title,
    required String subtitle,
    required String description,
    required IconData icon,
    required String badge,
    required Color badgeColor,
    required Color color,
    required int queueCount,
    required String queueUnit,
    required ReaderThemeData theme,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: () {
        HapticFeedback.lightImpact();
        onTap();
      },
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: theme.surfaceColor,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: color.withOpacity(0.35), width: 1.2),
          boxShadow: [
            BoxShadow(
              color: color.withOpacity(0.04),
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            // 시스템 아이콘 컨테이너
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [color, color.withOpacity(0.7)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Icon(icon, color: Colors.white, size: 24),
            ),
            const SizedBox(width: 14),
            // 본문 설명
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        title,
                        style: TextStyle(
                          color: theme.textColor,
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                        decoration: BoxDecoration(
                          color: badgeColor.withOpacity(0.18),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          badge,
                          style: TextStyle(color: badgeColor, fontSize: 9.5, fontWeight: FontWeight.bold),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: TextStyle(color: theme.subTextColor.withOpacity(0.7), fontSize: 10.5),
                  ),
                  const SizedBox(height: 5),
                  Text(
                    description,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: theme.subTextColor, fontSize: 11.5),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            // 우측 화살표 및 대기 건수 배지
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (queueCount > 0)
                  Container(
                    margin: const EdgeInsets.only(bottom: 6),
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Text(
                      '$queueCount$queueUnit',
                      style: TextStyle(color: color, fontSize: 10, fontWeight: FontWeight.bold),
                    ),
                  ),
                Icon(Icons.arrow_forward_ios_rounded, size: 14, color: theme.subTextColor),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
