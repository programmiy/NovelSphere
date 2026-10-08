import 'package:flutter/material.dart';
import '../../models/book.dart';
import '../../models/glossary_rule.dart';
import '../../services/local_db_service.dart';
import '../../services/preferences_service.dart';
import '../themes/reader_themes.dart';
import 'character_fixer_screen.dart';
import '../ai_review/ai_review_screen.dart';

class GlossaryScreen extends StatefulWidget {
  const GlossaryScreen({super.key});

  @override
  State<GlossaryScreen> createState() => _GlossaryScreenState();
}

class _GlossaryScreenState extends State<GlossaryScreen> {
  final TextEditingController _findController = TextEditingController();
  final TextEditingController _replaceController = TextEditingController();

  List<Book> _books = [];
  String _selectedScope = '__all__';
  bool _useRegex = false;
  bool _caseSensitive = false;
  bool _isProcessing = false;
  List<GlossaryRule> _recentRules = [];

  @override
  void initState() {
    super.initState();
    _loadBooksAndRules();
  }

  Future<void> _loadBooksAndRules() async {
    final books = await LocalDbService.getBooks(sort: 'name');
    final db = await LocalDbService.database;
    final ruleRows = await db.query('local_glossary', orderBy: 'id DESC', limit: 20);
    final rules = ruleRows.map((r) => GlossaryRule.fromMap(r)).toList();

    setState(() {
      _books = books;
      _recentRules = rules;
    });
  }

