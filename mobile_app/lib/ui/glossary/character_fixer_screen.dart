import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../models/character_fix_models.dart';
import '../../services/character_fixer_service.dart';
import '../../services/preferences_service.dart';
import '../themes/reader_themes.dart';
import '../../services/text_diff_helper.dart';

class CharacterFixerScreen extends StatefulWidget {
  final String? initialFolderName;

  const CharacterFixerScreen({super.key, this.initialFolderName});

  @override
  State<CharacterFixerScreen> createState() => _CharacterFixerScreenState();
}

class _CharacterFixerScreenState extends State<CharacterFixerScreen> with SingleTickerProviderStateMixin {
  bool _isLoading = false;
  String? _errorMessage;

  List<Map<String, dynamic>> _folders = [];
  String? _selectedFolder;

  List<CharacterRule> _rules = [];
  List<CharacterFixItem> _allItems = [];
  List<CharacterFixItem> _filteredItems = [];
  Map<String, int> _tagCounts = {};
  String _activeTag = 'all';

  int _currentIndex = 0;
  final Set<int> _approvedIds = {};
  final Set<int> _skippedIds = {};
  bool _backupDone = false;

  // Mode: 'card' or 'list'
  String _viewMode = 'card';

  // Card Mode Controllers
  late TextEditingController _cardAfterController;
  DiffResult _currentCardDiff = const DiffResult(ops: [], changes: []);

  // Shake animation for unchanged warning guard
  late AnimationController _shakeAnimController;
  late Animation<double> _shakeAnimation;

  // List Mode Controllers & Selection
  final Map<int, TextEditingController> _listControllers = {};
  final Set<int> _selectedListIds = {};
  final TextEditingController _listSearchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _cardAfterController = TextEditingController();
    _cardAfterController.addListener(_onCardInputChanged);

