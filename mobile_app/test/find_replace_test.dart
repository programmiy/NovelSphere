import 'package:flutter_test/flutter_test.dart';
import 'package:lanovel_reader/models/glossary_rule.dart';
import 'package:lanovel_reader/models/find_replace_item.dart';
import 'package:lanovel_reader/services/text_diff_helper.dart';

void main() {
  group('Find & Replace Unit Tests', () {
    test('GlossaryRule serialization with conditionText and replacedCount', () {
      final rule = GlossaryRule(
        id: 1,
        folderScope: '테스트소설',
        findText: '마도왕',
        replaceText: '마왕',
        conditionText: '魔王',
        useRegex: false,
        caseSensitive: true,
        appliedAt: 1730000000,
        replacedCount: 42,
        isFavorite: true,
      );

      final map = rule.toMap();
      expect(map['id'], 1);
      expect(map['folder_scope'], '테스트소설');
      expect(map['find_text'], '마도왕');
      expect(map['replace_text'], '마왕');
      expect(map['condition_text'], '魔王');
      expect(map['use_regex'], 0);
      expect(map['case_sensitive'], 1);
      expect(map['applied_at'], 1730000000);
      expect(map['replaced_count'], 42);
      expect(map['is_favorite'], 1);

      final restored = GlossaryRule.fromMap(map);
      expect(restored.id, 1);
      expect(restored.folderScope, '테스트소설');
      expect(restored.findText, '마도왕');
      expect(restored.replaceText, '마왕');
      expect(restored.conditionText, '魔王');
      expect(restored.useRegex, false);
      expect(restored.caseSensitive, true);
      expect(restored.appliedAt, 1730000000);
      expect(restored.replacedCount, 42);
      expect(restored.isFavorite, true);
    });

    test('FindReplaceItem uniqueKey generation and diff integration', () {
      const before = '용사는 마도왕을 물리쳤다.';
      const after = '용사는 마왕을 물리쳤다.';
      final diff = TextDiffHelper.computeDiff(before, after);

      final item = FindReplaceItem(
        chapterId: 101,
        bookName: '전설의용사',
        chapterTitle: '제1화 시작',
        sentenceId: 501,
        pid: 'L15',
        original: '勇者は魔王を倒した。',
        beforeText: before,
        afterText: after,
        diff: diff,
      );

      expect(item.uniqueKey, '101_L15');
      expect(item.diff.hasChanges, isTrue);
      expect(item.diff.ops.any((op) => op.type == DiffType.delete), isTrue);
      expect(item.diff.ops.any((op) => op.type == DiffType.insert), isTrue);
    });

    test('Case sensitivity and regex replacement behavior', () {
      const text = 'Hello world, hello World';
      final caseInsensitiveReg = RegExp(RegExp.escape('hello'), caseSensitive: false);
      final replacedAll = text.replaceAll(caseInsensitiveReg, 'Hi');
      expect(replacedAll, 'Hi world, Hi World');

      final caseSensitiveReg = RegExp(RegExp.escape('Hello'), caseSensitive: true);
      final replacedCase = text.replaceAll(caseSensitiveReg, 'Hi');
      expect(replacedCase, 'Hi world, hello World');
    });
  });
}
