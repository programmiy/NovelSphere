import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../models/book.dart';
import '../../models/glossary_rule.dart';
import '../../models/find_replace_item.dart';
import '../../services/local_db_service.dart';
import '../../services/preferences_service.dart';
import '../../services/text_diff_helper.dart';
import '../themes/reader_themes.dart';
import '../themes/hyper_aesthetic_theme.dart';

/// 하이퍼 에스테틱 찾아바꾸기 & 용어 스튜디오 (Hyper-Aesthetic Find & Replace Studio)
class GlossaryScreen extends StatefulWidget {
  const GlossaryScreen({super.key});

  @override
  State<GlossaryScreen> createState() => _GlossaryScreenState();
}

class _GlossaryScreenState extends State<GlossaryScreen> with SingleTickerProviderStateMixin {
  late TabController _tabController;

  // Controllers
  final TextEditingController _findController = TextEditingController();
  final TextEditingController _replaceController = TextEditingController();
  final TextEditingController _conditionController = TextEditingController();

  // Search State & Options
  List<Book> _books = [];
  String _selectedScope = '__all__';
  String _selectedScopeTitle = '전체 소설 (서재 내 모든 책)';
  bool _useRegex = false;
  bool _caseSensitive = false;
  bool _showConditionInput = false;

  // Live Preview State
  bool _isSearching = false;
  bool _isReplacing = false;
  List<FindReplaceItem> _previewResults = [];
  final Set<String> _selectedItemKeys = {};
  Timer? _searchDebounce;

