import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../models/special_batch_models.dart';
import '../../services/preferences_service.dart';
import '../../services/special_batch_service.dart';
import '../themes/reader_themes.dart';
import '../themes/hyper_aesthetic_theme.dart';

class SpecialBatchScreen extends StatefulWidget {
  const SpecialBatchScreen({super.key});

  @override
  State<SpecialBatchScreen> createState() => _SpecialBatchScreenState();
}

class _SpecialBatchScreenState extends State<SpecialBatchScreen> {
  bool _isLoading = true;
  String? _errorMessage;

  List<SpecialBatchNovel> _novels = [];
  SpecialBatchNovel? _selectedNovel;

  List<SpecialBatchChapter> _chapters = [];
  SpecialBatchChapter? _selectedChapter;

  String _statusFilter = 'staged'; // 'staged', 'approved', 'skipped', 'all'
  List<SpecialBatchItem> _items = [];
  int _totalCount = 0;
  int _stagedCount = 0;

  bool _isActionProcessing = false;

  @override
  void initState() {
    super.initState();
    _loadInitialData();
  }

  Future<void> _loadInitialData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final novels = await SpecialBatchService.fetchNovels();
      if (!mounted) return;

      _novels = novels;
      if (novels.isNotEmpty) {
        // 기본적으로 대기(staged) 건수가 있는 첫 번째 소설 선택
        _selectedNovel = novels.firstWhere(
          (n) => n.stagedCount > 0,
          orElse: () => novels.first,
        );
        await _loadChaptersForSelectedNovel();
      } else {
        setState(() => _isLoading = false);
      }
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = '데이터 로딩 실패: $e';
        _isLoading = false;
      });
    }
  }

  Future<void> _loadChaptersForSelectedNovel() async {
    if (_selectedNovel == null) return;
    try {
      final chapters = await SpecialBatchService.fetchChapters(_selectedNovel!.folderName);
      if (!mounted) return;

      _chapters = chapters;
      _selectedChapter = null; // 전체 회차 기본
      await _loadItems();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = '회차 목록 로딩 실패: $e';
        _isLoading = false;
      });
    }
  }

  Future<void> _loadItems() async {
    setState(() => _isLoading = true);
    try {
      final res = await SpecialBatchService.fetchItems(
        folderName: _selectedNovel?.folderName,
        chapterUrl: _selectedChapter?.url,
        status: _statusFilter,
        limit: 150,
      );

      if (!mounted) return;
      setState(() {
        _items = res['items'] as List<SpecialBatchItem>;
        _totalCount = res['total'] as int;
        _stagedCount = res['staged'] as int;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = '문단 로딩 실패: $e';
        _isLoading = false;
      });
    }
  }

  /// 단일 항목 승인
  Future<void> _approveItem(SpecialBatchItem item) async {
    HapticFeedback.lightImpact();
    setState(() => _isActionProcessing = true);
    final success = await SpecialBatchService.approveItem(item.id, translatedText: item.translatedText);
    if (!mounted) return;
    setState(() => _isActionProcessing = false);

    if (success) {
      setState(() {
        item.status = 'approved';
        if (_statusFilter == 'staged') {
          _items.removeWhere((i) => i.id == item.id);
          _stagedCount = (_stagedCount - 1).clamp(0, 999999);
        }
      });
      _showToast('승인되어 본 DB에 즉시 반영되었습니다.');
    } else {
      _showToast('승인 실패', isError: true);
    }
  }

  /// 단일 항목 건너뛰기
  Future<void> _skipItem(SpecialBatchItem item) async {
    HapticFeedback.lightImpact();
    setState(() => _isActionProcessing = true);
    final success = await SpecialBatchService.skipItem(item.id);
    if (!mounted) return;
    setState(() => _isActionProcessing = false);

    if (success) {
      setState(() {
        item.status = 'skipped';
        if (_statusFilter == 'staged') {
          _items.removeWhere((i) => i.id == item.id);
          _stagedCount = (_stagedCount - 1).clamp(0, 999999);
        }
      });
      _showToast('건너뛰기 완료');
    } else {
      _showToast('건너뛰기 실패', isError: true);
    }
  }

  /// 되돌리기 (Undo)
  Future<void> _undoItem(SpecialBatchItem item) async {
    HapticFeedback.lightImpact();
    setState(() => _isActionProcessing = true);
    final success = await SpecialBatchService.undoItem(item.id);
    if (!mounted) return;
    setState(() => _isActionProcessing = false);

    if (success) {
      await _loadItems();
      _showToast('되돌리기 완료');
    } else {
      _showToast('되돌리기 실패', isError: true);
    }
  }

  /// 번역문 퀵 수정 모달
  Future<void> _editItemText(SpecialBatchItem item) async {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);
    final controller = TextEditingController(text: item.translatedText);

    final res = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.surfaceColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Text('번역문 수정', style: TextStyle(color: theme.textColor, fontSize: 16, fontWeight: FontWeight.bold)),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(item.originalText, style: TextStyle(color: theme.subTextColor, fontSize: 12.5)),
            const SizedBox(height: 12),
            TextField(
              controller: controller,
              maxLines: 4,
              style: TextStyle(color: theme.textColor, fontSize: 14),
              decoration: InputDecoration(
                filled: true,
                fillColor: theme.background,
                border: OutlineInputBorder(borderRadius: BorderRadius.circular(10), borderSide: BorderSide(color: theme.borderColor)),
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('취소', style: TextStyle(color: theme.subTextColor)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: theme.accentColor, foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(ctx, controller.text),
            child: const Text('저장'),
          ),
        ],
      ),
    );

    if (res != null && res.trim() != item.translatedText.trim()) {
      final success = await SpecialBatchService.updateText(item.id, res.trim());
      if (success && mounted) {
        setState(() => item.translatedText = res.trim());
        _showToast('수정되었습니다.');
      }
    }
  }

  /// 일괄 승인 실행
  Future<void> _executeBatchApprove() async {
    final confirm = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: const Text('일괄 승인 확인'),
        content: Text(
          '현재 선택된 범위(${_selectedNovel?.displayName ?? '전체'})의 대기 중인 모든 문단을 한 번에 승인하시겠습니까?\n본 DB로 영구 승격됩니다.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF10B981), foregroundColor: Colors.white),
            onPressed: () => Navigator.pop(ctx, true),
            child: const Text('일괄 승인 실행'),
          ),
        ],
      ),
    );

    if (confirm != true) return;

    setState(() => _isActionProcessing = true);
    final res = await SpecialBatchService.batchApprove(
      folderName: _selectedNovel?.folderName,
      chapterUrl: _selectedChapter?.url,
    );
    if (!mounted) return;
    setState(() => _isActionProcessing = false);

    if (res['success'] == true) {
      _showToast('총 ${res['count']}개 문단이 일괄 승인되었습니다.');
      await _loadInitialData();
    } else {
      _showToast('일괄 승인 실패', isError: true);
    }
  }

  void _showToast(String msg, {bool isError = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: isError ? Colors.redAccent : const Color(0xFF10B981),
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
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
        backgroundColor: theme.surfaceColor,
        elevation: 0,
        title: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(6),
              decoration: BoxDecoration(
                color: Colors.purpleAccent.withOpacity(0.18),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.bolt_rounded, color: Colors.purpleAccent, size: 20),
            ),
            const SizedBox(width: 10),
            Text(
              '특별 적재 검수기',
              style: TextStyle(color: theme.textColor, fontSize: 18, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: '새로고침',
            onPressed: _loadInitialData,
          ),
          const SizedBox(width: 8),
        ],
      ),
      body: _isLoading
          ? Center(child: CircularProgressIndicator(color: primary))
          : _errorMessage != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Icon(Icons.error_outline_rounded, color: Colors.redAccent, size: 48),
                        const SizedBox(height: 12),
                        Text(_errorMessage!, textAlign: TextAlign.center, style: TextStyle(color: theme.textColor)),
                        const SizedBox(height: 16),
                        ElevatedButton(onPressed: _loadInitialData, child: const Text('다시 시도')),
                      ],
                    ),
                  ),
                )
              : Column(
                  children: [
                    // 소설 및 상태 필터 툴바
                    _buildFilterSection(theme),
                    const Divider(height: 1),

                    // 본문 문단 카드 리스트
                    Expanded(
                      child: _items.isEmpty
                          ? Center(
                              child: Column(
                                mainAxisAlignment: MainAxisAlignment.center,
                                children: [
                                  Icon(Icons.check_circle_outline_rounded, size: 48, color: theme.subTextColor.withOpacity(0.4)),
                                  const SizedBox(height: 12),
                                  Text('검수할 문단이 없습니다.', style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold)),
                                  const SizedBox(height: 4),
                                  Text('현재 필터 조건에 해당하는 항목이 모두 완료되었습니다.', style: TextStyle(color: theme.subTextColor, fontSize: 12)),
                                ],
                              ),
                            )
                          : ListView.separated(
                              padding: const EdgeInsets.fromLTRB(16, 14, 16, 90),
                              itemCount: _items.length,
                              separatorBuilder: (_, __) => const SizedBox(height: 12),
                              itemBuilder: (context, idx) {
                                final item = _items[idx];
                                return _buildItemCard(item, theme);
                              },
                            ),
                    ),
                  ],
                ),
      floatingActionButton: (_stagedCount > 0 && !_isLoading)
          ? FloatingActionButton.extended(
              backgroundColor: const Color(0xFF10B981),
              foregroundColor: Colors.white,
              onPressed: _isActionProcessing ? null : _executeBatchApprove,
              icon: const Icon(Icons.done_all_rounded),
              label: Text('일괄 승인 ($_stagedCount건)'),
            )
          : null,
    );
  }

  Widget _buildFilterSection(ReaderThemeData theme) {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      color: theme.surfaceColor,
      child: Column(
        children: [
          // 1. 소설 선택 바
          Row(
            children: [
              Icon(Icons.book_outlined, size: 18, color: theme.accentColor),
              const SizedBox(width: 8),
              Expanded(
                child: DropdownButtonHideUnderline(
                  child: DropdownButton<SpecialBatchNovel>(
                    value: _selectedNovel,
                    isExpanded: true,
                    dropdownColor: theme.surfaceColor,
                    hint: Text('소설 선택', style: TextStyle(color: theme.subTextColor)),
                    items: _novels.map((n) {
                      return DropdownMenuItem(
                        value: n,
                        child: Text(
                          '${n.displayName} (${n.stagedCount}건 대기)',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: theme.textColor,
                            fontWeight: n.stagedCount > 0 ? FontWeight.bold : FontWeight.normal,
                            fontSize: 13.5,
                          ),
                        ),
                      );
                    }).toList(),
                    onChanged: (val) {
                      if (val != null && val != _selectedNovel) {
                        setState(() => _selectedNovel = val);
                        _loadChaptersForSelectedNovel();
                      }
                    },
                  ),
                ),
              ),
            ],
          ),
          // 2. 회차 선택 바
          if (_chapters.isNotEmpty) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                Icon(Icons.article_outlined, size: 18, color: theme.subTextColor),
                const SizedBox(width: 8),
                Expanded(
                  child: DropdownButtonHideUnderline(
                    child: DropdownButton<SpecialBatchChapter?>(
                      value: _selectedChapter,
                      isExpanded: true,
                      dropdownColor: theme.surfaceColor,
                      hint: Text('전체 회차 (${_chapters.length}화)', style: TextStyle(color: theme.subTextColor, fontSize: 13)),
                      items: [
                        DropdownMenuItem<SpecialBatchChapter?>(
                          value: null,
                          child: Text('전체 회차 (${_chapters.length}화)', style: TextStyle(color: theme.textColor, fontSize: 13)),
                        ),
                        ..._chapters.map((c) => DropdownMenuItem<SpecialBatchChapter?>(
                              value: c,
                              child: Text(
                                '${c.chapterTitle.isNotEmpty ? c.chapterTitle : c.url} (${c.stagedCount}건 대기)',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: TextStyle(color: theme.textColor, fontSize: 13),
                              ),
                            )),
                      ],
                      onChanged: (val) {
                        setState(() => _selectedChapter = val);
                        _loadItems();
                      },
                    ),
                  ),
                ),
              ],
            ),
          ],
          const SizedBox(height: 8),

          // 3. 상태 필터 세그먼트 (대기 / 승인완료 / 건너뜀 / 전체)
          Row(
            children: [
              _buildStatusChip('staged', '대기 ($_stagedCount)', theme, color: Colors.purpleAccent),
              const SizedBox(width: 8),
              _buildStatusChip('approved', '승인 완료', theme, color: const Color(0xFF10B981)),
              const SizedBox(width: 8),
              _buildStatusChip('skipped', '건너뜀', theme, color: Colors.orangeAccent),
              const SizedBox(width: 8),
              _buildStatusChip('all', '전체 ($_totalCount)', theme),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildStatusChip(String status, String label, ReaderThemeData theme, {Color? color}) {
    final isSelected = (_statusFilter == status);
    final c = color ?? theme.accentColor;
    return ChoiceChip(
      label: Text(label),
      selected: isSelected,
      selectedColor: c.withOpacity(0.2),
      backgroundColor: theme.background,
      labelStyle: TextStyle(
        color: isSelected ? c : theme.subTextColor,
        fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
        fontSize: 11.5,
      ),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(8),
        side: BorderSide(color: isSelected ? c : theme.borderColor),
      ),
      onSelected: (val) {
        if (val) {
          setState(() => _statusFilter = status);
          _loadItems();
        }
      },
    );
  }

  Widget _buildItemCard(SpecialBatchItem item, ReaderThemeData theme) {
    final isStaged = item.status == 'staged';
    final isApproved = item.status == 'approved';

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(
          color: isApproved
              ? const Color(0xFF10B981).withOpacity(0.5)
              : isStaged
                  ? Colors.purpleAccent.withOpacity(0.4)
                  : theme.borderColor,
        ),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.02), blurRadius: 4, offset: const Offset(0, 2)),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // 상단 메타 헤더
          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                decoration: BoxDecoration(
                  color: isApproved
                      ? const Color(0xFF10B981).withOpacity(0.15)
                      : isStaged
                          ? Colors.purpleAccent.withOpacity(0.15)
                          : Colors.orangeAccent.withOpacity(0.15),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  isApproved ? '승인됨' : isStaged ? '대기 중' : '건너뜀',
                  style: TextStyle(
                    color: isApproved ? const Color(0xFF10B981) : isStaged ? Colors.purpleAccent : Colors.orangeAccent,
                    fontSize: 10.5,
                    fontWeight: FontWeight.bold,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  item.chapterTitle.isNotEmpty ? item.chapterTitle : item.url,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: theme.subTextColor, fontSize: 11.5),
                ),
              ),
              Text(item.pid, style: TextStyle(color: theme.subTextColor.withOpacity(0.5), fontSize: 10.5, fontFamily: 'monospace')),
            ],
          ),
          const SizedBox(height: 10),

          // 일본어 원문
          Text(item.originalText, style: TextStyle(color: theme.subTextColor, fontSize: 12.5)),
          const SizedBox(height: 8),
          Divider(height: 1, color: theme.borderColor.withOpacity(0.5)),
          const SizedBox(height: 8),

          // 번역문 (터치 시 수정)
          InkWell(
            onTap: () => _editItemText(item),
            borderRadius: BorderRadius.circular(8),
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: theme.background.withOpacity(0.5),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Text(
                      item.translatedText,
                      style: TextStyle(color: theme.textColor, fontSize: 13.5, height: 1.4),
                    ),
                  ),
                  Icon(Icons.edit_outlined, size: 14, color: theme.subTextColor.withOpacity(0.6)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 10),

          // 하단 액션 버튼 바
          Row(
            mainAxisAlignment: MainAxisAlignment.end,
            children: [
              if (isStaged) ...[
                TextButton.icon(
                  onPressed: _isActionProcessing ? null : () => _skipItem(item),
                  icon: const Icon(Icons.close_rounded, size: 14, color: Colors.orangeAccent),
                  label: const Text('건너뛰기', style: TextStyle(color: Colors.orangeAccent, fontSize: 11.5)),
                ),
                const SizedBox(width: 8),
                ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF10B981),
                    foregroundColor: Colors.white,
                    visualDensity: VisualDensity.compact,
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  onPressed: _isActionProcessing ? null : () => _approveItem(item),
                  icon: const Icon(Icons.check_rounded, size: 14),
                  label: const Text('승인', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12)),
                ),
              ] else ...[
                TextButton.icon(
                  onPressed: _isActionProcessing ? null : () => _undoItem(item),
                  icon: const Icon(Icons.undo_rounded, size: 14),
                  label: const Text('되돌리기', style: TextStyle(fontSize: 11.5)),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}
