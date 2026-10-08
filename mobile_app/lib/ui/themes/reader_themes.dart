import 'package:flutter/material.dart';
import '../../services/preferences_service.dart';

class ReaderThemeData {
  final String id;
  final String name;
  final Color background;
  final Color textColor;
  final Color subTextColor;
  final Color originalTextColor;
  final Color accentColor;
  final Color surfaceColor;
  final Color borderColor;
  final bool isDark;

  const ReaderThemeData({
    required this.id,
    required this.name,
    required this.background,
    required this.textColor,
    required this.subTextColor,
    required this.originalTextColor,
    required this.accentColor,
    required this.surfaceColor,
    required this.borderColor,
    required this.isDark,
  });
}

class ReaderThemes {
  static const List<ReaderThemeData> allThemes = [
    // 1. 웜 페이퍼 (눈의 피로를 덜어주는 온화한 미색 종이 질감)
    ReaderThemeData(
      id: 'paper',
      name: '웜 페이퍼',
      background: Color(0xFFF7F4EB),
      textColor: Color(0xFF262624),
      subTextColor: Color(0xFF7A7870),
      originalTextColor: Color(0xFF8C887B),
      accentColor: Color(0xFF6B583E),
      surfaceColor: Color(0xFFEFECE2),
      borderColor: Color(0xFFE2DEC8),
      isDark: false,
    ),
    // 2. 내추럴 크림 (부드러운 크림 버터톤)
    ReaderThemeData(
      id: 'cream',
      name: '내추럴 크림',
      background: Color(0xFFFAF6EE),
      textColor: Color(0xFF2B2620),
      subTextColor: Color(0xFF82786A),
      originalTextColor: Color(0xFF998C7B),
      accentColor: Color(0xFF8A6D3B),
      surfaceColor: Color(0xFFF3ECE0),
      borderColor: Color(0xFFEAE0D0),
      isDark: false,
    ),
    // 3. 퓨어 화이트 (맑고 선명한 화이트)
    ReaderThemeData(
      id: 'white',
      name: '퓨어 화이트',
      background: Color(0xFFFFFFFF),
      textColor: Color(0xFF1E293B),
      subTextColor: Color(0xFF64748B),
      originalTextColor: Color(0xFF94A3B8),
      accentColor: Color(0xFF3B82F6),
      surfaceColor: Color(0xFFF8FAFC),
      borderColor: Color(0xFFE2E8F0),
      isDark: false,
    ),
    // 4. 빈티지 세피아 (고전 서책의 감성 세피아)
    ReaderThemeData(
      id: 'sepia',
      name: '빈티지 세피아',
      background: Color(0xFFEFE6D5),
      textColor: Color(0xFF382918),
      subTextColor: Color(0xFF7D654C),
      originalTextColor: Color(0xFF997D61),
      accentColor: Color(0xFF875525),
      surfaceColor: Color(0xFFE5DAC7),
      borderColor: Color(0xFFD6C8B2),
      isDark: false,
    ),
    // 5. 소프트 민트 (눈이 편안한 녹차/민트톤)
    ReaderThemeData(
      id: 'mint',
      name: '소프트 민트',
      background: Color(0xFFEEF5EE),
      textColor: Color(0xFF1C2E20),
      subTextColor: Color(0xFF5D7863),
      originalTextColor: Color(0xFF7A9680),
      accentColor: Color(0xFF2E7D46),
      surfaceColor: Color(0xFFE3EDE3),
      borderColor: Color(0xFFD2E0D2),
      isDark: false,
    ),
    // 6. 로즈 밀크 (은은하고 따뜻한 핑크빛 웜톤)
    ReaderThemeData(
      id: 'rose',
      name: '로즈 밀크',
      background: Color(0xFFFDF2F4),
      textColor: Color(0xFF3B2329),
      subTextColor: Color(0xFF855D68),
      originalTextColor: Color(0xFFA17884),
      accentColor: Color(0xFFC24168),
      surfaceColor: Color(0xFFF7E4E8),
      borderColor: Color(0xFFECD0D7),
      isDark: false,
    ),
    // 7. 차분한 라벤더 (은은한 보랏빛 릴렉스)
    ReaderThemeData(
      id: 'lavender',
      name: '라벤더',
      background: Color(0xFFF5F2F9),
      textColor: Color(0xFF292236),
      subTextColor: Color(0xFF716388),
      originalTextColor: Color(0xFF8E80A6),
      accentColor: Color(0xFF7C5295),
      surfaceColor: Color(0xFFEBE5F2),
      borderColor: Color(0xFFDFD5E8),
      isDark: false,
    ),
    // 8. 슬레이트 블루 (차분하고 세련된 그레이블루)
    ReaderThemeData(
      id: 'slate',
      name: '슬레이트 블루',
      background: Color(0xFF212836),
      textColor: Color(0xFFE2E8F0),
      subTextColor: Color(0xFF94A3B8),
      originalTextColor: Color(0xFF64748B),
      accentColor: Color(0xFF60A5FA),
      surfaceColor: Color(0xFF2B3446),
      borderColor: Color(0xFF384359),
      isDark: true,
    ),
    // 9. 모던 차콜 (세련된 다크 그레이)
    ReaderThemeData(
      id: 'charcoal',
      name: '모던 차콜',
      background: Color(0xFF1E2024),
      textColor: Color(0xFFE5E7EB),
      subTextColor: Color(0xFF9CA3AF),
      originalTextColor: Color(0xFF6B7280),
      accentColor: Color(0xFF10B981),
      surfaceColor: Color(0xFF282B30),
      borderColor: Color(0xFF374151),
      isDark: true,
    ),
    // 10. 미드나이트 네이비 (깊은 심야의 서재)
    ReaderThemeData(
      id: 'midnight',
      name: '미드나이트 네이비',
      background: Color(0xFF0F172A),
      textColor: Color(0xFFE2E8F0),
      subTextColor: Color(0xFF818CF8),
      originalTextColor: Color(0xFF64748B),
      accentColor: Color(0xFF38BDF8),
      surfaceColor: Color(0xFF1E293B),
      borderColor: Color(0xFF334155),
      isDark: true,
    ),
    // 11. 다크 모카 (따뜻한 다크 브라운)
    ReaderThemeData(
      id: 'mocha',
      name: '다크 모카',
      background: Color(0xFF211B17),
      textColor: Color(0xFFEEDCCF),
      subTextColor: Color(0xFFA89182),
      originalTextColor: Color(0xFF7D6B5F),
      accentColor: Color(0xFFD97706),
      surfaceColor: Color(0xFF2C241F),
      borderColor: Color(0xFF3D322C),
      isDark: true,
    ),
    // 12. OLED 퓨어 블랙 (배터리 극소화 & E-ink 겸용 완벽 블랙)
    ReaderThemeData(
      id: 'oled',
      name: 'OLED 퓨어 블랙',
      background: Color(0xFF000000),
      textColor: Color(0xFFEDEDED),
      subTextColor: Color(0xFF888888),
      originalTextColor: Color(0xFF555555),
      accentColor: Color(0xFFFFFFFF),
      surfaceColor: Color(0xFF121212),
      borderColor: Color(0xFF242424),
      isDark: true,
    ),
  ];

  /// 현재 설정된 사용자 리더 테마 반환 (미초기화 시 기본 테마 반환)
  static ReaderThemeData get currentTheme {
    try {
      return getTheme(PreferencesService.theme);
    } catch (_) {
      return allThemes.first;
    }
  }

  static ReaderThemeData getTheme(String id) {
    return allThemes.firstWhere(
      (t) => t.id == id,
      orElse: () => allThemes[0],
    );
  }
}
