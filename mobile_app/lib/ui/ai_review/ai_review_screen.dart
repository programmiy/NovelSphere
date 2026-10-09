import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../models/ai_review_models.dart';
import '../../services/ai_review_service.dart';
import '../themes/reader_themes.dart';
import 'ai_reretranslate_screen.dart';

class AiReviewScreen extends StatefulWidget {
  const AiReviewScreen({super.key});

  @override
  State<AiReviewScreen> createState() => _AiReviewScreenState();
}

class _AiReviewScreenState extends State<AiReviewScreen> with SingleTickerProviderStateMixin {
  bool _isLoading = true;
  String? _errorMessage;
  List<AiReviewItem> _queue = [];
  int _currentIndex = 0;
  AiReviewStats? _stats;

  // Track last action for Undo
  int? _lastQueueId;
  String? _lastActionType; // 'approve' or 'reject'

  // Text controller for the active card
  late TextEditingController _transController;

  // Reroll loading state
  bool _isRerolling = false;

  @override
  void initState() {
    super.initState();
    _transController = TextEditingController();
    _loadData();
  }

  @override
  void dispose() {
    _transController.dispose();
    super.dispose();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final items = await AiReviewService.fetchQueue();
      final stats = await AiReviewService.fetchStats();
      if (!mounted) return;

      setState(() {
        _queue = items;
        _stats = stats;
        _currentIndex = 0;
        _isLoading = false;
        if (_queue.isNotEmpty) {
          _transController.text = cleanAiTranslation(_queue[0].aiTranslatedText);
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = '데이터를 불러오는 중 오류가 발생했습니다: $e';
        _isLoading = false;
      });
    }
  }

  AiReviewItem? get _currentItem {
    if (_queue.isEmpty || _currentIndex >= _queue.length) return null;
    return _queue[_currentIndex];
  }

  void _onCardSwiped(DismissDirection direction) async {
    final item = _currentItem;
    if (item == null) return;

    final isApprove = direction == DismissDirection.startToEnd;
    final editedText = _transController.text.trim();

    // Optimistically advance
    final qId = item.queueId;
    setState(() {
      _lastQueueId = qId;
      _lastActionType = isApprove ? 'approve' : 'reject';
      _currentIndex++;
      if (_currentIndex < _queue.length) {
        _transController.text = cleanAiTranslation(_queue[_currentIndex].aiTranslatedText);
      }
    });

    // Execute API in background
    bool success;
    if (isApprove) {
      success = await AiReviewService.approve(qId, editedText);
    } else {
      success = await AiReviewService.reject(qId);
    }

    if (!success && mounted) {
      _showToast(isApprove ? '승인 처리에 실패했습니다.' : '거절 처리에 실패했습니다.', isError: true);
    } else {
      _fetchStatsOnly();
    }
  }

  Future<void> _triggerUndo() async {
    if (_lastQueueId == null) return;
    final qId = _lastQueueId!;

    setState(() {
      _lastQueueId = null;
      _lastActionType = null;
      if (_currentIndex > 0) {
        _currentIndex--;
        if (_currentIndex < _queue.length) {
          _transController.text = cleanAiTranslation(_queue[_currentIndex].aiTranslatedText);
        }
      }
    });

    final ok = await AiReviewService.undo(qId);
    if (!ok && mounted) {
      _showToast('되돌리기 실패', isError: true);
    } else {
      _showToast('이전 작업을 되돌렸습니다.');
      _fetchStatsOnly();
    }
  }

  Future<void> _triggerReroll() async {
    final item = _currentItem;
    if (item == null || _isRerolling) return;

    setState(() => _isRerolling = true);
    final newText = await AiReviewService.reroll(item.queueId);
    if (!mounted) return;
    setState(() => _isRerolling = false);

    if (newText != null && newText.isNotEmpty) {
      final cleaned = cleanAiTranslation(newText);
      _transController.text = cleaned;
      item.aiTranslatedText = cleaned;
      _showToast('Gemini 3.8 Flash로 재번역되었습니다!');
    } else {
      _showToast('재번역 실패', isError: true);
    }
  }

