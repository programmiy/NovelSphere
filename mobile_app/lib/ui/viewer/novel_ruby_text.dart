import 'package:flutter/material.dart';

enum NovelSpanType { normal, ruby, bouten }

class NovelSpanToken {
  final NovelSpanType type;
  final String text;
  final String? ruby;

  const NovelSpanToken({
    required this.type,
    required this.text,
    this.ruby,
  });
}

/// 라노벨 특화 루비(Ruby) 및 방점/강조점(傍点) 파서
class NovelRubyParser {
  // 1. 방점: 글(・) 또는 글（・）
  static final RegExp _boutenCharRegex = RegExp(r'([^\s(（])\s*[（(]・[）)](\s*)');

  /// 루비 또는 방점 후보 문자가 있는지 O(1) 고속 검사
  static bool hasRubyOrBouten(String text) {
    return text.contains('・') || text.contains('《');
  }

  /// 텍스트를 파싱하여 [NovelSpanToken] 리스트로 분할
  static List<NovelSpanToken> parse(String text) {
    if (!hasRubyOrBouten(text)) {
      return [NovelSpanToken(type: NovelSpanType.normal, text: text)];
    }

    final tokens = <NovelSpanToken>[];

    // 방점 블록: ((글자)(・) 반복)
    // 루비 블록: (단어)《(루비)》
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
        // 1. 방점(傍点) 블록 처리 (글자마다 '・' 매핑, 공백 보존)
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
        // 2. 루비(Ruby) 블록 처리
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

/// 번역문 내 루비(`단어《루비》`) 및 방점(`글(・)`)을 출판사 스타일로 렌더링하는 위젯
class NovelRubyText extends StatelessWidget {
  final String text;
  final TextStyle style;
  final TextAlign textAlign;

  const NovelRubyText({
    super.key,
    required this.text,
    required this.style,
    this.textAlign = TextAlign.start,
  });

  @override
  Widget build(BuildContext context) {
    // 루비/방점이 없는 일반 문장은 즉시 기본 Text로 고속 렌더링 (체감 지연 0%)
    if (!NovelRubyParser.hasRubyOrBouten(text)) {
      return Text(
        text,
        style: style,
        textAlign: textAlign,
      );
    }

    final tokens = NovelRubyParser.parse(text);
    final spans = <InlineSpan>[];
    final baseFontSize = style.fontSize ?? 18.0;
    final rubyFontSize = (baseFontSize * 0.50).clamp(9.0, 20.0);
    final boutenFontSize = (baseFontSize * 0.55).clamp(9.0, 22.0);

    for (final token in tokens) {
      switch (token.type) {
        case NovelSpanType.normal:
          spans.add(TextSpan(text: token.text, style: style));
          break;

        case NovelSpanType.bouten:
          // 글자 상단에 점('・')을 정확히 배치
          spans.add(WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Text(
                  token.ruby ?? '・',
                  style: style.copyWith(
                    fontSize: boutenFontSize,
                    height: 1.0,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  token.text,
                  style: style.copyWith(height: 1.15),
                ),
              ],
            ),
          ));
          break;

        case NovelSpanType.ruby:
          // 단어 상단에 루비 텍스트 배치
          spans.add(WidgetSpan(
            alignment: PlaceholderAlignment.middle,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.center,
              children: [
                Text(
                  token.ruby ?? '',
                  style: style.copyWith(
                    fontSize: rubyFontSize,
                    color: (style.color ?? Colors.black).withOpacity(0.85),
                    height: 1.0,
                    letterSpacing: -0.2,
                  ),
                ),
                const SizedBox(height: 1),
                Text(
                  token.text,
                  style: style.copyWith(height: 1.15),
                ),
              ],
            ),
          ));
          break;
      }
    }

    return Text.rich(
      TextSpan(children: spans),
      textAlign: textAlign,
    );
  }
}
