import 'package:flutter/material.dart';
import '../../services/preferences_service.dart';
import '../themes/reader_themes.dart';

class ReaderSettingsSheet extends StatefulWidget {
  final ReaderThemeData currentTheme;
  final VoidCallback onSettingsChanged;

  const ReaderSettingsSheet({
    super.key,
    required this.currentTheme,
    required this.onSettingsChanged,
  });

  @override
  State<ReaderSettingsSheet> createState() => _ReaderSettingsSheetState();
}

class _ReaderSettingsSheetState extends State<ReaderSettingsSheet> with SingleTickerProviderStateMixin {
  late TabController _tabController;

  final List<Map<String, String>> _koreanFonts = [
    {'id': 'KoPubBatang', 'name': 'KoPub 바탕'},
    {'id': 'NanumMyeongjo', 'name': '나눔 명조'},
    {'id': 'Pretendard', 'name': '프리텐다드 (고딕)'},
    {'id': 'SystemDefault', 'name': '기기 기본 폰트'},
  ];

  final List<Map<String, String>> _japaneseFonts = [
    {'id': 'NotoSerifJP', 'name': 'Noto Serif JP (명조)'},
    {'id': 'NotoSansJP', 'name': 'Noto Sans JP (고딕)'},
    {'id': 'ShipporiMincho', 'name': 'Shippori Mincho'},
    {'id': 'SystemDefault', 'name': '기기 기본 폰트'},
  ];

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.currentTheme;

