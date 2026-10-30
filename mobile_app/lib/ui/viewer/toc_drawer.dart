import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../models/chapter.dart';
import '../themes/reader_themes.dart';

class TocDrawer extends StatefulWidget {
  final String bookName;
  final List<Chapter> chapters;
  final int currentChapterIndex;
  final ReaderThemeData theme;
  final Function(int selectedIndex) onSelectChapter;

  const TocDrawer({
    super.key,
    required this.bookName,
    required this.chapters,
    required this.currentChapterIndex,
    required this.theme,
    required this.onSelectChapter,
  });

  @override
  State<TocDrawer> createState() => _TocDrawerState();
}

class _TocDrawerState extends State<TocDrawer> {
  final ScrollController _scrollController = ScrollController();
  bool _isReversed = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scrollToCurrent(animate: false);
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  void _scrollToCurrent({bool animate = true}) {
    if (!_scrollController.hasClients || widget.chapters.isEmpty) return;

    final targetIndex = _isReversed
        ? (widget.chapters.length - 1 - widget.currentChapterIndex)
        : widget.currentChapterIndex;

    final targetOffset = (targetIndex * 64.0).clamp(
      0.0,
      _scrollController.position.maxScrollExtent,
    );

    if (animate) {
      _scrollController.animateTo(
        targetOffset,
        duration: const Duration(milliseconds: 250),
        curve: Curves.easeOutCubic,
      );
    } else {
      _scrollController.jumpTo(targetOffset);
    }
  }

  void _toggleSortOrder() {
    HapticFeedback.selectionClick();
    setState(() {
      _isReversed = !_isReversed;
    });
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _scrollToCurrent(animate: true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;
    final totalChapters = widget.chapters.length;

    return Drawer(
      backgroundColor: theme.surfaceColor,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Drawer Header
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 16, 8),
              child: Row(
                children: [
                  Icon(Icons.list_alt_rounded, color: theme.accentColor, size: 24),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          widget.bookName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: theme.textColor,
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          '총 $totalChapters개 챕터',
                          style: TextStyle(color: theme.subTextColor, fontSize: 12),
                        ),
                      ],
                    ),
                  ),
                  IconButton(
                    icon: Icon(Icons.close, color: theme.subTextColor),
                    onPressed: () => Navigator.pop(context),
                  ),
                ],
              ),
            ),

            // 빠른 이동 및 역순 정렬 컨트롤 바
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
              child: Row(
                children: [
                  // 현재 화로 즉시 점프
                  InkWell(
                    onTap: () {
                      HapticFeedback.lightImpact();
                      _scrollToCurrent(animate: true);
                    },
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: theme.accentColor.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: theme.accentColor.withOpacity(0.3), width: 0.8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.my_location_rounded, size: 14, color: theme.accentColor),
                          const SizedBox(width: 4),
                          Text(
                            '현재 제 ${widget.currentChapterIndex + 1}화',
                            style: TextStyle(
                              color: theme.accentColor,
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const Spacer(),
                  // 최신순 / 1화부터 정렬 토글
                  InkWell(
                    onTap: _toggleSortOrder,
                    borderRadius: BorderRadius.circular(8),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                      decoration: BoxDecoration(
                        color: theme.background,
                        borderRadius: BorderRadius.circular(8),
                        border: Border.all(color: theme.borderColor, width: 0.8),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.swap_vert_rounded, size: 15, color: theme.subTextColor),
                          const SizedBox(width: 4),
                          Text(
                            _isReversed ? '최신화부터' : '1화부터',
                            style: TextStyle(
                              color: theme.textColor,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 4),
            Divider(color: theme.borderColor, height: 1),

            // Chapters List
            Expanded(
              child: ListView.separated(
                controller: _scrollController,
                itemCount: totalChapters,
                separatorBuilder: (_, __) => Divider(color: theme.borderColor.withOpacity(0.5), height: 1),
                itemBuilder: (context, index) {
                  final origIndex = _isReversed ? (totalChapters - 1 - index) : index;
                  final chap = widget.chapters[origIndex];
                  final isCurrent = (origIndex == widget.currentChapterIndex);

                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
                    tileColor: isCurrent ? theme.accentColor.withOpacity(0.12) : null,
                    leading: CircleAvatar(
                      radius: 12,
                      backgroundColor: isCurrent ? theme.accentColor : theme.borderColor,
                      child: Text(
                        '${origIndex + 1}',
                        style: TextStyle(
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          color: isCurrent ? Colors.white : theme.subTextColor,
                        ),
                      ),
                    ),
                    title: Text(
                      chap.title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 14,
                        color: isCurrent ? theme.accentColor : theme.textColor,
                        fontWeight: isCurrent ? FontWeight.bold : FontWeight.normal,
                      ),
                    ),
                    subtitle: Text(
                      '${chap.sentenceCount}개 문장',
                      style: TextStyle(fontSize: 11, color: theme.subTextColor),
                    ),
                    trailing: isCurrent
                        ? Icon(Icons.menu_book_rounded, color: theme.accentColor, size: 18)
                        : null,
                    onTap: () {
                      Navigator.pop(context);
                      widget.onSelectChapter(origIndex);
                    },
                  );
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
