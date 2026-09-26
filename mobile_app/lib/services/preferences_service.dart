import 'package:shared_preferences/shared_preferences.dart';

class PreferencesService {
  static late SharedPreferences _prefs;

  static Future<void> init() async {
    _prefs = await SharedPreferences.getInstance();
  }

  // --- 테마 12종 ---
  // paper, cream, white, sepia, mint, rose, lavender, slate, charcoal, midnight, mocha, oled
  static String get theme => _prefs.getString('reader_theme') ?? 'paper';
  static Future<void> setTheme(String value) => _prefs.setString('reader_theme', value);

  // --- 언어별 독립 폰트 설정 (사용자 코멘트 반영) ---
  // 한국어 폰트: KoPubBatang, NanumMyeongjo, Pretendard, SystemDefault
  static String get koreanFont => _prefs.getString('font_korean') ?? 'KoPubBatang';
  static Future<void> setKoreanFont(String value) => _prefs.setString('font_korean', value);

  // 일본어 폰트: NotoSerifJP, NotoSansJP, ShipporiMincho, SystemDefault
  static String get japaneseFont => _prefs.getString('font_japanese') ?? 'NotoSerifJP';
  static Future<void> setJapaneseFont(String value) => _prefs.setString('font_japanese', value);

  // 시스템 UI 폰트
  static String get systemFont => _prefs.getString('font_system') ?? 'Pretendard';
  static Future<void> setSystemFont(String value) => _prefs.setString('font_system', value);

  // --- 뷰어 레이아웃 & 타이포그래피 ---
  static double get fontSize => _prefs.getDouble('reader_font_size') ?? 19.0;
  static Future<void> setFontSize(double value) => _prefs.setDouble('reader_font_size', value);

  static double get lineHeight => _prefs.getDouble('reader_line_height') ?? 1.85;
  static Future<void> setLineHeight(double value) => _prefs.setDouble('reader_line_height', value);

  static double get horizontalPadding => _prefs.getDouble('reader_horiz_padding') ?? 22.0;
  static Future<void> setHorizontalPadding(double value) => _prefs.setDouble('reader_horiz_padding', value);

  static double get paragraphSpacing => _prefs.getDouble('reader_paragraph_spacing') ?? 14.0;
  static Future<void> setParagraphSpacing(double value) => _prefs.setDouble('reader_paragraph_spacing', value);

  // 뷰어 모드: 'paging' (기성 전자책 좌우 넘김) vs 'scroll' (웹툰/웹소설 스크롤)
  static String get viewMode => _prefs.getString('reader_view_mode') ?? 'paging';
  static Future<void> setViewMode(String value) => _prefs.setString('reader_view_mode', value);

  // 원문 표시 모드: 'hidden' (번역문만), 'bilingual' (대역 병기), 'tooltip' (탭하여 팝업)
  static String get originalTextMode => _prefs.getString('original_text_mode') ?? 'tooltip';
  static Future<void> setOriginalTextMode(String value) => _prefs.setString('original_text_mode', value);

  // 하드웨어 연동
  static bool get volumeKeyPaging => _prefs.getBool('volume_key_paging') ?? true;
  static Future<void> setVolumeKeyPaging(bool value) => _prefs.setBool('volume_key_paging', value);

  static bool get keepScreenOn => _prefs.getBool('keep_screen_on') ?? true;
  static Future<void> setKeepScreenOn(bool value) => _prefs.setBool('keep_screen_on', value);

  // 서재 뷰 모드 ('grid' vs 'list')
  static String get libraryViewMode => _prefs.getString('library_view_mode') ?? 'grid';
  static Future<void> setLibraryViewMode(String value) => _prefs.setString('library_view_mode', value);

  // --- 지정된 Wi-Fi 2개 설정 (사용자 코멘트 반영) ---
  static String get trustedWifi1 => _prefs.getString('trusted_wifi_1') ?? '';
  static Future<void> setTrustedWifi1(String value) => _prefs.setString('trusted_wifi_1', value);

  static String get trustedWifi2 => _prefs.getString('trusted_wifi_2') ?? '';
  static Future<void> setTrustedWifi2(String value) => _prefs.setString('trusted_wifi_2', value);

  // PC 서버 주소 (기본값: http://192.168.219.103:8001)
  static String get serverUrl => _prefs.getString('pc_server_url') ?? 'http://192.168.219.103:8001';
  static Future<void> setServerUrl(String value) => _prefs.setString('pc_server_url', normalizeServerUrl(value));

  static String normalizeServerUrl(String raw) {
    var url = raw.trim();
    if (url.isEmpty) return 'http://192.168.219.103:8001';
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'http://$url';
    }
    // http:// 이고 포트가 생략된 사설 IP/도메인인 경우에만 기본 8001 추가 (https:// 도메인은 표준 443 유지)
    final uri = Uri.tryParse(url);
    if (uri != null && uri.scheme == 'http' && (!uri.hasPort || uri.port == 0) && !uri.host.contains(':')) {
      if (uri.path.isEmpty || uri.path == '/') {
        url = '${uri.scheme}://${uri.host}:8001';
      }
    }
    return url.replaceAll(RegExp(r'/+$'), '');
  }

  static int get lastSyncedTimestamp => _prefs.getInt('last_synced_timestamp') ?? 0;
  static Future<void> setLastSyncedTimestamp(int value) => _prefs.setInt('last_synced_timestamp', value);

  // UI 접기/가리기 설정
  static bool get hideWifiSection => _prefs.getBool('hide_wifi_section') ?? (trustedWifi1.isNotEmpty || trustedWifi2.isNotEmpty);
  static Future<void> setHideWifiSection(bool value) => _prefs.setBool('hide_wifi_section', value);

  static bool get hideServerSection => _prefs.getBool('hide_server_section') ?? false;
  static Future<void> setHideServerSection(bool value) => _prefs.setBool('hide_server_section', value);

  // --- 알림 설정 ---
  static bool get enableSystemNotification => _prefs.getBool('enable_system_notification') ?? true;
  static Future<void> setEnableSystemNotification(bool value) => _prefs.setBool('enable_system_notification', value);

  static bool get enableDashboardNotification => _prefs.getBool('enable_dashboard_notification') ?? true;
  static Future<void> setEnableDashboardNotification(bool value) => _prefs.setBool('enable_dashboard_notification', value);
}
