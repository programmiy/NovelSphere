import 'package:flutter/material.dart';
import '../../services/local_db_service.dart';
import '../themes/reader_themes.dart';

/// LANOVEL Mobile - 유사 번역 단락 독립 교정 페이지 (Sentence Edit Page)
/// 유사 번역 조회 결과에서 특정 단락을 수정할 수 있는 별도의 독립 화면.
/// 상단 뒤로가기를 누르면 언제든 읽던 소설 뷰어 페이지로 안전하게 복귀합니다.
class SentenceEditPage extends StatefulWidget {
  final String bookName;
  final String chapterTitle;
  final String original;
  final String currentTranslated;
  final String? pid;
  final int? sentenceId;
  final ReaderThemeData theme;
  final String koreanFont;
  final String japaneseFont;

  const SentenceEditPage({
    super.key,
    required this.bookName,
    required this.chapterTitle,
    required this.original,
    required this.currentTranslated,
    this.pid,
    this.sentenceId,
    required this.theme,
    required this.koreanFont,
    required this.japaneseFont,
  });

  @override
  State<SentenceEditPage> createState() => _SentenceEditPageState();
}

class _SentenceEditPageState extends State<SentenceEditPage> {
  late TextEditingController _controller;
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.currentTranslated);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _saveAndReturn() async {
    final newTranslated = _controller.text.trim();
    if (newTranslated.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('번역문을 입력해 주세요.')),
      );
      return;
    }

    setState(() {
      _isSaving = true;
    });

    try {
      final success = await LocalDbService.updateSentenceByContext(
        bookName: widget.bookName,
        chapterTitle: widget.chapterTitle,
        original: widget.original,
        newTranslated: newTranslated,
        pid: widget.pid,
        sentenceId: widget.sentenceId,
      );

      if (mounted) {
        if (success) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('해당 단락의 번역문이 로컬 DB에 교정 저장되었습니다.'),
              backgroundColor: Colors.teal,
            ),
          );
          // 읽던 페이지로 복귀 (수정된 번역문 반환)
          Navigator.pop(context, newTranslated);
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('로컬 챕터를 찾지 못해 변경사항을 임시 저장할 수 없습니다.'),
              backgroundColor: Colors.deepOrange,
            ),
          );
        }
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('저장 실패: $e')),
        );
      }
    } finally {
      if (mounted) {
        setState(() {
          _isSaving = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surfaceColor,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: theme.textColor),
          tooltip: '읽던 페이지로 돌아가기',
          onPressed: () => Navigator.pop(context),
        ),
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '유사 단락 번역문 교정',
              style: TextStyle(color: theme.textColor, fontSize: 16, fontWeight: FontWeight.bold),
            ),
            Text(
              '${widget.bookName} • ${widget.chapterTitle}',
              style: TextStyle(color: theme.subTextColor, fontSize: 11),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
        actions: [
          _isSaving
              ? const Padding(
                  padding: EdgeInsets.symmetric(horizontal: 16, vertical: 14),
                  child: SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.amber),
                  ),
                )
              : TextButton.icon(
                  icon: const Icon(Icons.check_rounded, color: Colors.amber, size: 20),
                  label: const Text(
                    '저장',
                    style: TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 15),
                  ),
                  onPressed: _saveAndReturn,
                ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 회차 메타 칩
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: theme.accentColor.withOpacity(0.18),
                    borderRadius: BorderRadius.circular(8),
                    border: Border.all(color: theme.accentColor.withOpacity(0.3)),
                  ),
                  child: Text(
                    widget.bookName,
                    style: TextStyle(
                      color: theme.accentColor,
                      fontSize: 11,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    widget.chapterTitle,
                    style: TextStyle(color: theme.subTextColor, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),

            // 원문 섹션
            Text(
              '원문 (日本語)',
              style: TextStyle(
                color: theme.subTextColor,
                fontSize: 12,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: theme.surfaceColor,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: theme.borderColor),
              ),
              child: SelectableText(
                widget.original.isEmpty ? '(원문 없음)' : widget.original,
                style: TextStyle(
                  color: theme.originalTextColor,
                  fontSize: 15,
                  fontFamily: widget.japaneseFont,
                  height: 1.5,
                ),
              ),
            ),
            const SizedBox(height: 20),

            // 번역문 수정 섹션
            Text(
              '교정할 한국어 번역문',
              style: TextStyle(
                color: theme.subTextColor,
                fontSize: 12,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _controller,
              maxLines: 8,
              autofocus: true,
              style: TextStyle(
                color: theme.textColor,
                fontSize: 16,
                fontFamily: widget.koreanFont,
                height: 1.6,
              ),
              decoration: InputDecoration(
                filled: true,
                fillColor: theme.surfaceColor,
                hintText: '수정할 번역문을 입력하세요...',
                hintStyle: TextStyle(color: theme.subTextColor.withOpacity(0.5)),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(color: theme.borderColor),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(10),
                  borderSide: BorderSide(color: theme.accentColor, width: 2),
                ),
              ),
            ),
            const SizedBox(height: 16),

            // 안내 배너
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white.withOpacity(0.05),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline_rounded, color: theme.subTextColor, size: 16),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '상단 뒤로가기(←)를 누르면 언제든 읽던 소설 페이지로 원위치 복귀합니다.',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