  // Rules & History State
  List<GlossaryRule> _recentRules = [];
  bool _isLoadingRules = false;

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 2, vsync: this);
    _loadBooksAndRules();

    _findController.addListener(_onFindTextChanged);
    _replaceController.addListener(_onReplaceTextChanged);
    _conditionController.addListener(_onConditionTextChanged);
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    _findController.dispose();
    _replaceController.dispose();
    _conditionController.dispose();
    _tabController.dispose();
    super.dispose();
  }

  void _onFindTextChanged() {
    setState(() {});
    _triggerDebouncedSearch();
  }

  void _onReplaceTextChanged() {
    setState(() {});
    _triggerDebouncedSearch();
  }

  void _onConditionTextChanged() {
    setState(() {});
    _triggerDebouncedSearch();
  }

  void _triggerDebouncedSearch() {
    _searchDebounce?.cancel();
    final find = _findController.text.trim();
    if (find.isEmpty) {
      if (_previewResults.isNotEmpty) {
        setState(() {
          _previewResults = [];
          _selectedItemKeys.clear();
          _isSearching = false;
        });
      }
      return;
    }

    _searchDebounce = Timer(const Duration(milliseconds: 380), () {
      _executePreviewSearch();
    });
  }

  Future<void> _loadBooksAndRules() async {
    setState(() => _isLoadingRules = true);
    final books = await LocalDbService.getBooks(sort: 'name');
    final db = await LocalDbService.database;
    final ruleRows = await db.query('local_glossary', orderBy: 'id DESC', limit: 50);
    final rules = ruleRows.map((r) => GlossaryRule.fromMap(r)).toList();

    if (!mounted) return;
    setState(() {
      _books = books;
      _recentRules = rules;
      _isLoadingRules = false;
    });
  }

  /// 실시간 미리보기 검색 실행 (Live Preview Inspector)
  Future<void> _executePreviewSearch() async {
    final find = _findController.text.trim();
    if (find.isEmpty) return;

    final replace = _replaceController.text;
    final condition = _showConditionInput ? _conditionController.text.trim() : null;

    setState(() => _isSearching = true);

    try {
      final items = await LocalDbService.previewFindReplace(
        findText: find,
        replaceText: replace,
        folderScope: _selectedScope,
        conditionText: condition,
        useRegex: _useRegex,
        caseSensitive: _caseSensitive,
        limit: 200,
      );

      if (!mounted) return;
      setState(() {
        _previewResults = items;
        // 기본적으로 모든 검색 결과를 선택 상태로 지정
        _selectedItemKeys.clear();
        for (var it in items) {
          _selectedItemKeys.add(it.uniqueKey);
        }
        _isSearching = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() => _isSearching = false);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('검색 오류: ${e.toString()}'),
          backgroundColor: Colors.redAccent,
          behavior: SnackBarBehavior.floating,
        ),
      );
    }
  }

  /// 찾을 단어 <-> 바꿀 단어 교환 (Swap)
  void _swapFindAndReplace() {
    HapticFeedback.selectionClick();
    final temp = _findController.text;
    _findController.text = _replaceController.text;
    _replaceController.text = temp;
  }

  /// 대상 소설 선택 바텀시트
  void _showBookPickerSheet(ReaderThemeData theme) {
    HapticFeedback.lightImpact();
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) {
        String query = '';
        return StatefulBuilder(
          builder: (context, setSheetState) {
            final filteredBooks = _books.where((b) {
              if (query.isEmpty) return true;
              return b.folderName.toLowerCase().contains(query.toLowerCase());
            }).toList();

            return Container(
              height: MediaQuery.of(context).size.height * 0.75,
              decoration: BoxDecoration(
                color: theme.surfaceColor,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
                border: Border.all(color: theme.borderColor.withOpacity(0.5)),
              ),
              child: Column(
                children: [
                  // 상단 드래그 핸들
                  Container(
                    margin: const EdgeInsets.only(top: 12, bottom: 8),
                    width: 40,
                    height: 4,
                    decoration: BoxDecoration(
                      color: theme.subTextColor.withOpacity(0.3),
                      borderRadius: BorderRadius.circular(2),
                    ),
                  ),
                  Padding(
                    padding: const EdgeInsets.fromLTRB(20, 8, 20, 12),
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          '대상 소설 선택',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.bold,
                            color: theme.textColor,
                          ),
                        ),
                        Text(
                          '총 ${_books.length}권',
                          style: TextStyle(fontSize: 13, color: theme.subTextColor),
                        ),
                      ],
                    ),
                  ),
                  // 소설 검색 인풋
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                    child: TextField(
                      style: TextStyle(color: theme.textColor, fontSize: 14),
                      decoration: InputDecoration(
                        hintText: '소설 제목 검색...',
                        hintStyle: TextStyle(color: theme.subTextColor.withOpacity(0.6)),
                        prefixIcon: Icon(Icons.search_rounded, color: theme.accentColor, size: 20),
                        filled: true,
                        fillColor: theme.background,
                        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: theme.borderColor),
                        ),
                        enabledBorder: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(color: theme.borderColor.withOpacity(0.6)),
                        ),
                      ),
                      onChanged: (val) => setSheetState(() => query = val),
                    ),
                  ),
                  const Divider(height: 16),
                  Expanded(
                    child: ListView(
                      children: [
                        // 전체 소설 옵션
                        ListTile(
                          leading: CircleAvatar(
                            backgroundColor: _selectedScope == '__all__'
                                ? theme.accentColor
                                : theme.accentColor.withOpacity(0.15),
                            child: Icon(
                              Icons.auto_stories_rounded,
                              color: _selectedScope == '__all__' ? Colors.white : theme.accentColor,
                              size: 20,
                            ),
                          ),
                          title: Text(
                            '전체 소설 (서재 내 모든 책)',
                            style: TextStyle(
                              color: theme.textColor,
                              fontWeight: _selectedScope == '__all__' ? FontWeight.bold : FontWeight.normal,
                            ),
                          ),
                          subtitle: Text('모든 소설의 번역 문단을 대상으로 일괄 적용합니다.',
                              style: TextStyle(color: theme.subTextColor, fontSize: 11.5)),
                          trailing: _selectedScope == '__all__'
                              ? Icon(Icons.check_circle_rounded, color: theme.accentColor)
                              : null,
                          onTap: () {
                            setState(() {
                              _selectedScope = '__all__';
                              _selectedScopeTitle = '전체 소설 (서재 내 모든 책)';
                            });
                            Navigator.pop(ctx);
                            _triggerDebouncedSearch();
                          },
                        ),
                        const Divider(height: 1),
                        ...filteredBooks.map((b) {
                          final isSelected = (_selectedScope == b.folderName);
                          return ListTile(
                            leading: CircleAvatar(
                              backgroundColor: isSelected
                                  ? theme.accentColor
                                  : theme.background,
                              child: Icon(
                                Icons.book_rounded,
                                color: isSelected ? Colors.white : theme.subTextColor,
                                size: 18,
                              ),
                            ),
                            title: Text(
                              b.folderName,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: TextStyle(
                                color: theme.textColor,
                                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
                              ),
                            ),
                            subtitle: Text('총 ${b.totalChapters}화 저장됨',
                                style: TextStyle(color: theme.subTextColor, fontSize: 11)),
                            trailing: isSelected
                                ? Icon(Icons.check_circle_rounded, color: theme.accentColor)
                                : null,
                            onTap: () {
                              setState(() {
                                _selectedScope = b.folderName;
                                _selectedScopeTitle = b.folderName;
                              });
                              Navigator.pop(ctx);
                              _triggerDebouncedSearch();
                            },
                          );
                        }),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  /// 선택 항목 치환 실행
  Future<void> _executeSelectedReplace() async {
    final find = _findController.text.trim();
    final replace = _replaceController.text;
    final condition = _showConditionInput ? _conditionController.text.trim() : null;

    if (find.isEmpty) {
      _showToast('찾을 단어를 입력해 주세요.', isError: true);
      return;
    }

    final targetItems = _previewResults.where((it) => _selectedItemKeys.contains(it.uniqueKey)).toList();
    if (targetItems.isEmpty) {
      _showToast('치환할 문단을 1개 이상 선택해 주세요.', isError: true);
      return;
    }

    // 확인 다이얼로그
    final confirm = await _showConfirmDialog(
      title: '선택 문단 치환',
      message: '선택한 ${targetItems.length}개의 문장에서 "$find" 단어를 "$replace"(으)로 교체하시겠습니까?',
      confirmLabel: '선택 항목 교체 (${targetItems.length}개)',
    );
    if (confirm != true) return;

    setState(() => _isReplacing = true);

    try {
      final rule = GlossaryRule(
        folderScope: _selectedScope,
        findText: find,
        replaceText: replace,
        conditionText: condition,
        useRegex: _useRegex,
        caseSensitive: _caseSensitive,
        appliedAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
      );

      final count = await LocalDbService.applyFindReplaceItems(
        targetItems: targetItems,
        rule: rule,
      );

      await _loadBooksAndRules();
      await _executePreviewSearch();

      if (!mounted) return;
      setState(() => _isReplacing = false);

      _showSuccessSnackBar(count, find, replace, rule);
    } catch (e) {
      if (!mounted) return;
      setState(() => _isReplacing = false);
      _showToast('치환 실패: $e', isError: true);
    }
  }

  /// 전체 일괄 치환 실행
  Future<void> _executeAllReplace() async {
    final find = _findController.text.trim();
    final replace = _replaceController.text;
    final condition = _showConditionInput ? _conditionController.text.trim() : null;

    if (find.isEmpty) {
      _showToast('찾을 단어를 입력해 주세요.', isError: true);
      return;
    }

    final scopeName = _selectedScope == '__all__' ? '전체 소설' : "'$_selectedScope'";
    final confirm = await _showConfirmDialog(
      title: '전체 일괄 찾아바꾸기',
      message: '[$scopeName] 범위의 모든 회차에서 "$find" 단어를 "$replace"(으)로 일괄 교체하시겠습니까?',
      confirmLabel: '전체 일괄 교체',
      isDestructive: true,
    );
    if (confirm != true) return;

    setState(() => _isReplacing = true);

    try {
      final rule = GlossaryRule(
        folderScope: _selectedScope,
        findText: find,
        replaceText: replace,
        conditionText: condition,
        useRegex: _useRegex,
        caseSensitive: _caseSensitive,
        appliedAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
      );

      final count = await LocalDbService.applyGlossaryRule(rule);

      await _loadBooksAndRules();
      await _executePreviewSearch();

      if (!mounted) return;
      setState(() => _isReplacing = false);

      _showSuccessSnackBar(count, find, replace, rule);
    } catch (e) {
      if (!mounted) return;
      setState(() => _isReplacing = false);
      _showToast('치환 실패: $e', isError: true);
    }
  }

  /// 단일 문단 즉시 치환
  Future<void> _replaceSingleItem(FindReplaceItem item) async {
    HapticFeedback.mediumImpact();
    final rule = GlossaryRule(
      folderScope: item.bookName,
      findText: _findController.text.trim(),
      replaceText: _replaceController.text,
      conditionText: _showConditionInput ? _conditionController.text.trim() : null,
      useRegex: _useRegex,
      caseSensitive: _caseSensitive,
      appliedAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
    );

    try {
      await LocalDbService.applyFindReplaceItems(
        targetItems: [item],
        rule: rule,
      );

      setState(() {
        _previewResults.removeWhere((it) => it.uniqueKey == item.uniqueKey);
        _selectedItemKeys.remove(item.uniqueKey);
      });

      _showToast('해당 문단이 교체되었습니다.');
    } catch (e) {
      _showToast('교체 실패: $e', isError: true);
    }
  }

  /// 룰 되돌리기 (Undo / Rollback)
  Future<void> _rollbackRule(GlossaryRule rule) async {
    final confirm = await _showConfirmDialog(
      title: '규칙 되돌리기 (Undo)',
      message: '"${rule.replaceText}"(으)로 바꿨던 단어들을 다시 원래의 "${rule.findText}"(으)로 되돌리시겠습니까?',
      confirmLabel: '원래 단어로 되돌리기',
      isDestructive: true,
    );
    if (confirm != true) return;

    setState(() => _isLoadingRules = true);
    try {
      final count = await LocalDbService.rollbackGlossaryRule(rule);
      await _loadBooksAndRules();
      _showToast('총 $count개 문단에서 원래 단어로 성공적으로 되돌렸습니다.');
    } catch (e) {
      _showToast('되돌리기 실패: $e', isError: true);
    } finally {
      if (mounted) setState(() => _isLoadingRules = false);
    }
  }

  /// 룰 재실행 (Re-apply)
  Future<void> _reapplyRule(GlossaryRule rule) async {
    HapticFeedback.lightImpact();
    setState(() => _isLoadingRules = true);
    try {
      final count = await LocalDbService.applyGlossaryRule(rule);
      await _loadBooksAndRules();
      _showToast('규칙을 재적용하여 $count개 문단을 교체했습니다.');
    } catch (e) {
      _showToast('재적용 실패: $e', isError: true);
    } finally {
      if (mounted) setState(() => _isLoadingRules = false);
    }
  }

  /// 룰 삭제
  Future<void> _deleteRule(GlossaryRule rule) async {
    if (rule.id == null) return;
    await LocalDbService.deleteGlossaryRule(rule.id!);
    await _loadBooksAndRules();
    _showToast('규칙이 목록에서 삭제되었습니다.');
  }

  void _showToast(String message, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(message, style: const TextStyle(fontWeight: FontWeight.w600)),
        backgroundColor: isError ? Colors.redAccent : const Color(0xFF10B981),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      ),
    );
  }

  void _showSuccessSnackBar(int count, String find, String replace, GlossaryRule rule) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        duration: const Duration(seconds: 4),
        backgroundColor: const Color(0xFF10B981),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        content: Text(
          '총 $count개의 문장에서 "$find" -> "$replace" 치환 완료!',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        action: SnackBarAction(
          label: '되돌리기',
          textColor: Colors.white,
          onPressed: () => _rollbackRule(rule),
        ),
      ),
    );
  }

  Future<bool?> _showConfirmDialog({
    required String title,
    required String message,
    required String confirmLabel,
    bool isDestructive = false,
  }) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);
    return showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.surfaceColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(18)),
        title: Row(
          children: [
            Icon(
              isDestructive ? Icons.warning_amber_rounded : Icons.check_circle_outline_rounded,
              color: isDestructive ? Colors.amber : theme.accentColor,
              size: 26,
            ),
            const SizedBox(width: 10),
            Text(title, style: TextStyle(color: theme.textColor, fontSize: 17, fontWeight: FontWeight.bold)),
          ],
        ),
        content: Text(
          message,
          style: TextStyle(color: theme.textColor.withOpacity(0.9), fontSize: 14, height: 1.4),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text('취소', style: TextStyle(color: theme.subTextColor)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: isDestructive ? Colors.redAccent : theme.accentColor,
              foregroundColor: Colors.white,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
            ),
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(confirmLabel, style: const TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surfaceColor.withOpacity(0.9),
        elevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                gradient: LinearGradient(colors: [primary, primary.withOpacity(0.6)]),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.find_replace_rounded, color: Colors.white, size: 18),
            ),
            const SizedBox(width: 10),
            Text(
              '찾아바꾸기 스튜디오',
              style: TextStyle(color: theme.textColor, fontSize: 18, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: '목록 새로고침',
            color: theme.subTextColor,
            onPressed: () {
              HapticFeedback.lightImpact();
              _loadBooksAndRules();
              _executePreviewSearch();
            },
          ),
          const SizedBox(width: 8),
        ],
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(48),
          child: Container(
            margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
            decoration: BoxDecoration(
              color: theme.background,
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: theme.borderColor.withOpacity(0.5)),
            ),
            child: TabBar(
              controller: _tabController,
              indicatorSize: TabBarIndicatorSize.tab,
              dividerColor: Colors.transparent,
              indicator: BoxDecoration(
                color: theme.surfaceColor,
                borderRadius: BorderRadius.circular(10),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(0.06),
                    blurRadius: 4,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              labelColor: theme.accentColor,
              unselectedLabelColor: theme.subTextColor,
              labelStyle: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13.5),
              tabs: [
                const Tab(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.flash_on_rounded, size: 16),
                      SizedBox(width: 6),
                      Text('실시간 찾아바꾸기'),
                    ],
                  ),
                ),
                Tab(
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      const Icon(Icons.history_rounded, size: 16),
                      const SizedBox(width: 6),
                      Text('규칙 & 이력 (${_recentRules.length})'),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
      body: TabBarView(
        controller: _tabController,
        children: [
          _buildLiveFindReplaceTab(theme, primary),
          _buildRulesHistoryTab(theme, primary),
        ],
      ),
    );
  }

  /// =========================================================================
  /// 탭 1: 실시간 찾아바꾸기 & 인스펙터 미리보기 탭
  /// =========================================================================
  Widget _buildLiveFindReplaceTab(ReaderThemeData theme, Color primary) {
    return Stack(
      children: [
        ListView(
          // 하단 플로팅 독 및 실행 바와의 간섭을 완벽 차단하기 위해 140px 여백 확보
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 140),
          children: [
            // 1. 검색 & 치환 커맨드 패널
            _buildCommandCard(theme, primary),
            const SizedBox(height: 14),

            // 3. 실시간 매치 카운트 및 일괄 선택 HUD
            if (_findController.text.trim().isNotEmpty) ...[
              _buildMatchCounterHud(theme, primary),
              const SizedBox(height: 10),
            ],

            // 4. 미리보기 결과 인스펙터 리스트
            _buildInspectorList(theme, primary),
          ],
        ),

        // 5. 하단 고정 실행 액션 독
        if (_previewResults.isNotEmpty) _buildExecutionBottomBar(theme, primary),
      ],
    );
  }

  /// 검색 & 치환 커맨드 패널 카드
  Widget _buildCommandCard(ReaderThemeData theme, Color primary) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: theme.borderColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 1. 대상 소설 범위 선택 버튼
          InkWell(
            onTap: () => _showBookPickerSheet(theme),
            borderRadius: BorderRadius.circular(12),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: theme.background,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: theme.borderColor.withOpacity(0.7)),
              ),
              child: Row(
                children: [
                  Icon(Icons.menu_book_rounded, color: theme.accentColor, size: 18),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text('치환 대상 소설', style: TextStyle(color: theme.subTextColor, fontSize: 10.5)),
                        const SizedBox(height: 2),
                        Text(
                          _selectedScopeTitle,
                          style: TextStyle(
                            color: theme.textColor,
                            fontSize: 13.5,
                            fontWeight: FontWeight.bold,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
                  ),
                  const Icon(Icons.arrow_drop_down_rounded, size: 22),
                ],
              ),
            ),
          ),
          const SizedBox(height: 14),

          // 2. 찾을 단어 (Find) 필드
          TextField(
            controller: _findController,
            style: TextStyle(color: theme.textColor, fontSize: 14.5),
            decoration: InputDecoration(
              labelText: '찾을 원본 단어 (Find)',
              labelStyle: TextStyle(color: theme.subTextColor, fontSize: 13),
              hintText: '교체할 단어를 입력하세요',
              hintStyle: TextStyle(color: theme.subTextColor.withOpacity(0.5)),
              prefixIcon: Icon(Icons.search_rounded, color: theme.accentColor, size: 20),
              suffixIcon: _findController.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear_rounded, size: 18),
                      onPressed: () => _findController.clear(),
                    )
                  : null,
              filled: true,
              fillColor: theme.background,
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: theme.borderColor)),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: theme.borderColor)),
              focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: theme.accentColor, width: 1.5)),
            ),
          ),
          const SizedBox(height: 8),

          // 3. 교환 (Swap) 버튼 중앙 정렬 바
          Center(
            child: InkWell(
              onTap: _swapFindAndReplace,
              borderRadius: BorderRadius.circular(20),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(
                  color: theme.background,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: theme.borderColor),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.swap_vert_rounded, size: 16, color: theme.subTextColor),
                    const SizedBox(width: 4),
                    Text('단어 맞바꾸기 (Swap)', style: TextStyle(color: theme.subTextColor, fontSize: 11)),
                  ],
                ),
              ),
            ),
          ),
          const SizedBox(height: 8),

          // 4. 바꿀 단어 (Replace) 필드
          TextField(
            controller: _replaceController,
            style: TextStyle(color: theme.textColor, fontSize: 14.5),
            decoration: InputDecoration(
              labelText: '새 단어 (Replace)',
              labelStyle: TextStyle(color: theme.subTextColor, fontSize: 13),
              hintText: '새로운 단어 (비워두면 삭제)',
              hintStyle: TextStyle(color: theme.subTextColor.withOpacity(0.5)),
              prefixIcon: const Icon(Icons.edit_note_rounded, color: Color(0xFF10B981), size: 20),
              suffixIcon: _replaceController.text.isNotEmpty
                  ? IconButton(
                      icon: const Icon(Icons.clear_rounded, size: 18),
                      onPressed: () => _replaceController.clear(),
                    )
                  : null,
              filled: true,
              fillColor: theme.background,
              contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: theme.borderColor)),
              enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: BorderSide(color: theme.borderColor)),
              focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(12), borderSide: const BorderSide(color: Color(0xFF10B981), width: 1.5)),
            ),
          ),
          const SizedBox(height: 12),

          // 5. 옵션 칩 세그먼트 (대소문자 / 정규식 / 원문조건)
          Wrap(
            spacing: 8,
            runSpacing: 6,
            children: [
              FilterChip(
                label: const Text('대소문자 구분'),
                selected: _caseSensitive,
                selectedColor: theme.accentColor.withOpacity(0.2),
                checkmarkColor: theme.accentColor,
                labelStyle: TextStyle(
                  color: _caseSensitive ? theme.accentColor : theme.subTextColor,
                  fontSize: 12,
                  fontWeight: _caseSensitive ? FontWeight.bold : FontWeight.normal,
                ),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: _caseSensitive ? theme.accentColor : theme.borderColor)),
                onSelected: (val) {
                  setState(() => _caseSensitive = val);
                  _triggerDebouncedSearch();
                },
              ),
              FilterChip(
                label: const Text('정규식 (Regex)'),
                selected: _useRegex,
                selectedColor: theme.accentColor.withOpacity(0.2),
                checkmarkColor: theme.accentColor,
                labelStyle: TextStyle(
                  color: _useRegex ? theme.accentColor : theme.subTextColor,
                  fontSize: 12,
                  fontWeight: _useRegex ? FontWeight.bold : FontWeight.normal,
                ),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: _useRegex ? theme.accentColor : theme.borderColor)),
                onSelected: (val) {
                  setState(() => _useRegex = val);
                  _triggerDebouncedSearch();
                },
              ),
              FilterChip(
                label: const Text('원문 조건 필터'),
                selected: _showConditionInput,
                selectedColor: Colors.deepOrangeAccent.withOpacity(0.2),
                checkmarkColor: Colors.deepOrangeAccent,
                labelStyle: TextStyle(
                  color: _showConditionInput ? Colors.deepOrangeAccent : theme.subTextColor,
                  fontSize: 12,
                  fontWeight: _showConditionInput ? FontWeight.bold : FontWeight.normal,
                ),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10), side: BorderSide(color: _showConditionInput ? Colors.deepOrangeAccent : theme.borderColor)),
                onSelected: (val) {
                  setState(() => _showConditionInput = val);
                  _triggerDebouncedSearch();
                },
              ),
            ],
          ),

          // 6. 원문 조건 필터 입력창 (토글 시 노출)
          if (_showConditionInput) ...[
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.deepOrangeAccent.withOpacity(0.06),
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: Colors.deepOrangeAccent.withOpacity(0.3)),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.filter_alt_rounded, size: 16, color: Colors.deepOrangeAccent),
                      const SizedBox(width: 6),
                      Text(
                        '원문(Original) 포함 조건',
                        style: TextStyle(
                          color: theme.textColor,
                          fontSize: 12.5,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '일본어 원문에 아래 단어가 포함된 문단만 골라서 치환합니다. (예: 魔王)',
                    style: TextStyle(color: theme.subTextColor, fontSize: 11),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: _conditionController,
                    style: TextStyle(color: theme.textColor, fontSize: 13.5),
                    decoration: InputDecoration(
                      hintText: '원문에 포함되어야 할 일본어 단어',
                      hintStyle: TextStyle(color: theme.subTextColor.withOpacity(0.5)),
                      filled: true,
                      fillColor: theme.surfaceColor,
                      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide(color: theme.borderColor)),
                      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide(color: theme.borderColor)),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  /// 검색 결과 상태 카운터 HUD
  Widget _buildMatchCounterHud(ReaderThemeData theme, Color primary) {
    final matchCount = _previewResults.length;
    final selectedCount = _selectedItemKeys.length;
    final allSelected = matchCount > 0 && selectedCount == matchCount;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.borderColor),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(
                  color: matchCount > 0 ? const Color(0xFF10B981) : Colors.amber,
                  shape: BoxShape.circle,
                ),
              ),
              const SizedBox(width: 8),
              Text(
                _isSearching ? '검색 중...' : '검색 결과: 총 $matchCount개 문단 일치',
                style: TextStyle(
                  color: theme.textColor,
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          if (matchCount > 0)
            InkWell(
              onTap: () {
                HapticFeedback.selectionClick();
                setState(() {
                  if (allSelected) {
                    _selectedItemKeys.clear();
                  } else {
                    for (var it in _previewResults) {
                      _selectedItemKeys.add(it.uniqueKey);
                    }
                  }
                });
              },
              child: Row(
                children: [
                  Icon(
                    allSelected ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded,
                    size: 18,
                    color: allSelected ? theme.accentColor : theme.subTextColor,
                  ),
                  const SizedBox(width: 4),
                  Text(
                    allSelected ? '전체 해제' : '전체 선택',
                    style: TextStyle(
                      color: allSelected ? theme.accentColor : theme.subTextColor,
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }

  /// 미리보기 결과 인스펙터 리스트
  Widget _buildInspectorList(ReaderThemeData theme, Color primary) {
    if (_isSearching) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 40),
          child: Column(
            children: [
              CircularProgressIndicator(strokeWidth: 2.5, color: theme.accentColor),
              const SizedBox(height: 12),
              Text('로컬 소설 데이터 고속 인덱싱 중...', style: TextStyle(color: theme.subTextColor, fontSize: 13)),
            ],
          ),
        ),
      );
    }

    if (_findController.text.trim().isEmpty) {
      return Container(
        margin: const EdgeInsets.only(top: 20),
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: theme.surfaceColor.withOpacity(0.5),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: theme.borderColor.withOpacity(0.5)),
        ),
        child: Column(
          children: [
            Icon(Icons.manage_search_rounded, size: 48, color: theme.subTextColor.withOpacity(0.5)),
            const SizedBox(height: 12),
            Text(
              '찾을 단어를 입력하면 실시간 미리보기가 표시됩니다.',
              style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14),
            ),
            const SizedBox(height: 6),
            Text(
              '바꾸기 전/후의 문맥 차이(Diff)를 직접 확인하고,\n원하는 문단만 선택하여 안전하게 치환할 수 있습니다.',
              textAlign: TextAlign.center,
              style: TextStyle(color: theme.subTextColor, fontSize: 12, height: 1.4),
            ),
          ],
        ),
      );
    }

    if (_previewResults.isEmpty) {
      return Container(
        margin: const EdgeInsets.only(top: 20),
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(
          color: theme.surfaceColor.withOpacity(0.5),
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: theme.borderColor.withOpacity(0.5)),
        ),
        child: Column(
          children: [
            Icon(Icons.search_off_rounded, size: 44, color: theme.subTextColor.withOpacity(0.4)),
            const SizedBox(height: 12),
            Text(
              '일치하는 문단을 찾을 수 없습니다.',
              style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14),
            ),
            const SizedBox(height: 4),
            Text(
              '단어 철자, 소설 대상 범위 또는 원문 조건을 확인해 주세요.',
              style: TextStyle(color: theme.subTextColor, fontSize: 12),
            ),
          ],
        ),
      );
    }

    // 결과 목록 렌더링
    return ListView.separated(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      itemCount: _previewResults.length,
      separatorBuilder: (_, __) => const SizedBox(height: 10),
      itemBuilder: (context, index) {
        final item = _previewResults[index];
        final isSelected = _selectedItemKeys.contains(item.uniqueKey);
        return _buildInspectorCard(item, isSelected, theme, primary);
      },
    );
  }

  /// 개별 문단 미리보기 및 Diff 카드
  Widget _buildInspectorCard(FindReplaceItem item, bool isSelected, ReaderThemeData theme, Color primary) {
    return Container(
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isSelected ? theme.accentColor.withOpacity(0.7) : theme.borderColor,
          width: isSelected ? 1.4 : 1.0,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(isSelected ? 0.04 : 0.02),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 카드 상단 헤더 (소설명/회차/체크박스)
          InkWell(
            onTap: () {
              HapticFeedback.selectionClick();
              setState(() {
                if (isSelected) {
                  _selectedItemKeys.remove(item.uniqueKey);
                } else {
                  _selectedItemKeys.add(item.uniqueKey);
                }
              });
            },
            borderRadius: const BorderRadius.vertical(top: Radius.circular(14)),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
              decoration: BoxDecoration(
                color: theme.background.withOpacity(0.5),
                borderRadius: const BorderRadius.vertical(top: Radius.circular(14)),
              ),
              child: Row(
                children: [
                  Icon(
                    isSelected ? Icons.check_box_rounded : Icons.check_box_outline_blank_rounded,
                    size: 20,
                    color: isSelected ? theme.accentColor : theme.subTextColor,
                  ),
                  const SizedBox(width: 8),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                    decoration: BoxDecoration(
                      color: theme.accentColor.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(6),
                    ),
                    child: Text(
                      item.bookName,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: theme.accentColor,
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Expanded(
                    child: Text(
                      item.chapterTitle,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: theme.subTextColor, fontSize: 11.5),
                    ),
                  ),
                  Text(
                    item.pid,
                    style: TextStyle(color: theme.subTextColor.withOpacity(0.5), fontSize: 10, fontFamily: 'monospace'),
                  ),
                ],
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 원문 텍스트
                if (item.original.isNotEmpty) ...[
                  Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                        decoration: BoxDecoration(
                          color: theme.subTextColor.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(4),
                        ),
                        child: const Text('원문', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.bold)),
                      ),
                      const SizedBox(width: 6),
                      Expanded(
                        child: Text(
                          item.original,
                          style: TextStyle(color: theme.subTextColor, fontSize: 12.5),
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 10),
                  Divider(height: 1, color: theme.borderColor.withOpacity(0.5)),
                  const SizedBox(height: 10),
                ],

                // 인라인 Diff 미리보기 (Before -> After)
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                      decoration: BoxDecoration(
                        color: const Color(0xFF10B981).withOpacity(0.15),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text('미리보기', style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.bold, color: Color(0xFF10B981))),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: RichText(
                        text: TextSpan(
                          children: TextDiffHelper.buildDiffSpans(
                            ops: item.diff.ops,
                            defaultTextColor: theme.textColor,
                            isDarkMode: theme.isDark,
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 10),

                // 하단 퀵 액션: 이 문단만 치환
                Align(
                  alignment: Alignment.centerRight,
                  child: TextButton.icon(
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      visualDensity: VisualDensity.compact,
                    ),
                    onPressed: () => _replaceSingleItem(item),
                    icon: Icon(Icons.check_rounded, size: 14, color: theme.accentColor),
                    label: Text(
                      '이 문단만 치환',
                      style: TextStyle(color: theme.accentColor, fontSize: 11.5, fontWeight: FontWeight.bold),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// 하단 고정 실행 독 바 (Execution Bottom Bar)
  Widget _buildExecutionBottomBar(ReaderThemeData theme, Color primary) {
    final selectedCount = _selectedItemKeys.length;
    final totalCount = _previewResults.length;

    return Positioned(
      left: 16,
      right: 16,
      // 하단 플로팅 글래스 독(높이 약 64px + 여백) 바로 위에 뜨도록 위치 설정
      bottom: 84,
      child: SafeArea(
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: theme.surfaceColor.withOpacity(0.96),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: theme.borderColor),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.12),
                blurRadius: 16,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            children: [
              Expanded(
                flex: 6,
                child: ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: theme.accentColor,
                    foregroundColor: Colors.white,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                  onPressed: (_isReplacing || selectedCount == 0) ? null : _executeSelectedReplace,
                  icon: _isReplacing
                      ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                      : const Icon(Icons.done_all_rounded, size: 18),
                  label: Text(
                    _isReplacing ? '치환 실행 중...' : '선택 항목 교체 ($selectedCount개)',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 4,
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: theme.textColor,
                    side: BorderSide(color: theme.borderColor),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                    padding: const EdgeInsets.symmetric(vertical: 12),
                  ),
                  onPressed: _isReplacing ? null : _executeAllReplace,
                  icon: const Icon(Icons.public_rounded, size: 16),
                  label: Text(
                    '전체 치환 ($totalCount개)',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 12),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  /// =========================================================================
  /// 탭 2: 규칙 & 변경 이력 탭 (Rules & History Hub)
  /// =========================================================================
  Widget _buildRulesHistoryTab(ReaderThemeData theme, Color primary) {
    if (_isLoadingRules) {
      return Center(child: CircularProgressIndicator(color: theme.accentColor));
    }

    return ListView(
      // 하단 플로팅 독 간섭 방지 여백 확보
      padding: const EdgeInsets.fromLTRB(16, 16, 16, 120),
      children: [
        // 상단 안내 배너
        Container(
          padding: const EdgeInsets.all(16),
          decoration: BoxDecoration(
            color: theme.surfaceColor,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: theme.borderColor),
          ),
          child: Row(
            children: [
              Container(
                padding: const EdgeInsets.all(10),
                decoration: BoxDecoration(
                  color: theme.accentColor.withOpacity(0.12),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Icon(Icons.bookmark_added_rounded, color: theme.accentColor, size: 22),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      '적용된 찾아바꾸기 단어장 규칙',
                      style: TextStyle(
                        color: theme.textColor,
                        fontWeight: FontWeight.bold,
                        fontSize: 14.5,
                      ),
                    ),
                    const SizedBox(height: 3),
                    Text(
                      '적용된 규칙은 PC 서버 연결 시 서버 DB에도 자동 동기화되며, 언제든 원클릭으로 되돌릴(Undo) 수 있습니다.',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11.5, height: 1.3),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 16),

        if (_recentRules.isEmpty)
          Container(
            padding: const EdgeInsets.all(32),
            decoration: BoxDecoration(
              color: theme.surfaceColor.withOpacity(0.5),
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: theme.borderColor.withOpacity(0.5)),
            ),
            child: Column(
              children: [
                Icon(Icons.rule_folder_rounded, size: 48, color: theme.subTextColor.withOpacity(0.4)),
                const SizedBox(height: 12),
                Text('아직 등록된 찾아바꾸기 규칙이 없습니다.', style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14)),
                const SizedBox(height: 4),
                Text('첫 번째 탭에서 단어를 치환하면 이곳에 자동으로 기록됩니다.', style: TextStyle(color: theme.subTextColor, fontSize: 12)),
              ],
            ),
          )
        else
          ListView.separated(
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            itemCount: _recentRules.length,
            separatorBuilder: (_, __) => const SizedBox(height: 10),
            itemBuilder: (context, index) {
              final rule = _recentRules[index];
              return _buildRuleCard(rule, theme);
            },
          ),
      ],
    );
  }

  /// 개별 규칙 카드 (1-터치 되돌리기/재실행/삭제 지원)
  Widget _buildRuleCard(GlossaryRule rule, ReaderThemeData theme) {
    final dateStr = DateTime.fromMillisecondsSinceEpoch(rule.appliedAt * 1000)
        .toString()
        .substring(0, 16);

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.borderColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.02),
            blurRadius: 4,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // 단어 변환 태그
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: Colors.redAccent.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  rule.findText,
                  style: const TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold, fontSize: 13),
                ),
              ),
              const SizedBox(width: 8),
              Icon(Icons.arrow_forward_rounded, size: 16, color: theme.subTextColor),
              const SizedBox(width: 8),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: const Color(0xFF10B981).withOpacity(0.12),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  rule.replaceText.isEmpty ? '(삭제)' : rule.replaceText,
                  style: const TextStyle(color: Color(0xFF10B981), fontWeight: FontWeight.bold, fontSize: 13),
                ),
              ),
              const Spacer(),
              // 삭제 버튼
              IconButton(
                icon: const Icon(Icons.delete_outline_rounded, size: 18),
                color: theme.subTextColor,
                tooltip: '규칙 삭제',
                visualDensity: VisualDensity.compact,
                onPressed: () => _deleteRule(rule),
              ),
            ],
          ),
          const SizedBox(height: 8),

          // 세부 메타데이터 뱃지들
          Wrap(
            spacing: 6,
            runSpacing: 4,
            children: [
              _buildBadge('범위: ${rule.folderScope == '__all__' ? '전체 소설' : rule.folderScope}', theme),
              if (rule.conditionText != null && rule.conditionText!.isNotEmpty)
                _buildBadge('원문: "${rule.conditionText}"', theme, color: Colors.deepOrangeAccent),
              if (rule.useRegex) _buildBadge('정규식', theme, color: theme.accentColor),
              if (rule.caseSensitive) _buildBadge('대소문자', theme),
              if (rule.replacedCount > 0) _buildBadge('${rule.replacedCount}개 문단 교체됨', theme, color: const Color(0xFF10B981)),
            ],
          ),
          const SizedBox(height: 8),
          Divider(height: 1, color: theme.borderColor.withOpacity(0.5)),
          const SizedBox(height: 8),

          // 하단 날짜 및 퀵 액션 (되돌리기 / 재실행)
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(dateStr, style: TextStyle(color: theme.subTextColor, fontSize: 11)),
              Row(
                children: [
                  OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: theme.accentColor,
                      side: BorderSide(color: theme.accentColor.withOpacity(0.4)),
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      visualDensity: VisualDensity.compact,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    icon: const Icon(Icons.refresh_rounded, size: 14),
                    label: const Text('재적용', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold)),
                    onPressed: () => _reapplyRule(rule),
                  ),
                  const SizedBox(width: 8),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.amber.withOpacity(0.2),
                      foregroundColor: Colors.amber.shade900,
                      elevation: 0,
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      visualDensity: VisualDensity.compact,
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    icon: const Icon(Icons.undo_rounded, size: 14),
                    label: const Text('되돌리기 (Undo)', style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.bold)),
                    onPressed: () => _rollbackRule(rule),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildBadge(String text, ReaderThemeData theme, {Color? color}) {
    final c = color ?? theme.subTextColor;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: c.withOpacity(0.1),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Text(text, style: TextStyle(color: c, fontSize: 10.5, fontWeight: FontWeight.w600)),
    );
  }
}
