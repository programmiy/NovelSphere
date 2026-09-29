import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../../services/local_db_service.dart';
import '../themes/reader_themes.dart';

class ReadingStatsSheet extends StatefulWidget {
  final ReaderThemeData theme;
  final bool isFullScreen;

  const ReadingStatsSheet({super.key, required this.theme, this.isFullScreen = false});

  @override
  State<ReadingStatsSheet> createState() => _ReadingStatsSheetState();
}

class _ReadingStatsSheetState extends State<ReadingStatsSheet> {
  Map<String, int> _heatmap = {};
  int _todaySeconds = 0;
  int _todayPages = 0;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadStats();
  }

  Future<void> _loadStats() async {
    final heatmap = await LocalDbService.getReadingHeatmap(days: 84); // 12주 = 84일
    final todayStr = DateFormat('yyyy-MM-dd').format(DateTime.now());

    final db = await LocalDbService.database;
    final todayRows = await db.query(
      'reading_logs',
      where: 'date = ?',
      whereArgs: [todayStr],
    );

    int sec = 0;
    int pgs = 0;
    for (var r in todayRows) {
      sec += (r['read_seconds'] as int? ?? 0);
      pgs += (r['pages_count'] as int? ?? 0);
    }

    setState(() {
      _heatmap = heatmap;
      _todaySeconds = sec;
      _todayPages = pgs;
      _isLoading = false;
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;
    final isFull = widget.isFullScreen;

    return Container(
      height: isFull ? null : 520,
      padding: EdgeInsets.all(isFull ? 16 : 20),
      decoration: BoxDecoration(
        color: isFull ? theme.background : theme.surfaceColor,
        borderRadius: isFull ? null : const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: _isLoading
          ? Center(child: CircularProgressIndicator(color: theme.accentColor))
          : Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (!isFull) ...[
                  Center(
                    child: Container(
                      width: 36,
                      height: 4,
                      decoration: BoxDecoration(
                        color: theme.borderColor,
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Icon(Icons.insights_rounded, color: theme.accentColor, size: 24),
                      const SizedBox(width: 8),
                      Text(
                        '독서 기록 & 잔디 심기',
                        style: TextStyle(color: theme.textColor, fontSize: 18, fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 16),
                // 오늘 통계 요약 카드
                Row(
                  children: [
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: theme.background,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: theme.borderColor),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('오늘 읽은 시간', style: TextStyle(color: theme.subTextColor, fontSize: 12)),
                            const SizedBox(height: 4),
                            Text(
                              '${_todaySeconds ~/ 60}분 ${_todaySeconds % 60}초',
                              style: TextStyle(color: theme.accentColor, fontSize: 18, fontWeight: FontWeight.bold),
                            ),
                          ],
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: theme.background,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: theme.borderColor),
                        ),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('오늘 넘긴 분량', style: TextStyle(color: theme.subTextColor, fontSize: 12)),
                            const SizedBox(height: 4),
                            Text(
                              '$_todayPages 페이지',
                              style: TextStyle(color: theme.textColor, fontSize: 18, fontWeight: FontWeight.bold),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                Text(
                  '최근 12주 독서 잔디 (히트맵)',
                  style: TextStyle(color: theme.textColor, fontSize: 14, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 10),
                // 잔디 심기 그리드 (7열 x 12행 = 84일)
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: theme.background,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: theme.borderColor),
                    ),
                    child: _buildHeatmapGrid(theme),
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildHeatmapGrid(ReaderThemeData theme) {
    final now = DateTime.now();
    // 84일 역산
    final days = List.generate(84, (i) {
      final date = now.subtract(Duration(days: 83 - i));
      return DateFormat('yyyy-MM-dd').format(date);
    });

    return GridView.builder(
      physics: const NeverScrollableScrollPhysics(),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 12,
        crossAxisSpacing: 5,
        mainAxisSpacing: 5,
      ),
      itemCount: days.length,
      itemBuilder: (context, index) {
        final dateStr = days[index];
        final pages = _heatmap[dateStr] ?? 0;

        Color cellColor;
        if (pages == 0) {
          cellColor = theme.surfaceColor;
        } else if (pages < 5) {
          cellColor = theme.accentColor.withOpacity(0.3);
        } else if (pages < 15) {
          cellColor = theme.accentColor.withOpacity(0.6);
        } else {
          cellColor = theme.accentColor;
        }

        return Tooltip(
          message: '$dateStr: $pages페이지 읽음',
          child: Container(
            decoration: BoxDecoration(
              color: cellColor,
              borderRadius: BorderRadius.circular(3),
              border: Border.all(color: theme.borderColor.withOpacity(0.4), width: 0.5),
            ),
          ),
        );
      },
    );
  }
}
