import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_app/models/ai_review_models.dart';

void main() {
  group('cleanAiTranslation tests', () {
    test('cleans raw markdown code block with json array', () {
      const input = '''```json
["그는 달렸다."]
```''';
      expect(cleanAiTranslation(input), equals('그는 달렸다.'));
    });

    test('cleans JSON object with translated key', () {
      const input = '{"translated": "그는 달렸다."}';
      expect(cleanAiTranslation(input), equals('그는 달렸다.'));
    });

    test('cleans Python dict with translation key and single quotes', () {
      const input = "{'translation': '그는 달렸다.'}";
      expect(cleanAiTranslation(input), equals('그는 달렸다.'));
    });

    test('cleans JSON array with single string', () {
      const input = '["순수 번역문"]';
      expect(cleanAiTranslation(input), equals('순수 번역문'));
    });

    test('cleans markdown block with JSON object containing escape sequences', () {
      const input = '''```json
{"translated": "말이야아\\n진짜로"}
```''';
      expect(cleanAiTranslation(input), equals('말이야아\n진짜로'));
    });

    test('cleans JSON array of objects with translated key', () {
      const input = '''```json
[{"original": "走った", "translated": "그는 달렸다."}]
```''';
      expect(cleanAiTranslation(input), equals('그는 달렸다.'));
    });

    test('leaves regular text untouched', () {
      const input = '그냥 평범한 한국어 번역 문장입니다.';
      expect(cleanAiTranslation(input), equals('그냥 평범한 한국어 번역 문장입니다.'));
    });

    test('handles empty and null inputs safely', () {
      expect(cleanAiTranslation(null), equals(''));
      expect(cleanAiTranslation('   '), equals(''));
    });
  });

  group('AiReviewItem.fromJson integration test', () {
    test('cleans ai_translated_text and old_translated_text during deserialization', () {
      final jsonMap = {
        'queue_id': 1,
        'translation_id': 100,
        'original_text': '走った',
        'old_translated_text': '```json\n{"translated": "이전 번역"}\n```',
        'ai_translated_text': '```json\n["그는 달렸다."]\n```',
        'model_used': 'gemini-3.8-flash',
        'is_reretranslated': true,
        'folderName': '테스트폴더',
        'url': 'http://example.com',
        'context_before': [],
        'context_after': [],
      };

      final item = AiReviewItem.fromJson(jsonMap);
      expect(item.aiTranslatedText, equals('그는 달렸다.'));
      expect(item.oldTranslatedText, equals('이전 번역'));
    });
  });
}
