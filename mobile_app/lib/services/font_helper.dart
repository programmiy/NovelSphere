import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class FontHelper {
  static TextStyle getKoreanStyle({
    required TextStyle baseStyle,
    required String fontName,
  }) {
    switch (fontName) {
      case 'NanumMyeongjo':
        return GoogleFonts.nanumMyeongjo(textStyle: baseStyle);
      case 'Pretendard':
        return GoogleFonts.notoSansKr(textStyle: baseStyle);
      case 'KoPubBatang':
      case 'RIDIBatang':
        return GoogleFonts.gowunBatang(textStyle: baseStyle);
      default:
        try {
          return GoogleFonts.getFont(fontName, textStyle: baseStyle);
        } catch (_) {
          return baseStyle.copyWith(fontFamily: fontName);
        }
    }
  }

  static TextStyle getJapaneseStyle({
    required TextStyle baseStyle,
    required String fontName,
  }) {
    switch (fontName) {
      case 'NotoSerifJP':
        return GoogleFonts.notoSerifJp(textStyle: baseStyle);
      case 'NotoSansJP':
        return GoogleFonts.notoSansJp(textStyle: baseStyle);
      case 'ShipporiMincho':
        return GoogleFonts.shipporiMincho(textStyle: baseStyle);
      default:
        try {
          return GoogleFonts.getFont(fontName, textStyle: baseStyle);
        } catch (_) {
          return baseStyle.copyWith(fontFamily: fontName);
        }
    }
  }
}
