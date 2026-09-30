import 'package:flutter_test/flutter_test.dart';

class NovelRubySpanParser {
  static final RegExp _boutenCharRegex = RegExp(r'([^\s(（])\s*[（(]・[）)](\s*)');

  static bool hasRubyOrBouten(String text) {
    return text.contains('・') || text.contains('《');
  }

  static List<NovelSpanToken> parse(String text) {
    if (!hasRubyOrBouten(text)) {
      return [NovelSpanToken(type: NovelSpanType.normal, text: text)];
    }

    final tokens = <NovelSpanToken>[];

    // Bouten: (char)[(（]・[)）] with optional trailing whitespace
    // Ruby: [|｜]?(word)《(ruby)》
    final combinedRegex = RegExp(
      r'((?:[^\s(（]\s*[（(]・[）)]\s*)+)|(?:([|｜]?[가-힣a-zA-Z0-9_]+)《([^》]+)》)',
    );

    int lastIndex = 0;
    for (final match in combinedRegex.allMatches(text)) {
      if (match.start > lastIndex) {
        tokens.add(NovelSpanToken(
          type: NovelSpanType.normal,
          text: text.substring(lastIndex, match.start),
        ));
      }

      if (match.group(1) != null) {
        final boutenBlock = match.group(1)!;
        final charMatches = _boutenCharRegex.allMatches(boutenBlock);
        for (final cm in charMatches) {
          final char = cm.group(1)!;
          final trailingSpace = cm.group(2) ?? '';
          tokens.add(NovelSpanToken(
            type: NovelSpanType.bouten,
            text: char,
            ruby: '・',
          ));
          if (trailingSpace.isNotEmpty) {
            tokens.add(NovelSpanToken(
              type: NovelSpanType.normal,
              text: trailingSpace,
            ));
          }
        }
      } else if (match.group(2) != null && match.group(3) != null) {
        var base = match.group(2)!;
        if (base.startsWith('|') || base.startsWith('｜')) {
          base = base.substring(1);
        }
        final ruby = match.group(3)!;
        tokens.add(NovelSpanToken(
          type: NovelSpanType.ruby,
          text: base,
          ruby: ruby,
        ));
      }

      lastIndex = match.end;
    }

    if (lastIndex < text.length) {
      tokens.add(NovelSpanToken(
        type: NovelSpanType.normal,
        text: text.substring(lastIndex),
      ));
    }

    return tokens;
  }
}

enum NovelSpanType { normal, ruby, bouten }

class NovelSpanToken {
  final NovelSpanType type;
  final String text;
  final String? ruby;

  NovelSpanToken({required this.type, required this.text, this.ruby});

  @override
  String toString() => 'Token($type, "$text", ruby: "$ruby")';
}

void main() {
  test('Bouten with spaces test', () {
    const text = '내(・)가(・) 지(・)켜(・)주(・)고(・) 싶(・)다(・)는 욕구';
    final tokens = NovelRubySpanParser.parse(text);

    // Verify reconstructed text matches original without (・)
    final plainChars = tokens.map((t) => t.text).join();
    expect(plainChars, '내가 지켜주고 싶다는 욕구');
  });
}