  Future<void> _fetchStatsOnly() async {
    final s = await AiReviewService.fetchStats();
    if (mounted && s != null) {
      setState(() => _stats = s);
    }
  }

  void _showToast(String msg, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: isError ? Colors.redAccent : Colors.teal,
        behavior: SnackBarBehavior.floating,
        duration: const Duration(milliseconds: 2000),
      ),
    );
  }

  void _openContextSheet(AiReviewItem item) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (ctx) => _ContextSheet(
        item: item,
        onQuickEditSaved: (transId, newText) {
          _showToast('문맥 번역이 저장되었습니다.');
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = ReaderThemes.currentTheme;
    final isDark = theme.isDark;
    final bgColor = isDark ? const Color(0xFF0F172A) : const Color(0xFFF1F5F9);
    final cardBg = isDark ? const Color(0xFF1E293B) : Colors.white;

    return Scaffold(
      backgroundColor: bgColor,
      appBar: AppBar(
        backgroundColor: cardBg,
        elevation: 0,
        title: Row(
          children: [
            const Icon(Icons.auto_awesome_rounded, color: Colors.amber, size: 20),
            const SizedBox(width: 8),
            Text(
              'AI 번역 검수',
              style: TextStyle(
                color: isDark ? Colors.white : Colors.black87,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
        actions: [
          // 2차 재재번역 센터 버튼
          IconButton(
            icon: Stack(
              clipBehavior: Clip.none,
              children: [
                const Icon(Icons.tune_rounded, color: Colors.amber),
                if ((_stats?.rejectedCount ?? 0) > 0)
                  Positioned(
                    right: -4,
                    top: -4,
                    child: Container(
                      padding: const EdgeInsets.all(4),
                      decoration: const BoxDecoration(
                        color: Colors.redAccent,
                        shape: BoxShape.circle,
                      ),
                      child: Text(
                        '${_stats!.rejectedCount}',
                        style: const TextStyle(color: Colors.white, fontSize: 9, fontWeight: FontWeight.bold),
                      ),
                    ),
                  ),
              ],
            ),
            tooltip: '2차 재재번역 센터',
            onPressed: () {
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const AiReretranslateScreen()),
              ).then((_) => _loadData());
            },
          ),
          IconButton(
            icon: const Icon(Icons.refresh_rounded),
            tooltip: '새로고침',
            onPressed: _loadData,
          ),
        ],
      ),
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : _errorMessage != null
              ? _buildErrorView()
              : _currentItem == null
                  ? _buildEmptyView()
                  : Column(
                      children: [
                        _buildTopStatsBar(),
                        Expanded(child: _buildSwipeCardArea(cardBg, isDark)),
                        _buildBottomSlideControls(),
                      ],
                    ),
    );
  }

  Widget _buildTopStatsBar() {
    final remaining = _queue.length - _currentIndex;
    final rejected = _stats?.rejectedCount ?? 0;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 10),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.04),
        border: Border(bottom: BorderSide(color: Colors.black.withOpacity(0.06))),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              _buildStatChip('남은 검수', '$remaining건', Colors.blueAccent),
              const SizedBox(width: 10),
              _buildStatChip('재재번역 대기', '$rejected건', Colors.orangeAccent),
            ],
          ),
          if (_currentItem != null)
            TextButton.icon(
              onPressed: () => _openContextSheet(_currentItem!),
              icon: const Icon(Icons.menu_book_rounded, size: 16),
              label: const Text('전후 맥락', style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
              style: TextButton.styleFrom(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                minimumSize: Size.zero,
                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildStatChip(String label, String value, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withOpacity(0.12),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.w600)),
          const SizedBox(width: 6),
          Text(value, style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildSwipeCardArea(Color cardBg, bool isDark) {
    final item = _currentItem!;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
      child: Dismissible(
        key: ValueKey('queue_card_${item.queueId}'),
        direction: DismissDirection.horizontal,
        onDismissed: _onCardSwiped,
        background: _buildSwipeBackground(
          color: Colors.teal.shade600,
          alignment: Alignment.centerLeft,
          icon: Icons.check_circle_rounded,
          label: '승인 (APPROVE)',
        ),
        secondaryBackground: _buildSwipeBackground(
          color: Colors.redAccent.shade400,
          alignment: Alignment.centerRight,
          icon: Icons.cancel_rounded,
          label: '거절 (REJECT)',
        ),
        child: Container(
          decoration: BoxDecoration(
            color: cardBg,
            borderRadius: BorderRadius.circular(20),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(isDark ? 0.35 : 0.08),
                blurRadius: 18,
                offset: const Offset(0, 8),
              ),
            ],
            border: Border.all(color: Colors.white.withOpacity(isDark ? 0.08 : 0.6)),
          ),
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Header Chips
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 4,
                      children: [
                        if (item.folderName != null && item.folderName!.isNotEmpty)
                          _buildChip(item.folderName!, Colors.grey),
                        if (item.isReretranslated)
                          _buildChip('⚡ 2차 재재번역 우선검수', Colors.amber),
                        _buildChip(item.modelUsed, Colors.blueGrey),
                      ],
                    ),
                  ),
                  // Reroll Button
                  TextButton.icon(
                    onPressed: _isRerolling ? null : _triggerReroll,
                    icon: _isRerolling
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.auto_fix_high_rounded, size: 16, color: Colors.amber),
                    label: const Text('REROLL', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.amber)),
                    style: TextButton.styleFrom(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      minimumSize: Size.zero,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 14),

              // Original Japanese Box (Tap to copy)
              InkWell(
                onTap: () {
                  Clipboard.setData(ClipboardData(text: item.originalText));
                  _showToast('일본어 원문이 복사되었습니다.');
                },
                borderRadius: BorderRadius.circular(12),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(isDark ? 0.35 : 0.05),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.white.withOpacity(0.08)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(
                            'ORIGINAL (일본어 원문)',
                            style: TextStyle(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: Colors.blueAccent.shade100,
                              letterSpacing: 0.5,
                            ),
                          ),
                          Icon(Icons.content_copy_rounded, size: 14, color: Colors.grey.shade500),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(
                        item.originalText,
                        style: TextStyle(
                          fontSize: 15,
                          height: 1.5,
                          color: isDark ? Colors.grey.shade300 : Colors.grey.shade800,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 14),

              // Translation Editor Header
              Row(
                children: [
                  Icon(Icons.translate_rounded, size: 14, color: Colors.teal.shade300),
                  const SizedBox(width: 6),
                  Text(
                    'AI 번역문 (편집 가능)',
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: isDark ? Colors.grey.shade300 : Colors.grey.shade700,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 6),

              // Editable Translation Box
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: Colors.black.withOpacity(isDark ? 0.2 : 0.03),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: Colors.teal.withOpacity(0.3)),
                  ),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  child: TextField(
                    controller: _transController,
                    maxLines: null,
                    expands: true,
                    style: TextStyle(
                      fontSize: 17,
                      height: 1.6,
                      fontWeight: FontWeight.w600,
                      color: isDark ? Colors.white : Colors.black87,
                    ),
                    decoration: const InputDecoration(
                      border: InputBorder.none,
                      hintText: '번역문을 수정하거나 입력하세요...',
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildSwipeBackground({
    required Color color,
    required Alignment alignment,
    required IconData icon,
    required String label,
  }) {
    return Container(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(20),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 28),
      alignment: alignment,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, color: Colors.white, size: 28),
          const SizedBox(width: 8),
          Text(
            label,
            style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }

  Widget _buildBottomSlideControls() {
    return Container(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Slide to Undo Bar (When lastAction is available)
          if (_lastQueueId != null) ...[
            _SlideToUndoBar(
              actionType: _lastActionType ?? '작업',
              onUndo: _triggerUndo,
            ),
            const SizedBox(height: 10),
          ],

          // Quick Action Slide Buttons
          Row(
            children: [
              // Reject Button (Slide Left action)
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: () => _onCardSwiped(DismissDirection.endToStart),
                  icon: const Icon(Icons.arrow_back_rounded, size: 16),
                  label: const Text('거절 (재재번역)'),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Colors.redAccent,
                    side: BorderSide(color: Colors.redAccent.withOpacity(0.5)),
                    padding: const EdgeInsets.symmetric(vertical: 13),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ),
              const SizedBox(width: 12),
              // Approve Button (Slide Right action)
              Expanded(
                child: ElevatedButton.icon(
                  onPressed: () => _onCardSwiped(DismissDirection.startToEnd),
                  icon: const Text('승인 완료'),
                  label: const Icon(Icons.arrow_forward_rounded, size: 16),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.teal.shade600,
                    foregroundColor: Colors.white,
                    elevation: 2,
                    padding: const EdgeInsets.symmetric(vertical: 13),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildChip(String text, Color color) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: color.withOpacity(0.15),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withOpacity(0.3)),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 10, color: color, fontWeight: FontWeight.bold),
      ),
    );
  }

  Widget _buildEmptyView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.task_alt_rounded, size: 64, color: Colors.teal),
            const SizedBox(height: 16),
            const Text(
              '모든 검수가 완료되었습니다!',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 8),
            Text(
              '대기 중인 검수 항목이 없습니다.',
              style: TextStyle(color: Colors.grey.shade500, fontSize: 14),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _loadData,
              icon: const Icon(Icons.refresh_rounded),
              label: const Text('다시 확인하기'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildErrorView() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline_rounded, size: 56, color: Colors.redAccent),
            const SizedBox(height: 14),
            Text(_errorMessage!, textAlign: TextAlign.center, style: const TextStyle(fontSize: 14)),
            const SizedBox(height: 20),
            ElevatedButton(onPressed: _loadData, child: const Text('다시 시도')),
          ],
        ),
      ),
    );
  }
}