    return Container(
      height: 480,
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.2),
            blurRadius: 10,
            offset: const Offset(0, -2),
          ),
        ],
      ),
      child: Column(
        children: [
          // Drag handle
          Center(
            child: Container(
              margin: const EdgeInsets.only(top: 8, bottom: 4),
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: theme.borderColor,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          // Tab Header
          TabBar(
            controller: _tabController,
            indicatorColor: theme.accentColor,
            labelColor: theme.accentColor,
            unselectedLabelColor: theme.subTextColor,
            tabs: const [
              Tab(text: '테마 (12종)'),
              Tab(text: '한/일 폰트'),
              Tab(text: '레이아웃 & 옵션'),
            ],
          ),
          Divider(color: theme.borderColor, height: 1),
          // Tab Content
          Expanded(
            child: TabBarView(
              controller: _tabController,
              children: [
                _buildThemeTab(theme),
                _buildFontTab(theme),
                _buildLayoutTab(theme),
              ],
            ),
          ),
        ],
      ),
    );
  }

  // 1. 12종 테마 선택 탭
  Widget _buildThemeTab(ReaderThemeData theme) {
    return GridView.builder(
      padding: const EdgeInsets.all(16),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 4,
        crossAxisSpacing: 10,
        mainAxisSpacing: 10,
        childAspectRatio: 1.1,
      ),
      itemCount: ReaderThemes.allThemes.length,
      itemBuilder: (context, index) {
        final t = ReaderThemes.allThemes[index];
        final isSelected = (t.id == PreferencesService.theme);

        return GestureDetector(
          onTap: () async {
            await PreferencesService.setTheme(t.id);
            setState(() {});
            widget.onSettingsChanged();
          },
          child: Container(
            decoration: BoxDecoration(
              color: t.background,
              borderRadius: BorderRadius.circular(10),
              border: Border.all(
                color: isSelected ? theme.accentColor : t.borderColor,
                width: isSelected ? 2.5 : 1.0,
              ),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Text(
                  '가A',
                  style: TextStyle(
                    color: t.textColor,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  t.name,
                  maxLines: 1,
                  style: TextStyle(
                    color: t.textColor,
                    fontSize: 10,
                    fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  // 2. 한국어/일본어 독립 폰트 선택 탭 (사용자 코멘트 반영)
  Widget _buildFontTab(ReaderThemeData theme) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(
          '한국어 번역문 폰트',
          style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: theme.background,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: theme.borderColor),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: PreferencesService.koreanFont,
              isExpanded: true,
              dropdownColor: theme.surfaceColor,
              items: _koreanFonts.map((f) {
                return DropdownMenuItem(
                  value: f['id'],
                  child: Text(f['name']!, style: TextStyle(color: theme.textColor, fontSize: 14)),
                );
              }).toList(),
              onChanged: (val) async {
                if (val != null) {
                  await PreferencesService.setKoreanFont(val);
                  setState(() {});
                  widget.onSettingsChanged();
                }
              },
            ),
          ),
        ),
        const SizedBox(height: 20),
        Text(
          '일본어 원문 폰트',
          style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14),
        ),
        const SizedBox(height: 8),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 14),
          decoration: BoxDecoration(
            color: theme.background,
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: theme.borderColor),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: PreferencesService.japaneseFont,
              isExpanded: true,
              dropdownColor: theme.surfaceColor,
              items: _japaneseFonts.map((f) {
                return DropdownMenuItem(
                  value: f['id'],
                  child: Text(f['name']!, style: TextStyle(color: theme.textColor, fontSize: 14)),
                );
              }).toList(),
              onChanged: (val) async {
                if (val != null) {
                  await PreferencesService.setJapaneseFont(val);
                  setState(() {});
                  widget.onSettingsChanged();
                }
              },
            ),
          ),
        ),
      ],
    );
  }

  // 3. 레이아웃 & 옵션 탭
  Widget _buildLayoutTab(ReaderThemeData theme) {
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        // 글자 크기
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('글자 크기', style: TextStyle(color: theme.textColor, fontSize: 14)),
            Text('${PreferencesService.fontSize.toInt()}pt', style: TextStyle(color: theme.subTextColor, fontSize: 13)),
          ],
        ),
        Slider(
          value: PreferencesService.fontSize,
          min: 14,
          max: 32,
          divisions: 18,
          activeColor: theme.accentColor,
          inactiveColor: theme.borderColor,
          onChanged: (val) async {
            await PreferencesService.setFontSize(val);
            setState(() {});
            widget.onSettingsChanged();
          },
        ),
        const SizedBox(height: 10),
        // 줄간격
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('줄간격', style: TextStyle(color: theme.textColor, fontSize: 14)),
            Text('${PreferencesService.lineHeight.toStringAsFixed(1)}배', style: TextStyle(color: theme.subTextColor, fontSize: 13)),
          ],
        ),
        Slider(
          value: PreferencesService.lineHeight,
          min: 1.3,
          max: 2.5,
          divisions: 12,
          activeColor: theme.accentColor,
          inactiveColor: theme.borderColor,
          onChanged: (val) async {
            await PreferencesService.setLineHeight(val);
            setState(() {});
            widget.onSettingsChanged();
          },
        ),
        const SizedBox(height: 10),
        // 뷰어 모드 토글 (페이징 vs 스크롤)
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text('페이지 넘김 모드 (Paging)', style: TextStyle(color: theme.textColor, fontSize: 14)),
          subtitle: Text('OFF 시 웹툰형 상하 스크롤 모드', style: TextStyle(color: theme.subTextColor, fontSize: 12)),
          value: PreferencesService.viewMode == 'paging',
          activeColor: theme.accentColor,
          onChanged: (val) async {
            await PreferencesService.setViewMode(val ? 'paging' : 'scroll');
            setState(() {});
            widget.onSettingsChanged();
          },
        ),
        // 볼륨키 넘김
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text('볼륨키로 페이지 넘기기', style: TextStyle(color: theme.textColor, fontSize: 14)),
          value: PreferencesService.volumeKeyPaging,
          activeColor: theme.accentColor,
          onChanged: (val) async {
            await PreferencesService.setVolumeKeyPaging(val);
            setState(() {});
            widget.onSettingsChanged();
          },
        ),
        // 화면 켜짐 유지
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: Text('화면 켜짐 유지 (Wakelock)', style: TextStyle(color: theme.textColor, fontSize: 14)),
          value: PreferencesService.keepScreenOn,
          activeColor: theme.accentColor,
          onChanged: (val) async {
            await PreferencesService.setKeepScreenOn(val);
            setState(() {});
            widget.onSettingsChanged();
          },
        ),
      ],
    );
  }
}
