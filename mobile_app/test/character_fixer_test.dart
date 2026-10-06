import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lanovel_reader/models/character_fix_models.dart';
import 'package:lanovel_reader/services/text_diff_helper.dart';

void main() {
  group('TextDiffHelper Tests', () {
    test('computeDiff detects replacement of names correctly', () {
      const before = '용사 유우가 마왕을 물리쳤다.';
      const after = '용사 유우의가 마왕을 물리쳤다.';

      final diff = TextDiffHelper.computeDiff(before, after);

      expect(diff.changes.isNotEmpty, isTrue);
      expect(diff.ops.any((op) => op.type == DiffType.insert), isTrue);
    });

    test('computeDiff handles identical text with zero changes', () {
      const text = '아무런 변경 사항이 없는 문장입니다.';
      final diff = TextDiffHelper.computeDiff(text, text);

      expect(diff.changes.isEmpty, isTrue);
      expect(diff.ops.every((op) => op.type == DiffType.equal), isTrue);
    });

    test('buildBeforeSpans highlights target properly', () {
      const before = '유샤는 웃었다.';
      const after = '용사는 웃었다.';
      final diff = TextDiffHelper.computeDiff(before, after);

      final spans = TextDiffHelper.buildBeforeSpans(
        ops: diff.ops,
        defaultTextColor: Colors.black,
        isDarkMode: false,
      );

      expect(spans.isNotEmpty, isTrue);
    });

    test('buildDiffSpans produces valid spans for ops', () {
      const before = '사쿠라는 달렸다.';
      const after = '사쿠라는 걸었다.';
      final diff = TextDiffHelper.computeDiff(before, after);

      final spans = TextDiffHelper.buildDiffSpans(
        ops: diff.ops,
        defaultTextColor: Colors.black,
        isDarkMode: false,
      );

      expect(spans.isNotEmpty, isTrue);
    });
  });

  group('CharacterFixModels Tests', () {
    test('CharacterRule json serialization and deserialization', () {
      final rule = CharacterRule(
        id: 'rule-1',
        source: '勇者',
        target: '용사',
        misreadings: ['유샤', '용자'],
        enabled: true,
      );

      final json = rule.toJson();
      expect(json['source'], '勇者');
      expect(json['target'], '용사');
      expect(json['misreadings'], ['유샤', '용자']);
      expect(json['enabled'], true);

      final fromJson = CharacterRule.fromJson(json);
      expect(fromJson.source, rule.source);
      expect(fromJson.target, rule.target);
      expect(fromJson.misreadings, rule.misreadings);
      expect(fromJson.enabled, rule.enabled);
    });

    test('CharacterFixItem json parsing', () {
      final data = {
        'id': 123,
        'title': '1화. 프롤로그',
        'original': '勇者が現れた。',
        'translated': '유샤가 나타났다.',
        'suggested': '용사가 나타났다.',
        'tags': ['유샤 ➔ 용사'],
      };

      final item = CharacterFixItem.fromJson(data);
      expect(item.id, 123);
      expect(item.title, '1화. 프롤로그');
      expect(item.original, '勇者が現れた。');
      expect(item.translated, '유샤가 나타났다.');
      expect(item.suggested, '용사가 나타났다.');
      expect(item.tags, ['유샤 ➔ 용사']);
    });

    test('MisreadingCandidate json parsing', () {
      final cand = MisreadingCandidate.fromJson({
        'word': '유샤',
        'count': 12,
        'ratio': 0.85,
      });

      expect(cand.word, '유샤');
      expect(cand.count, 12);
      expect(cand.ratio, 0.85);
    });
  });
}
