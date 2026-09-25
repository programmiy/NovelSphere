import 'package:flutter/material.dart';
import '../../models/chapter.dart';
import '../themes/reader_themes.dart';

class TocDrawer extends StatelessWidget {
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
  Widget build(BuildContext context) {
    return Drawer(
      backgroundColor: theme.surfaceColor,
      child: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Drawer Header
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 16, 16, 12),
              child: Row(
                children: [
                  Icon(Icons.list_alt_rounded, color: theme.accentColor, size: 24),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          bookName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: theme.textColor,
                            fontSize: 16,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          '총 ${chapters.length}개 챕터',
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
            Divider(color: theme.borderColor, height: 1),
            // Chapters List
            Expanded(
              child: ListView.separated(
                itemCount: chapters.length,
                separatorBuilder: (_, __) => Divider(color: theme.borderColor.withOpacity(0.5), height: 1),
                itemBuilder: (context, index) {
                  final chap = chapters[index];
                  final isCurrent = (index == currentChapterIndex);

                  return ListTile(
                    contentPadding: const EdgeInsets.symmetric(horizontal: 20, vertical: 2),
                    tileColor: isCurrent ? theme.accentColor.withOpacity(0.12) : null,
                    leading: CircleAvatar(
                      radius: 12,
                      backgroundColor: isCurrent ? theme.accentColor : theme.borderColor,
                      child: Text(
                        '${index + 1}',
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
                      onSelectChapter(index);
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