/// Slide-to-Undo interactive bar widget
class _SlideToUndoBar extends StatefulWidget {
  final String actionType;
  final VoidCallback onUndo;

  const _SlideToUndoBar({
    required this.actionType,
    required this.onUndo,
  });

  @override
  State<_SlideToUndoBar> createState() => _SlideToUndoBarState();
}

class _SlideToUndoBarState extends State<_SlideToUndoBar> {
  double _dragPosition = 0.0;
  static const double _buttonSize = 44.0;

  @override
  Widget build(BuildContext context) {
    final label = widget.actionType == 'approve' ? '승인' : '거절';

    return LayoutBuilder(
      builder: (context, constraints) {
        final maxDrag = constraints.maxWidth - _buttonSize - 8;

        return Container(
          height: 48,
          decoration: BoxDecoration(
            color: Colors.amber.withOpacity(0.15),
            borderRadius: BorderRadius.circular(24),
            border: Border.all(color: Colors.amber.withOpacity(0.4)),
          ),
          child: Stack(
            alignment: Alignment.centerLeft,
            children: [
              // Center Label
              Center(
                child: Text(
                  '⏪ 오른쪽으로 슬라이드하여 $label 되돌리기 (Undo)',
                  style: const TextStyle(
                    fontSize: 12,
                    fontWeight: FontWeight.bold,
                    color: Colors.amber,
                  ),
                ),
              ),

              // Draggable Slider Knob
              Positioned(
                left: _dragPosition + 4,
                child: GestureDetector(
                  onHorizontalDragUpdate: (details) {
                    setState(() {
                      _dragPosition = (_dragPosition + details.delta.dx).clamp(0.0, maxDrag);
                    });
                  },
                  onHorizontalDragEnd: (details) {
                    if (_dragPosition >= maxDrag * 0.75) {
                      widget.onUndo();
                    } else {
                      setState(() => _dragPosition = 0.0);
                    }
                  },
                  child: Container(
                    width: _buttonSize,
                    height: 40,
                    decoration: BoxDecoration(
                      color: Colors.amber,
                      borderRadius: BorderRadius.circular(20),
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.2),
                          blurRadius: 4,
                        ),
                      ],
                    ),
                    child: const Icon(Icons.undo_rounded, color: Colors.black87, size: 20),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Context Drawer BottomSheet
class _ContextSheet extends StatefulWidget {
  final AiReviewItem item;
  final Function(int, String) onQuickEditSaved;

  const _ContextSheet({
    required this.item,
    required this.onQuickEditSaved,
  });

  @override
  State<_ContextSheet> createState() => _ContextSheetState();
}

class _ContextSheetState extends State<_ContextSheet> {
  int? _editingTransId;
  final TextEditingController _editController = TextEditingController();
  bool _isSaving = false;

  @override
  void dispose() {
    _editController.dispose();
    super.dispose();
  }

  Future<void> _saveQuickEdit(int transId) async {
    final text = _editController.text.trim();
    if (text.isEmpty) return;

    setState(() => _isSaving = true);
    final ok = await AiReviewService.quickEditContext(transId, text);
    if (!mounted) return;
    setState(() => _isSaving = false);

    if (ok) {
      widget.onQuickEditSaved(transId, text);
      setState(() => _editingTransId = null);
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('문맥 번역 저장 실패')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return Container(
      height: MediaQuery.of(context).size.height * 0.72,
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF1E293B) : Colors.white,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
      ),
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Drag handle
          Center(
            child: Container(
              width: 36,
              height: 4,
              decoration: BoxDecoration(
                color: Colors.grey.withOpacity(0.4),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: 12),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              const Text(
                '전후 문맥 상세 (Context)',
                style: TextStyle(fontSize: 17, fontWeight: FontWeight.bold),
              ),
              IconButton(
                icon: const Icon(Icons.close_rounded),
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
          const Divider(),
          Expanded(
            child: ListView(
              children: [
                if (widget.item.contextBefore.isNotEmpty) ...[
                  _buildSectionHeader('이전 문맥 (BEFORE)'),
                  ...widget.item.contextBefore.map((c) => _buildContextItemCard(c)),
                  const SizedBox(height: 16),
                ],
                _buildSectionHeader('현재 검수 문장 (TARGET)'),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.teal.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: Colors.teal.withOpacity(0.4)),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.item.originalText, style: const TextStyle(fontSize: 13, color: Colors.grey)),
                      const SizedBox(height: 6),
                      Text(widget.item.aiTranslatedText, style: const TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                if (widget.item.contextAfter.isNotEmpty) ...[
                  _buildSectionHeader('이후 문맥 (AFTER)'),
                  ...widget.item.contextAfter.map((c) => _buildContextItemCard(c)),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSectionHeader(String title) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text(
        title,
        style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: Colors.blueAccent.shade100),
      ),
    );
  }

  Widget _buildContextItemCard(ContextSentence c) {
    final isEditing = _editingTransId == c.id;

    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.black.withOpacity(0.04),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                c.pid != null ? 'P#${c.pid}' : (c.id != null ? 'ID #${c.id}' : 'CONTEXT'),
                style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold, color: Colors.grey),
              ),
              Row(
                children: [
                  if (c.url != null)
                    IconButton(
                      icon: const Icon(Icons.open_in_new_rounded, size: 16),
                      tooltip: '웹소설 원본 링크 복사',
                      onPressed: () {
                        Clipboard.setData(ClipboardData(text: c.url!));
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('웹소설 링크가 복사되었습니다.')),
                        );
                      },
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  if (c.id != null) ...[
                    const SizedBox(width: 8),
                    IconButton(
                      icon: Icon(isEditing ? Icons.close_rounded : Icons.edit_rounded, size: 16),
                      tooltip: '즉시 수정',
                      onPressed: () {
                        setState(() {
                          if (isEditing) {
                            _editingTransId = null;
                          } else {
                            _editingTransId = c.id;
                            _editController.text = c.translated;
                          }
                        });
                      },
                      padding: EdgeInsets.zero,
                      constraints: const BoxConstraints(),
                    ),
                  ],
                ],
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(c.original, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          const SizedBox(height: 4),
          if (isEditing) ...[
            TextField(
              controller: _editController,
              maxLines: null,
              decoration: const InputDecoration(
                isDense: true,
                border: OutlineInputBorder(),
                hintText: '수정할 번역문 입력...',
              ),
            ),
            const SizedBox(height: 6),
            Align(
              alignment: Alignment.centerRight,
              child: ElevatedButton(
                onPressed: _isSaving ? null : () => _saveQuickEdit(c.id!),
                child: _isSaving
                    ? const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('저장'),
              ),
            ),
          ] else
            Text(c.translated, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600)),
        ],
      ),
    );
  }
}