    _shakeAnimController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 350),
    );
    _shakeAnimation = TweenSequence<double>([
      TweenSequenceItem(tween: Tween(begin: 0.0, end: -10.0), weight: 1),
      TweenSequenceItem(tween: Tween(begin: -10.0, end: 10.0), weight: 2),
      TweenSequenceItem(tween: Tween(begin: 10.0, end: -8.0), weight: 2),
      TweenSequenceItem(tween: Tween(begin: -8.0, end: 8.0), weight: 2),
      TweenSequenceItem(tween: Tween(begin: 8.0, end: 0.0), weight: 1),
    ]).animate(CurvedAnimation(parent: _shakeAnimController, curve: Curves.easeInOut));

    _listSearchController.addListener(() => setState(() {}));

    _loadInitialData();
  }

  @override
  void dispose() {
    _cardAfterController.removeListener(_onCardInputChanged);
    _cardAfterController.dispose();
    _shakeAnimController.dispose();
    _listSearchController.dispose();
    for (var c in _listControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  void _onCardInputChanged() {
    if (_filteredItems.isEmpty || _currentIndex >= _filteredItems.length) return;
    final item = _filteredItems[_currentIndex];
    final currentText = _cardAfterController.text;
    final diff = TextDiffHelper.computeDiff(item.translated, currentText);
    setState(() {
      _currentCardDiff = diff;
    });
  }

  Future<void> _loadInitialData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    final folders = await CharacterFixerService.fetchFolders();
    if (!mounted) return;

    if (folders.isEmpty) {
      setState(() {
        _isLoading = false;
        _errorMessage = 'PC 서버에 연결할 수 없거나 번역 소설 폴더가 없습니다.\n설정에서 PC 서버 주소를 확인해주세요.';
      });
      return;
    }

    String initial = widget.initialFolderName ?? folders.first['folderName'] as String;
    if (!folders.any((f) => f['folderName'] == initial)) {
      initial = folders.first['folderName'] as String;
    }

    setState(() {
      _folders = folders;
      _selectedFolder = initial;
      _isLoading = false;
    });

    await _loadRules(initial);
    await _startScan();
  }

  Future<void> _loadRules(String folder) async {
    final rules = await CharacterFixerService.fetchRules(folder);
    if (mounted) {
      setState(() {
        _rules = rules;
      });
    }
  }

  Future<void> _startScan() async {
    if (_selectedFolder == null) return;
    setState(() {
      _isLoading = true;
      _errorMessage = null;
      _allItems.clear();
      _filteredItems.clear();
      _approvedIds.clear();
      _skippedIds.clear();
      _currentIndex = 0;
      _backupDone = false;
    });

    final scanRes = await CharacterFixerService.scan(_selectedFolder!);
    if (!mounted) return;

    if (scanRes == null) {
      setState(() {
        _isLoading = false;
        _errorMessage = '스캔 실패: PC 서버와 통신 중 오류가 발생했습니다.';
      });
      return;
    }

    final items = scanRes['items'] as List<CharacterFixItem>;
    final tagCounts = scanRes['tag_counts'] as Map<String, int>;

    setState(() {
      _allItems = items;
      _tagCounts = tagCounts;
      _isLoading = false;
      _activeTag = 'all';
    });

    _applyTagFilter('all');
  }

  void _applyTagFilter(String tag) {
    setState(() {
      _activeTag = tag;
      if (tag == 'all') {
        _filteredItems = List.from(_allItems);
      } else {
        _filteredItems = _allItems.where((it) => it.tags.contains(tag)).toList();
      }
      _currentIndex = 0;
      _initListControllers();
      _syncCurrentCardInput();
    });
  }

  void _initListControllers() {
    for (var c in _listControllers.values) {
      c.dispose();
    }
    _listControllers.clear();
    _selectedListIds.clear();
    for (var it in _filteredItems) {
      _listControllers[it.id] = TextEditingController(
        text: it.suggested.isNotEmpty ? it.suggested : it.translated,
      );
    }
  }

  void _syncCurrentCardInput() {
    if (_filteredItems.isNotEmpty && _currentIndex < _filteredItems.length) {
      final it = _filteredItems[_currentIndex];
      final val = it.suggested.isNotEmpty ? it.suggested : it.translated;
      _cardAfterController.text = val;
      _currentCardDiff = TextDiffHelper.computeDiff(it.translated, val);
    } else {
      _cardAfterController.text = '';
      _currentCardDiff = const DiffResult(ops: [], changes: []);
    }
  }

  // --- Tinder Card Actions ---
  Future<void> _approveCard({bool isForced = false}) async {
    if (_filteredItems.isEmpty || _currentIndex >= _filteredItems.length) return;
    final item = _filteredItems[_currentIndex];
    final newTranslated = _cardAfterController.text.trim();

    if (newTranslated.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('번역문이 비어 있습니다.')),
      );
      return;
    }

    final isUnchanged = newTranslated == item.translated.trim();

    // Guard against accidental Enter/Swipe approval on unchanged item
    if (isUnchanged && !isForced) {
      _shakeAnimController.forward(from: 0.0);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('⚠️ 수정된 내용이 없습니다! 번역문을 직접 수정한 후 승인하거나, 건너뛰기를 누르세요.'),
          backgroundColor: Colors.amber,
          duration: Duration(seconds: 3),
        ),
      );
      return;
    }

    if (isUnchanged && isForced) {
      final confirm = await showDialog<bool>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('⚠️ 수정 사항 없음 확인'),
          content: const Text(
            '수정된 내용이 전혀 없는 원본 번역문입니다.\n정말 수정 없이 원문 그대로 승인하시겠습니까?\n(수정이 필요 없는 문장이라면 [취소] 후 건너뛰기를 권장합니다)',
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
            ElevatedButton(
              onPressed: () => Navigator.pop(ctx, true),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.amber),
              child: const Text('원문 그대로 승인'),
            ),
          ],
        ),
      );
      if (confirm != true) return;
    }

    final isFirst = !_backupDone;
    final res = await CharacterFixerService.approveSingle(
      id: item.id,
      translated: newTranslated,
      backup: isFirst,
    );

    if (!mounted) return;

    if (res['success'] == true) {
      if (res['backup_created'] == true) {
        _backupDone = true;
      }
      setState(() {
        _approvedIds.add(item.id);
        _currentIndex++;
        _syncCurrentCardInput();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('✅ 저장 완료 ($_currentIndex/${_filteredItems.length})'),
          duration: const Duration(milliseconds: 900),
          backgroundColor: Colors.green,
        ),
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('저장 실패: ${res['message']}'), backgroundColor: Colors.red),
      );
    }
  }

  void _skipCard() {
    if (_filteredItems.isEmpty || _currentIndex >= _filteredItems.length) return;
    final item = _filteredItems[_currentIndex];
    setState(() {
      _skippedIds.add(item.id);
      _currentIndex++;
      _syncCurrentCardInput();
    });
  }

  void _prevCard() {
    if (_currentIndex > 0) {
      setState(() {
        _currentIndex--;
        _syncCurrentCardInput();
      });
    }
  }

  void _resetSuggestion() {
    if (_filteredItems.isEmpty || _currentIndex >= _filteredItems.length) return;
    final item = _filteredItems[_currentIndex];
    final val = item.suggested.isNotEmpty ? item.suggested : item.translated;
    _cardAfterController.text = val;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('초기 자동 제안문으로 복원되었습니다.'), duration: Duration(milliseconds: 900)),
    );
  }

  // --- Rule Editor Modal Sheet ---
  void _openRulesSheet(ReaderThemeData theme) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: theme.surfaceColor,
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => _RulesEditorSheet(
        theme: theme,
        folderName: _selectedFolder ?? '',
        initialRules: _rules,
        onRulesSaved: (updatedRules) {
          setState(() => _rules = updatedRules);
          _startScan();
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);
    final isDark = theme.isDark;

    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surfaceColor,
        elevation: 0,
        title: Row(
          children: [
            Icon(Icons.spellcheck_rounded, color: theme.accentColor, size: 24),
            const SizedBox(width: 8),
            Text(
              '인명·고유명사 교정기',
              style: TextStyle(color: theme.textColor, fontSize: 17, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: '규칙 설정 & 오독 발굴',
            icon: Icon(Icons.tune_rounded, color: theme.textColor),
            onPressed: () => _openRulesSheet(theme),
          ),
          IconButton(
            tooltip: '다시 스캔',
            icon: Icon(Icons.refresh_rounded, color: theme.textColor),
            onPressed: _startScan,
          ),
        ],
      ),
      body: _buildBody(theme, isDark),
    );
  }

  Widget _buildBody(ReaderThemeData theme, bool isDark) {
    if (_isLoading) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: theme.accentColor),
            const SizedBox(height: 16),
            Text('원문-번역문 정밀 스캔 및 스마트 제안문 생성 중...', style: TextStyle(color: theme.subTextColor, fontSize: 13)),
          ],
        ),
      );
    }

    if (_errorMessage != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.cloud_off_rounded, size: 48, color: theme.subTextColor.withOpacity(0.5)),
              const SizedBox(height: 12),
              Text(_errorMessage!, textAlign: TextAlign.center, style: TextStyle(color: theme.textColor, fontSize: 14)),
              const SizedBox(height: 16),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(backgroundColor: theme.accentColor, foregroundColor: Colors.white),
                onPressed: _loadInitialData,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('다시 시도'),
              ),
            ],
          ),
        ),
      );
    }

    return Column(
      children: [
        // 1. 소설 선택 & 모드 토글 상단 바
        _buildControlHeader(theme),

        // 2. 태그 필터 칩 바
        if (_tagCounts.isNotEmpty) _buildTagChipsBar(theme),

        // 3. 메인 콘텐츠 (틴더 카드 or 일괄 목록)
        Expanded(
          child: _viewMode == 'card' ? _buildTinderCardView(theme, isDark) : _buildBatchListView(theme, isDark),
        ),
      ],
    );
  }

  Widget _buildControlHeader(ReaderThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        border: Border(bottom: BorderSide(color: theme.borderColor)),
      ),
      child: Row(
        children: [
          // 소설 드롭다운
          Expanded(
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _selectedFolder,
                isExpanded: true,
                dropdownColor: theme.surfaceColor,
                items: _folders.map((f) {
                  final name = f['folderName'] as String;
                  final count = f['count'] as int? ?? 0;
                  return DropdownMenuItem<String>(
                    value: name,
                    child: Text(
                      '$name ($count)',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(color: theme.textColor, fontSize: 13, fontWeight: FontWeight.w600),
                    ),
                  );
                }).toList(),
                onChanged: (val) {
                  if (val != null && val != _selectedFolder) {
                    setState(() => _selectedFolder = val);
                    _loadRules(val);
                    _startScan();
                  }
                },
              ),
            ),
          ),
          const SizedBox(width: 8),

          // 모드 토글 (카드 vs 리스트)
          Container(
            decoration: BoxDecoration(
              color: theme.background,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: theme.borderColor),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                _buildModeIconBtn(
                  icon: Icons.style_rounded,
                  mode: 'card',
                  tooltip: '틴더 카드 모드',
                  theme: theme,
                ),
                _buildModeIconBtn(
                  icon: Icons.view_list_rounded,
                  mode: 'list',
                  tooltip: '일괄 목록 모드',
                  theme: theme,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildModeIconBtn({
    required IconData icon,
    required String mode,
    required String tooltip,
    required ReaderThemeData theme,
  }) {
    final active = _viewMode == mode;
    return InkWell(
      onTap: () => setState(() => _viewMode = mode),
      borderRadius: BorderRadius.circular(6),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
        decoration: BoxDecoration(
          color: active ? theme.accentColor.withOpacity(0.18) : Colors.transparent,
          borderRadius: BorderRadius.circular(6),
        ),
        child: Icon(
          icon,
          size: 18,
          color: active ? theme.accentColor : theme.subTextColor,
        ),
      ),
    );
  }

  Widget _buildTagChipsBar(ReaderThemeData theme) {
    return Container(
      height: 42,
      padding: const EdgeInsets.symmetric(vertical: 4),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        border: Border(bottom: BorderSide(color: theme.borderColor)),
      ),
      child: ListView(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 12),
        children: [
          _buildFilterChip('전체 (${_allItems.length})', 'all', theme),
          ..._tagCounts.entries.map((e) {
            return _buildFilterChip('${e.key} (${e.value})', e.key, theme);
          }),
        ],
      ),
    );
  }

  Widget _buildFilterChip(String label, String tag, ReaderThemeData theme) {
    final active = _activeTag == tag;
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: FilterChip(
        label: Text(label, style: TextStyle(fontSize: 11.5, fontWeight: active ? FontWeight.bold : FontWeight.normal)),
        selected: active,
        selectedColor: theme.accentColor.withOpacity(0.2),
        backgroundColor: theme.background,
        checkmarkColor: theme.accentColor,
        labelStyle: TextStyle(color: active ? theme.accentColor : theme.subTextColor),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(16),
          side: BorderSide(color: active ? theme.accentColor : theme.borderColor),
        ),
        onSelected: (_) => _applyTagFilter(tag),
      ),
    );
  }

  // ==========================================
  // 🎴 MODE A: Tinder Card Review View
  // ==========================================
  Widget _buildTinderCardView(ReaderThemeData theme, bool isDark) {
    if (_filteredItems.isEmpty || _currentIndex >= _filteredItems.length) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.celebration_rounded, color: Colors.green, size: 64),
              const SizedBox(height: 16),
              Text(
                '모든 검수가 완료되었습니다!',
                style: TextStyle(color: theme.textColor, fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                '선택한 소설의 검출 대상 문장이 모두 처리되었습니다.',
                style: TextStyle(color: theme.subTextColor, fontSize: 13),
              ),
              const SizedBox(height: 20),
              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(backgroundColor: theme.accentColor, foregroundColor: Colors.white),
                onPressed: _startScan,
                icon: const Icon(Icons.refresh_rounded),
                label: const Text('다시 스캔하기'),
              ),
            ],
          ),
        ),
      );
    }

    final item = _filteredItems[_currentIndex];
    final total = _filteredItems.length;
    final current = _currentIndex + 1;
    final isUnchanged = _cardAfterController.text.trim() == item.translated.trim();

    // Check missing rule for hint
    CharacterRule? missingRule;
    if (_rules.isNotEmpty) {
      missingRule = _rules.cast<CharacterRule?>().firstWhere(
        (r) => r != null && r.enabled && item.original.contains(r.source) && !_cardAfterController.text.contains(r.target),
        orElse: () => null,
      );
    }

    return Column(
      children: [
        // 진행률 바
        LinearProgressIndicator(
          value: current / total,
          backgroundColor: theme.borderColor,
          valueColor: AlwaysStoppedAnimation<Color>(theme.accentColor),
          minHeight: 3,
        ),

        Expanded(
          child: AnimatedBuilder(
            animation: _shakeAnimation,
            builder: (context, child) {
              return Transform.translate(
                offset: Offset(_shakeAnimation.value, 0),
                child: child,
              );
            },
            child: Dismissible(
              key: ValueKey('card-${item.id}'),
              direction: DismissDirection.horizontal,
              confirmDismiss: (dir) async {
                if (dir == DismissDirection.startToEnd) {
                  // Swipe Right -> Approve (with guard!)
                  if (isUnchanged) {
                    _shakeAnimController.forward(from: 0.0);
                    ScaffoldMessenger.of(context).showSnackBar(
                      const SnackBar(
                        content: Text('⚠️ 수정된 내용이 없습니다! 번역문을 직접 수정한 후 승인하거나, 건너뛰기를 누르세요.'),
                        backgroundColor: Colors.amber,
                        duration: Duration(seconds: 2),
                      ),
                    );
                    return false;
                  }
                  await _approveCard(isForced: false);
                  return false; // Handled internally
                } else {
                  // Swipe Left -> Skip
                  _skipCard();
                  return false;
                }
              },
              background: Container(
                alignment: Alignment.centerLeft,
                padding: const EdgeInsets.only(left: 28),
                color: Colors.green.withOpacity(0.2),
                child: const Row(
                  children: [
                    Icon(Icons.check_circle_rounded, color: Colors.green, size: 36),
                    SizedBox(width: 8),
                    Text('승인', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
              ),
              secondaryBackground: Container(
                alignment: Alignment.centerRight,
                padding: const EdgeInsets.only(right: 28),
                color: Colors.red.withOpacity(0.2),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: [
                    Text('건너뛰기', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 16)),
                    SizedBox(width: 8),
                    Icon(Icons.skip_next_rounded, color: Colors.red, size: 36),
                  ],
                ),
              ),
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: Container(
                  decoration: BoxDecoration(
                    color: theme.surfaceColor,
                    borderRadius: BorderRadius.circular(16),
                    border: Border.all(
                      color: isUnchanged ? Colors.amber : theme.borderColor,
                      width: isUnchanged ? 1.5 : 1.0,
                    ),
                    boxShadow: [
                      BoxShadow(
                        color: Colors.black.withOpacity(isDark ? 0.3 : 0.05),
                        blurRadius: 10,
                        offset: const Offset(0, 4),
                      ),
                    ],
                  ),
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      // 카드 헤더 (카운터, 회차, 사유)
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                            decoration: BoxDecoration(
                              color: theme.accentColor.withOpacity(0.15),
                              borderRadius: BorderRadius.circular(12),
                            ),
                            child: Text(
                              '$current / $total',
                              style: TextStyle(color: theme.accentColor, fontSize: 12, fontWeight: FontWeight.bold),
                            ),
                          ),
                          Expanded(
                            child: Padding(
                              padding: const EdgeInsets.symmetric(horizontal: 8),
                              child: Text(
                                item.title,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(color: theme.textColor, fontWeight: FontWeight.w600, fontSize: 13),
                              ),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),

                      // 사유 배지들
                      Wrap(
                        spacing: 4,
                        runSpacing: 4,
                        children: item.reasons.map((r) {
                          return Container(
                            padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                            decoration: BoxDecoration(
                              color: Colors.red.withOpacity(0.12),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: Colors.red.withOpacity(0.3)),
                            ),
                            child: Text(r, style: const TextStyle(color: Colors.redAccent, fontSize: 11, fontWeight: FontWeight.w600)),
                          );
                        }).toList(),
                      ),
                      const SizedBox(height: 14),

                      // 1. 일본어 원문 (JP)
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('🇯🇵 일본어 원문', style: TextStyle(color: theme.subTextColor, fontSize: 12, fontWeight: FontWeight.bold)),
                          IconButton(
                            icon: const Icon(Icons.copy_rounded, size: 16),
                            tooltip: '원문 복사',
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(),
                            onPressed: () {
                              Clipboard.setData(ClipboardData(text: item.original));
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(content: Text('원문이 클립보드에 복사되었습니다.'), duration: Duration(milliseconds: 700)),
                              );
                            },
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: isDark ? const Color(0xFF1E293B) : const Color(0xFFF1F5F9),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          item.original,
                          style: TextStyle(color: theme.textColor, fontSize: 13.5, height: 1.6),
                        ),
                      ),
                      const SizedBox(height: 14),

                      // 2. 수정 전 번역 (Before - 취소선 강조)
                      const Text('❌ 수정 전 번역 (Before)', style: TextStyle(color: Colors.redAccent, fontSize: 12, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Container(
                        width: double.infinity,
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: isDark ? const Color(0x20EF4444) : const Color(0xFFFFF1F2),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: Colors.red.withOpacity(0.2)),
                        ),
                        child: Text.rich(
                          TextSpan(
                            children: TextDiffHelper.buildBeforeSpans(
                              ops: _currentCardDiff.ops,
                              defaultTextColor: theme.textColor,
                              isDarkMode: isDark,
                            ),
                          ),
                        ),
                      ),
                      const SizedBox(height: 14),

                      // 3. 교정 번역 & 실시간 Diff 미리보기
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Row(
                            children: [
                              Text('✅ 스마트 교정 (After)', style: TextStyle(color: theme.accentColor, fontSize: 12, fontWeight: FontWeight.bold)),
                              const SizedBox(width: 8),
                              if (_currentCardDiff.hasChanges)
                                ..._currentCardDiff.changes.map((c) {
                                  return Container(
                                    padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
                                    margin: const EdgeInsets.only(right: 4),
                                    decoration: BoxDecoration(
                                      color: theme.background,
                                      borderRadius: BorderRadius.circular(10),
                                      border: Border.all(color: theme.borderColor),
                                    ),
                                    child: Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: [
                                        Text(c.from, style: const TextStyle(color: Colors.redAccent, fontSize: 11, decoration: TextDecoration.lineThrough)),
                                        const Text(' → ', style: TextStyle(fontSize: 10, color: Colors.grey)),
                                        Text(c.to, style: const TextStyle(color: Colors.green, fontSize: 11, fontWeight: FontWeight.bold)),
                                      ],
                                    ),
                                  );
                                }),
                            ],
                          ),
                          TextButton(
                            onPressed: _resetSuggestion,
                            style: TextButton.styleFrom(padding: EdgeInsets.zero, minimumSize: Size.zero),
                            child: const Text('초기화', style: TextStyle(fontSize: 11)),
                          ),
                        ],
                      ),
                      const SizedBox(height: 4),

                      // 실시간 Diff 박스 (or 변경 없음 경고 박스)
                      if (isUnchanged)
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(12),
                          margin: const EdgeInsets.only(bottom: 8),
                          decoration: BoxDecoration(
                            color: isDark ? const Color(0x30F59E0B) : const Color(0xFFFFFBEB),
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: Colors.amber, width: 1.5),
                          ),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Row(
                                children: [
                                  Icon(Icons.warning_amber_rounded, color: Colors.amber, size: 18),
                                  SizedBox(width: 6),
                                  Text(
                                    '⚠️ 자동 교정 불가 — 수동 수정 필요',
                                    style: TextStyle(color: Colors.amber, fontWeight: FontWeight.bold, fontSize: 13),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '등록된 오역 규칙과 일치하는 단어가 없어 수정 전과 동일합니다. 아래 입력창에서 직접 수정한 후 승인하세요.',
                                style: TextStyle(color: theme.textColor, fontSize: 12, height: 1.4),
                              ),
                              if (missingRule != null) ...[
                                const SizedBox(height: 6),
                                Row(
                                  children: [
                                    Text('원문: ${missingRule.source} → 표기: ${missingRule.target}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                                    const SizedBox(width: 8),
                                    InkWell(
                                      onTap: () {
                                        Clipboard.setData(ClipboardData(text: missingRule!.target));
                                        ScaffoldMessenger.of(context).showSnackBar(
                                          SnackBar(content: Text("'${missingRule.target}' 클립보드 복사됨")),
                                        );
                                      },
                                      child: Container(
                                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                        decoration: BoxDecoration(color: theme.background, borderRadius: BorderRadius.circular(4)),
                                        child: Text("📋 '${missingRule.target}' 복사", style: const TextStyle(fontSize: 11)),
                                      ),
                                    ),
                                  ],
                                ),
                              ],
                            ],
                          ),
                        )
                      else
                        Container(
                          width: double.infinity,
                          padding: const EdgeInsets.all(12),
                          margin: const EdgeInsets.only(bottom: 8),
                          decoration: BoxDecoration(
                            color: theme.background,
                            borderRadius: BorderRadius.circular(8),
                            border: Border.all(color: theme.borderColor),
                          ),
                          child: Text.rich(
                            TextSpan(
                              children: TextDiffHelper.buildDiffSpans(
                                ops: _currentCardDiff.ops,
                                defaultTextColor: theme.textColor,
                                isDarkMode: isDark,
                              ),
                            ),
                          ),
                        ),

                      // 직접 편집 입력창
                      TextField(
                        controller: _cardAfterController,
                        maxLines: null,
                        style: TextStyle(color: theme.textColor, fontSize: 14, height: 1.6),
                        decoration: InputDecoration(
                          filled: true,
                          fillColor: theme.surfaceColor,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: BorderSide(color: isUnchanged ? Colors.amber : Colors.green, width: 2),
                          ),
                          enabledBorder: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(8),
                            borderSide: BorderSide(color: isUnchanged ? Colors.amber : Colors.green, width: 2),
                          ),
                          hintText: '교정할 번역문을 입력하세요...',
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ),

        // 하단 버튼 바 (이전 / 건너뛰기 / 승인)
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: theme.surfaceColor,
            border: Border(top: BorderSide(color: theme.borderColor)),
          ),
          child: Row(
            children: [
              OutlinedButton.icon(
                onPressed: _currentIndex > 0 ? _prevCard : null,
                icon: const Icon(Icons.arrow_back_rounded, size: 16),
                label: const Text('이전'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: theme.textColor,
                  side: BorderSide(color: theme.borderColor),
                ),
              ),
              const SizedBox(width: 8),
              OutlinedButton.icon(
                onPressed: _skipCard,
                icon: const Icon(Icons.skip_next_rounded, size: 16),
                label: const Text('건너뛰기'),
                style: OutlinedButton.styleFrom(
                  foregroundColor: theme.subTextColor,
                  side: BorderSide(color: theme.borderColor),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () => _approveCard(isForced: isUnchanged),
                  icon: Icon(isUnchanged ? Icons.warning_rounded : Icons.check_circle_rounded, size: 18),
                  label: Text(isUnchanged ? '수동 수정 필요' : '승인 및 다음'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: isUnchanged ? Colors.amber : Colors.green,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // ==========================================
  // 📋 MODE B: Batch List View
  // ==========================================
  Widget _buildBatchListView(ReaderThemeData theme, bool isDark) {
    final query = _listSearchController.text.trim().toLowerCase();
    final items = _filteredItems.where((it) {
      if (query.isEmpty) return true;
      return it.title.toLowerCase().contains(query) ||
          it.original.toLowerCase().contains(query) ||
          it.translated.toLowerCase().contains(query);
    }).toList();

    return Column(
      children: [
        // 검색 & 전체 선택 바
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          color: theme.surfaceColor,
          child: Row(
            children: [
              Checkbox(
                value: items.isNotEmpty && _selectedListIds.length == items.length,
                activeColor: theme.accentColor,
                onChanged: (v) {
                  setState(() {
                    if (v == true) {
                      _selectedListIds.addAll(items.map((e) => e.id));
                    } else {
                      _selectedListIds.clear();
                    }
                  });
                },
              ),
              Text('전체 (${items.length})', style: TextStyle(color: theme.textColor, fontSize: 13, fontWeight: FontWeight.bold)),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _listSearchController,
                  style: TextStyle(color: theme.textColor, fontSize: 13),
                  decoration: InputDecoration(
                    hintText: '원문, 수정전 검색...',
                    hintStyle: TextStyle(color: theme.subTextColor, fontSize: 12),
                    isDense: true,
                    contentPadding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                ),
              ),
            ],
          ),
        ),

        // 리스트
        Expanded(
          child: items.isEmpty
              ? Center(child: Text('표시할 항목이 없습니다.', style: TextStyle(color: theme.subTextColor)))
              : ListView.separated(
                  padding: const EdgeInsets.all(12),
                  itemCount: items.length,
                  separatorBuilder: (_, __) => const SizedBox(height: 10),
                  itemBuilder: (_, index) {
                    final it = items[index];
                    final controller = _listControllers[it.id]!;
                    final isChecked = _selectedListIds.contains(it.id);
                    final isApproved = _approvedIds.contains(it.id);
                    final diff = TextDiffHelper.computeDiff(it.translated, controller.text);

                    return Container(
                      decoration: BoxDecoration(
                        color: isApproved ? Colors.green.withOpacity(0.08) : theme.surfaceColor,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: isApproved ? Colors.green : theme.borderColor),
                      ),
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Checkbox(
                                value: isChecked,
                                activeColor: theme.accentColor,
                                onChanged: (v) {
                                  setState(() {
                                    if (v == true) {
                                      _selectedListIds.add(it.id);
                                    } else {
                                      _selectedListIds.remove(it.id);
                                    }
                                  });
                                },
                              ),
                              Expanded(
                                child: Text(it.title, style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 12.5)),
                              ),
                              ElevatedButton(
                                style: ElevatedButton.styleFrom(
                                  backgroundColor: theme.accentColor,
                                  foregroundColor: Colors.white,
                                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                                  minimumSize: Size.zero,
                                ),
                                onPressed: () async {
                                  final res = await CharacterFixerService.approveSingle(
                                    id: it.id,
                                    translated: controller.text.trim(),
                                    backup: !_backupDone,
                                  );
                                  if (res['success'] == true) {
                                    _backupDone = true;
                                    if (!mounted) return;
                                    setState(() => _approvedIds.add(it.id));
                                    ScaffoldMessenger.of(context).showSnackBar(
                                      const SnackBar(content: Text('저장 완료'), duration: Duration(milliseconds: 700)),
                                    );
                                  }
                                },
                                child: const Text('저장', style: TextStyle(fontSize: 11)),
                              ),
                            ],
                          ),
                          const SizedBox(height: 6),
                          Text(it.original, style: TextStyle(color: theme.subTextColor, fontSize: 12)),
                          const SizedBox(height: 6),
                          Container(
                            width: double.infinity,
                            padding: const EdgeInsets.all(8),
                            decoration: BoxDecoration(color: theme.background, borderRadius: BorderRadius.circular(6)),
                            child: Text.rich(
                              TextSpan(
                                children: TextDiffHelper.buildDiffSpans(
                                  ops: diff.ops,
                                  defaultTextColor: theme.textColor,
                                  isDarkMode: isDark,
                                ),
                              ),
                            ),
                          ),
                          const SizedBox(height: 6),
                          TextField(
                            controller: controller,
                            maxLines: null,
                            style: TextStyle(color: theme.textColor, fontSize: 13),
                            onChanged: (_) => setState(() {}),
                            decoration: InputDecoration(
                              isDense: true,
                              contentPadding: const EdgeInsets.all(8),
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(6)),
                            ),
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),

        // 하단 일괄 승인 바
        if (_selectedListIds.isNotEmpty)
          Container(
            padding: const EdgeInsets.all(12),
            color: theme.surfaceColor,
            child: SizedBox(
              width: double.infinity,
              height: 44,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white),
                onPressed: () async {
                  final itemsToSave = _selectedListIds.map((id) {
                    final it = _allItems.firstWhere((e) => e.id == id);
                    return {
                      'id': id,
                      'translated': _listControllers[id]?.text.trim() ?? it.translated,
                    };
                  }).toList();

                  final unchangedCount = itemsToSave.where((it) {
                    final orig = _allItems.firstWhere((e) => e.id == it['id']);
                    return it['translated'] == orig.translated.trim();
                  }).length;

                  String confirmMsg = '선택한 ${itemsToSave.length}건을 일괄 승인하시겠습니까?';
                  if (unchangedCount > 0) {
                    confirmMsg = '⚠️ 경고: 선택한 항목 중 수정 사항이 전혀 없는 문장이 $unchangedCount건 포함되어 있습니다!\n정말 계속 일괄 저장하시겠습니까?';
                  }

                  final ok = await showDialog<bool>(
                    context: context,
                    builder: (ctx) => AlertDialog(
                      title: const Text('일괄 승인 확인'),
                      content: Text(confirmMsg),
                      actions: [
                        TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
                        ElevatedButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('일괄 승인')),
                      ],
                    ),
                  );
                  if (ok != true) return;

                  final res = await CharacterFixerService.approveBatch(items: itemsToSave, backup: true);
                  if (!mounted) return;
                  if (res['success'] == true) {
                    _backupDone = true;
                    setState(() {
                      _approvedIds.addAll(_selectedListIds);
                      _selectedListIds.clear();
                    });
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text('✅ ${res['count']}건 일괄 승인 완료!'), backgroundColor: Colors.green),
                    );
                  }
                },
                icon: const Icon(Icons.done_all_rounded),
                label: Text('선택 ${_selectedListIds.length}건 일괄 승인 및 DB 반영', style: const TextStyle(fontWeight: FontWeight.bold)),
              ),
            ),
          ),
      ],
    );
  }
}