  Future<void> _executeReplace() async {
    final find = _findController.text.trim();
    final replace = _replaceController.text;

    if (find.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('찾을 단어를 입력해 주세요.')),
      );
      return;
    }

    setState(() => _isProcessing = true);

    final rule = GlossaryRule(
      folderScope: _selectedScope,
      findText: find,
      replaceText: replace,
      useRegex: _useRegex,
      caseSensitive: _caseSensitive,
      appliedAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
    );

    final replacedCount = await LocalDbService.applyGlossaryRule(rule);
    await _loadBooksAndRules();

    setState(() => _isProcessing = false);

    if (mounted) {
      showDialog(
        context: context,
        builder: (ctx) => AlertDialog(
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          title: const Row(
            children: [
              Icon(Icons.check_circle_rounded, color: Colors.green),
              SizedBox(width: 8),
              Text('찾아바꾸기 완료'),
            ],
          ),
          content: Text(
            '총 $replacedCount개의 문장에서 "$find" 단어를 교체했습니다.\nPC 서버와 연결 시 서버 DB에도 자동으로 동기화됩니다.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: const Text('확인'),
            ),
          ],
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surfaceColor,
        elevation: 0,
        title: Text(
          '용어 및 찾아바꾸기',
          style: TextStyle(color: theme.textColor, fontSize: 18, fontWeight: FontWeight.bold),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.auto_fix_high_rounded),
            tooltip: '스마트 인명 교정기',
            color: theme.accentColor,
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const CharacterFixerScreen()),
              );
            },
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // AI 번역 검수 스튜디오 (Tinder 슬라이드 검수 & 2차 재재번역)
            InkWell(
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const AiReviewScreen()),
                );
              },
              borderRadius: BorderRadius.circular(14),
              child: Container(
                margin: const EdgeInsets.only(bottom: 16),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      Colors.amber.withOpacity(0.22),
                      Colors.amber.withOpacity(0.08),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: Colors.amber.withOpacity(0.5), width: 1.2),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.04),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        gradient: const LinearGradient(colors: [Colors.amber, Colors.orange]),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.swipe_rounded, color: Colors.white, size: 24),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(
                                'AI 번역 검수 스튜디오',
                                style: TextStyle(
                                  fontSize: 16,
                                  fontWeight: FontWeight.bold,
                                  color: theme.textColor,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: Colors.amber.withOpacity(0.2),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: const Text(
                                  '슬라이드 검수',
                                  style: TextStyle(color: Colors.amber, fontSize: 10, fontWeight: FontWeight.bold),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '슬라이드로 승인/거절, 되돌리기 슬라이드, Reroll, 다중 모델 재재번역',
                            style: TextStyle(
                              fontSize: 12,
                              color: theme.subTextColor,
                              height: 1.3,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.arrow_forward_ios_rounded, size: 16, color: theme.subTextColor),
                  ],
                ),
              ),
            ),
            // 인명/고유명사 스마트 교정기 (PC 서버 연동) 진입 배너 카드
            InkWell(
              onTap: () {
                Navigator.push(
                  context,
                  MaterialPageRoute(builder: (_) => const CharacterFixerScreen()),
                );
              },
              borderRadius: BorderRadius.circular(14),
              child: Container(
                margin: const EdgeInsets.only(bottom: 24),
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      theme.accentColor.withOpacity(0.18),
                      theme.accentColor.withOpacity(0.06),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(color: theme.accentColor.withOpacity(0.4), width: 1.2),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.04),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        color: theme.accentColor,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: const Icon(Icons.auto_fix_high_rounded, color: Colors.white, size: 24),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Text(
                                '인명·고유명사 교정기',
                                style: TextStyle(
                                  color: theme.textColor,
                                  fontSize: 15,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                              const SizedBox(width: 8),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: Colors.deepOrangeAccent.withOpacity(0.2),
                                  borderRadius: BorderRadius.circular(6),
                                ),
                                child: const Text(
                                  'PC 연동',
                                  style: TextStyle(
                                    color: Colors.deepOrangeAccent,
                                    fontSize: 10,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 4),
                          Text(
                            '틴더식 스와이프 검수 • 오독 통계 자동 발굴 • 실시간 Diff',
                            style: TextStyle(color: theme.subTextColor, fontSize: 11.5),
                          ),
                        ],
                      ),
                    ),
                    Icon(Icons.arrow_forward_ios_rounded, size: 16, color: theme.accentColor),
                  ],
                ),
              ),
            ),

            // 대상 범위 선택 드롭다운
            Text(
              '오프라인 일괄 찾아바꾸기',
              style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 16),
            ),
            const SizedBox(height: 4),
            Text(
              '스마트폰 내에 다운로드된 문단 텍스트를 즉시 교체합니다.',
              style: TextStyle(color: theme.subTextColor, fontSize: 12),
            ),
            const SizedBox(height: 14),
            Text(
              '대상 소설 범위',
              style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14),
            ),
            const SizedBox(height: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 14),
              decoration: BoxDecoration(
                color: theme.surfaceColor,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: theme.borderColor),
              ),
              child: DropdownButtonHideUnderline(
                child: DropdownButton<String>(
                  value: _selectedScope,
                  isExpanded: true,
                  dropdownColor: theme.surfaceColor,
                  items: [
                    DropdownMenuItem(
                      value: '__all__',
                      child: Text('전체 소설 (서재 내 모든 책)', style: TextStyle(color: theme.textColor)),
                    ),
                    ..._books.map((b) {
                      return DropdownMenuItem(
                        value: b.folderName,
                        child: Text(b.folderName, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: theme.textColor)),
                      );
                    }),
                  ],
                  onChanged: (val) {
                    if (val != null) setState(() => _selectedScope = val);
                  },
                ),
              ),
            ),
            const SizedBox(height: 16),
            // 찾을 단어 필드
            Text('찾을 단어 (Find)', style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 8),
            TextField(
              controller: _findController,
              style: TextStyle(color: theme.textColor),
              decoration: InputDecoration(
                filled: true,
                fillColor: theme.surfaceColor,
                hintText: '교체할 원본 단어를 입력하세요',
                hintStyle: TextStyle(color: theme.subTextColor.withOpacity(0.5)),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: theme.borderColor)),
              ),
            ),
            const SizedBox(height: 16),
            // 바꿀 단어 필드
            Text('바꿀 단어 (Replace)', style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 8),
            TextField(
              controller: _replaceController,
              style: TextStyle(color: theme.textColor),
              decoration: InputDecoration(
                filled: true,
                fillColor: theme.surfaceColor,
                hintText: '새로운 단어를 입력하세요 (비워두면 삭제)',
                hintStyle: TextStyle(color: theme.subTextColor.withOpacity(0.5)),
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: theme.borderColor)),
              ),
            ),
            const SizedBox(height: 16),
            // 옵션 체크박스들
            Row(
              children: [
                Checkbox(
                  value: _caseSensitive,
                  activeColor: theme.accentColor,
                  onChanged: (v) => setState(() => _caseSensitive = v ?? false),
                ),
                Text('대소문자 구분', style: TextStyle(color: theme.textColor, fontSize: 13)),
                const SizedBox(width: 16),
                Checkbox(
                  value: _useRegex,
                  activeColor: theme.accentColor,
                  onChanged: (v) => setState(() => _useRegex = v ?? false),
                ),
                Text('정규표현식 (Regex)', style: TextStyle(color: theme.textColor, fontSize: 13)),
              ],
            ),
            const SizedBox(height: 20),
            // 실행 버튼
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: theme.accentColor,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                onPressed: _isProcessing ? null : _executeReplace,
                icon: _isProcessing
                    ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                    : const Icon(Icons.find_replace_rounded),
                label: Text(
                  _isProcessing ? '로컬 소설 데이터 치환 중...' : '일괄 찾아바꾸기 실행',
                  style: const TextStyle(fontWeight: FontWeight.bold),
                ),
              ),
            ),
            const SizedBox(height: 32),
            // 최근 실행 이력
            Text(
              '최근 적용한 찾아바꾸기 규칙 (PC 동기화 연동)',
              style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 15),
            ),
            const SizedBox(height: 10),
            if (_recentRules.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 16),
                child: Text('아직 등록된 찾아바꾸기 룰이 없습니다.', style: TextStyle(color: theme.subTextColor, fontSize: 13)),
              )
            else
              ListView.separated(
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                itemCount: _recentRules.length,
                separatorBuilder: (_, __) => Divider(color: theme.borderColor, height: 1),
                itemBuilder: (context, index) {
                  final r = _recentRules[index];
                  return ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Row(
                      children: [
                        Text(r.findText, style: TextStyle(color: theme.accentColor, fontWeight: FontWeight.bold)),
                        const SizedBox(width: 6),
                        Icon(Icons.arrow_forward_rounded, size: 14, color: theme.subTextColor),
                        const SizedBox(width: 6),
                        Text(r.replaceText.isEmpty ? '(삭제)' : r.replaceText, style: TextStyle(color: theme.textColor)),
                      ],
                    ),
                    subtitle: Text(
                      '범위: ${r.folderScope == '__all__' ? '전체' : r.folderScope} | ${r.useRegex ? '정규식' : '일반'}',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11),
                    ),
                  );
                },
              ),
          ],
        ),
      ),
    );
  }
}
