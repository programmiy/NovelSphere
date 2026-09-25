import 'package:flutter/material.dart';
import '../../models/sentence.dart';
import '../themes/reader_themes.dart';

class QuickEditDialog extends StatefulWidget {
  final Sentence sentence;
  final ReaderThemeData theme;
  final String koreanFont;
  final String japaneseFont;
  final Function(String newTranslated) onSave;

  const QuickEditDialog({
    super.key,
    required this.sentence,
    required this.theme,
    required this.koreanFont,
    required this.japaneseFont,
    required this.onSave,
  });

  @override
  State<QuickEditDialog> createState() => _QuickEditDialogState();
}

class _QuickEditDialogState extends State<QuickEditDialog> {
  late TextEditingController _controller;

  @override
  void initState() {
    super.initState();
    _controller = TextEditingController(text: widget.sentence.translated);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      backgroundColor: widget.theme.surfaceColor,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      title: Row(
        children: [
          Icon(Icons.edit_note_rounded, color: widget.theme.accentColor, size: 24),
          const SizedBox(width: 8),
          Text(
            '번역문 즉시 교정',
            style: TextStyle(
              color: widget.theme.textColor,
              fontSize: 18,
              fontWeight: FontWeight.bold,
            ),
          ),
        ],
      ),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 원문 섹션 (선택한 일본어 폰트 적용)
            Text(
              '원문 (日本語)',
              style: TextStyle(
                color: widget.theme.subTextColor,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: widget.theme.background,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: widget.theme.borderColor),
              ),
              child: Text(
                widget.sentence.original.isEmpty ? '(원문 없음)' : widget.sentence.original,
                style: TextStyle(
                  color: widget.theme.originalTextColor,
                  fontSize: 14,
                  fontFamily: widget.japaneseFont,
                  height: 1.4,
                ),
              ),
            ),
            const SizedBox(height: 16),
            // 번역문 편집 섹션 (선택한 한국어 폰트 적용)
            Text(
              '수정할 한국어 번역문',
              style: TextStyle(
                color: widget.theme.subTextColor,
                fontSize: 12,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 6),
            TextField(
              controller: _controller,
              maxLines: 5,
              style: TextStyle(
                color: widget.theme.textColor,
                fontSize: 16,
                fontFamily: widget.koreanFont,
                height: 1.5,
              ),
              decoration: InputDecoration(
                filled: true,
                fillColor: widget.theme.background,
                hintText: '수정할 번역문을 입력하세요...',
                hintStyle: TextStyle(color: widget.theme.subTextColor.withOpacity(0.5)),
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: widget.theme.borderColor),
                ),
                focusedBorder: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(8),
                  borderSide: BorderSide(color: widget.theme.accentColor, width: 2),
                ),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text('취소', style: TextStyle(color: widget.theme.subTextColor)),
        ),
        ElevatedButton(
          style: ElevatedButton.styleFrom(
            backgroundColor: widget.theme.accentColor,
            foregroundColor: Colors.white,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
          ),
          onPressed: () {
            final newText = _controller.text.trim();
            if (newText.isNotEmpty) {
              widget.onSave(newText);
              Navigator.pop(context);
            }
          },
          child: const Text('교정 저장 (로컬 갱신)'),
        ),
      ],
    );
  }
}