// ==========================================
// ⚙️ 규칙 편집 & 오독 단어 통계 자동 발굴 Sheet
// ==========================================
class _RulesEditorSheet extends StatefulWidget {
  final ReaderThemeData theme;
  final String folderName;
  final List<CharacterRule> initialRules;
  final Function(List<CharacterRule>) onRulesSaved;

  const _RulesEditorSheet({
    required this.theme,
    required this.folderName,
    required this.initialRules,
    required this.onRulesSaved,
  });

  @override
  State<_RulesEditorSheet> createState() => _RulesEditorSheetState();
}

class _RulesEditorSheetState extends State<_RulesEditorSheet> {
  late List<CharacterRule> _rules;
  bool _isSaving = false;
  final Map<int, List<MisreadingCandidate>> _discoveredCandidates = {};
  final Set<int> _isDiscoveringIndex = {};

  @override
  void initState() {
    super.initState();
    _rules = widget.initialRules.map((r) => CharacterRule.fromJson(r.toJson())).toList();
  }

  Future<void> _discover(int index, CharacterRule rule) async {
    if (rule.source.isEmpty || rule.target.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('원문 한자(Source)와 올바른 표기(Target)를 먼저 입력하세요.')),
      );
      return;
    }

    setState(() => _isDiscoveringIndex.add(index));

    final candidates = await CharacterFixerService.discoverMisreadings(
      folderName: widget.folderName,
      source: rule.source,
      target: rule.target,
    );

    if (mounted) {
      setState(() {
        _isDiscoveringIndex.remove(index);
        _discoveredCandidates[index] = candidates;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(candidates.isEmpty ? '발굴된 오독 후보가 없습니다.' : '${candidates.length}개의 오역 단어 후보를 자동 발굴했습니다!'),
          duration: const Duration(seconds: 2),
        ),
      );
    }
  }

  Future<void> _save() async {
    setState(() => _isSaving = true);
    final validRules = _rules.where((r) => r.source.isNotEmpty && r.target.isNotEmpty).toList();
    final ok = await CharacterFixerService.saveRules(widget.folderName, validRules);
    setState(() => _isSaving = false);

    if (mounted) {
      if (ok) {
        widget.onRulesSaved(validRules);
        Navigator.pop(context);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('규칙이 성공적으로 저장되었습니다.'), backgroundColor: Colors.green),
        );
      } else {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('규칙 저장 실패'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = widget.theme;

    return DraggableScrollableSheet(
      initialChildSize: 0.85,
      maxChildSize: 0.95,
      minChildSize: 0.5,
      expand: false,
      builder: (ctx, scrollController) {
        return Column(
          children: [
            // Sheet Handle & Header
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 14),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      Icon(Icons.tune_rounded, color: theme.accentColor, size: 22),
                      const SizedBox(width: 8),
                      Text('교정 규칙 & 오독 단어 발굴', style: TextStyle(color: theme.textColor, fontSize: 16, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  ElevatedButton(
                    onPressed: _isSaving ? null : _save,
                    style: ElevatedButton.styleFrom(backgroundColor: theme.accentColor, foregroundColor: Colors.white),
                    child: _isSaving
                        ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                        : const Text('저장'),
                  ),
                ],
              ),
            ),
            const Divider(height: 1),

            Expanded(
              child: ListView.builder(
                controller: scrollController,
                padding: const EdgeInsets.all(16),
                itemCount: _rules.length + 1,
                itemBuilder: (context, index) {
                  if (index == _rules.length) {
                    return Padding(
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      child: OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: theme.accentColor,
                          side: BorderSide(color: theme.accentColor),
                          padding: const EdgeInsets.symmetric(vertical: 12),
                        ),
                        onPressed: () {
                          setState(() {
                            _rules.add(CharacterRule(
                              id: 'rule-${DateTime.now().millisecondsSinceEpoch}',
                              source: '',
                              target: '',
                              misreadings: [],
                            ));
                          });
                        },
                        icon: const Icon(Icons.add_rounded),
                        label: const Text('새 인명 교정 규칙 추가'),
                      ),
                    );
                  }

                  final rule = _rules[index];
                  final isDiscovering = _isDiscoveringIndex.contains(index);
                  final candidates = _discoveredCandidates[index] ?? [];

                  return Card(
                    color: theme.background,
                    elevation: 0,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: BorderSide(color: theme.borderColor),
                    ),
                    margin: const EdgeInsets.only(bottom: 14),
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Switch(
                                value: rule.enabled,
                                activeColor: theme.accentColor,
                                onChanged: (v) => setState(() => rule.enabled = v),
                              ),
                              Text(rule.enabled ? '활성화' : '비활성', style: TextStyle(color: theme.textColor, fontSize: 12)),
                              const Spacer(),
                              IconButton(
                                icon: const Icon(Icons.delete_outline_rounded, color: Colors.redAccent, size: 20),
                                onPressed: () => setState(() => _rules.removeAt(index)),
                              ),
                            ],
                          ),
                          Row(
                            children: [
                              Expanded(
                                child: TextField(
                                  controller: TextEditingController(text: rule.source)..selection = TextSelection.collapsed(offset: rule.source.length),
                                  style: TextStyle(color: theme.textColor, fontSize: 13),
                                  decoration: InputDecoration(
                                    labelText: '원문 한자 (Source)',
                                    labelStyle: TextStyle(color: theme.subTextColor, fontSize: 12),
                                    isDense: true,
                                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                                  ),
                                  onChanged: (v) => rule.source = v.trim(),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Icon(Icons.arrow_forward_rounded, color: theme.subTextColor, size: 16),
                              const SizedBox(width: 8),
                              Expanded(
                                child: TextField(
                                  controller: TextEditingController(text: rule.target)..selection = TextSelection.collapsed(offset: rule.target.length),
                                  style: TextStyle(color: theme.textColor, fontSize: 13),
                                  decoration: InputDecoration(
                                    labelText: '올바른 표기 (Target)',
                                    labelStyle: TextStyle(color: theme.subTextColor, fontSize: 12),
                                    isDense: true,
                                    border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                                  ),
                                  onChanged: (v) => rule.target = v.trim(),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),

                          // 오독 단어 목록
                          TextField(
                            controller: TextEditingController(text: rule.misreadings.join(', '))..selection = TextSelection.collapsed(offset: rule.misreadings.join(', ').length),
                            style: TextStyle(color: theme.textColor, fontSize: 13),
                            decoration: InputDecoration(
                              labelText: '오독 단어 목록 (쉼표 구분)',
                              labelStyle: TextStyle(color: theme.subTextColor, fontSize: 12),
                              hintText: '예: 하루토, 유토, 유리',
                              hintStyle: TextStyle(color: theme.subTextColor.withOpacity(0.5), fontSize: 11),
                              isDense: true,
                              border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
                            ),
                            onChanged: (v) {
                              rule.misreadings = v.split(',').map((s) => s.trim()).filterEmpty().toList();
                            },
                          ),
                          const SizedBox(height: 10),

                          // 🔍 통계 기반 오독 단어 자동 발굴 버튼
                          SizedBox(
                            width: double.infinity,
                            child: OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                foregroundColor: theme.accentColor,
                                side: BorderSide(color: theme.accentColor),
                                padding: const EdgeInsets.symmetric(vertical: 8),
                              ),
                              onPressed: isDiscovering ? null : () => _discover(index, rule),
                              icon: isDiscovering
                                  ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                                  : const Icon(Icons.analytics_outlined, size: 16),
                              label: Text(isDiscovering ? '오독 단어 통계 분석 중...' : '🔍 오독 단어 통계 자동 발굴 (PC)'),
                            ),
                          ),

                          // 발굴된 단어 칩 목록
                          if (candidates.isNotEmpty) ...[
                            const SizedBox(height: 8),
                            Text('🎯 발굴된 오역 후보 (${candidates.length}건):', style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.bold)),
                            const SizedBox(height: 4),
                            Wrap(
                              spacing: 6,
                              runSpacing: 4,
                              children: candidates.map((cand) {
                                final alreadyIn = rule.misreadings.contains(cand.word);
                                return ActionChip(
                                  label: Text('+ ${cand.word} (${cand.count}회)'),
                                  labelStyle: TextStyle(fontSize: 11, color: alreadyIn ? Colors.grey : theme.accentColor),
                                  backgroundColor: alreadyIn ? theme.borderColor.withOpacity(0.5) : theme.accentColor.withOpacity(0.12),
                                  onPressed: alreadyIn
                                      ? null
                                      : () {
                                          setState(() {
                                            rule.misreadings.add(cand.word);
                                          });
                                          ScaffoldMessenger.of(context).showSnackBar(
                                            SnackBar(content: Text("'${cand.word}' 추가되었습니다."), duration: const Duration(milliseconds: 700)),
                                          );
                                        },
                                );
                              }).toList(),
                            ),
                          ],
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ],
        );
      },
    );
  }
}

extension _IterableStringExt on Iterable<String> {
  Iterable<String> filterEmpty() => where((s) => s.isNotEmpty);
}
