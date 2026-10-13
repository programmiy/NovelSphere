import 'package:flutter/material.dart';
import '../../models/ai_review_models.dart';
import '../../services/ai_review_service.dart';
import '../themes/reader_themes.dart';

class AiReretranslateScreen extends StatefulWidget {
  const AiReretranslateScreen({super.key});

  @override
  State<AiReretranslateScreen> createState() => _AiReretranslateScreenState();
}

class _AiReretranslateScreenState extends State<AiReretranslateScreen> {
  bool _isLoading = true;
  String? _errorMessage;
  Map<String, List<ReretranslateBatchItem>> _modelsData = {};
  final Set<String> _expandedModels = {};
  final Set<String> _runningModels = {};

  static const Map<String, Map<String, dynamic>> _modelMeta = {
    'gemini-3.5-flash': {'color': Colors.blue, 'desc': '초단문 (하위 25%)', 'icon': Icons.bolt_rounded},
    'gemini-3.6-flash': {'color': Colors.purple, 'desc': '단문 일반 서술 (25~50%)', 'icon': Icons.auto_stories_rounded},
    'gemini-3.7-flash': {'color': Colors.pinkAccent, 'desc': '중문 복합 문장 (50~75%)', 'icon': Icons.psychology_rounded},
    'gemini-3.8-flash': {'color': Colors.amber, 'desc': '장문/고난도 묘사 (상위 25%)', 'icon': Icons.diamond_rounded},
  };

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final data = await AiReviewService.fetchReretranslateQueue();
      if (!mounted) return;
      setState(() {
        _modelsData = data;
        _isLoading = false;
        // Default expand first non-empty model
        for (var entry in data.entries) {
          if (entry.value.isNotEmpty) {
            _expandedModels.add(entry.key);
            break;
          }
        }
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _errorMessage = '재재번역 데이터를 불러오는 중 오류가 발생했습니다: $e';
        _isLoading = false;
      });
    }
  }

  int get _totalItems {
    int sum = 0;
    for (var list in _modelsData.values) {
      sum += list.length;
    }
    return sum;
  }

  Future<void> _runSingleModel(String model) async {
    final items = _modelsData[model] ?? [];
    if (items.isEmpty || _runningModels.contains(model)) return;

    setState(() => _runningModels.add(model));
    final ids = items.map((i) => i.queueId).toList();
    final ok = await AiReviewService.runReretranslate(ids, model);

    if (!mounted) return;
    setState(() => _runningModels.remove(model));

    if (ok) {
      _showToast('$model 모델로 재재번역 작업이 시작되었습니다!');
      _loadData();
    } else {
      _showToast('실행 요청 실패', isError: true);
    }
  }

  Future<void> _runAllModels() async {
    if (_totalItems == 0) {
      _showToast('재재번역할 문장이 없습니다.');
      return;
    }

    setState(() {
      for (var k in _modelsData.keys) {
        if ((_modelsData[k] ?? []).isNotEmpty) {
          _runningModels.add(k);
        }
      }
    });

    int launched = 0;
    for (var entry in _modelsData.entries) {
      if (entry.value.isNotEmpty) {
        final ids = entry.value.map((i) => i.queueId).toList();
        await AiReviewService.runReretranslate(ids, entry.key);
        launched += entry.value.length;
      }
    }

    if (!mounted) return;
    setState(() => _runningModels.clear());
    _showToast('총 $launched건의 문장이 4개 모델(3.5~3.8)로 분산 재재번역 시작되었습니다!');
    _loadData();
  }

  Future<void> _deleteItem(int queueId) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('문장 제외'),
        content: const Text('이 문장을 재재번역 큐에서 제외하시겠습니까?'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('취소')),
          TextButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('제외', style: TextStyle(color: Colors.redAccent))),
        ],
      ),
    );

    if (confirmed == true) {
      final ok = await AiReviewService.deleteReretranslateItem(queueId);
      if (ok) {
        _showToast('큐에서 제외되었습니다.');
        _loadData();
      } else {
        _showToast('제외 실패', isError: true);
      }
    }
  }

  void _showToast(String msg, {bool isError = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        backgroundColor: isError ? Colors.redAccent : Colors.teal,
        behavior: SnackBarBehavior.floating,
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
            const Icon(Icons.tune_rounded, color: Colors.amber, size: 20),
            const SizedBox(width: 8),
            Text(
              '2차 정밀 재재번역 센터',
              style: TextStyle(
                color: isDark ? Colors.white : Colors.black87,
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
          ],
        ),
        actions: [
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
              ? Center(child: Text(_errorMessage!))
              : Column(
                  children: [
                    _buildTopHeroPanel(cardBg, isDark),
                    Expanded(
                      child: _totalItems == 0
                          ? _buildEmptyView()
                          : ListView(
                              padding: const EdgeInsets.all(16),
                              children: _modelMeta.keys.map((modelKey) {
                                return _buildModelAccordionCard(modelKey, cardBg, isDark);
                              }).toList(),
                            ),
                    ),
                  ],
                ),
    );
  }

  Widget _buildTopHeroPanel(Color cardBg, bool isDark) {
    return Container(
      margin: const EdgeInsets.fromLTRB(16, 12, 16, 4),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(isDark ? 0.08 : 0.6)),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '총 대기 문장: $_totalItems건',
                    style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    '길이 백분위 통계 기반 4개 모델(3.5~3.8) 분산 라우팅',
                    style: TextStyle(fontSize: 11, color: Colors.grey.shade500),
                  ),
                ],
              ),
              ElevatedButton.icon(
                onPressed: _totalItems == 0 ? null : _runAllModels,
                icon: const Icon(Icons.bolt_rounded, size: 16),
                label: const Text('전체 일괄 실행'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.amber.shade700,
                  foregroundColor: Colors.white,
                  elevation: 2,
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildModelAccordionCard(String modelName, Color cardBg, bool isDark) {
    final items = _modelsData[modelName] ?? [];
    final meta = _modelMeta[modelName]!;
    final color = meta['color'] as Color;
    final isExpanded = _expandedModels.contains(modelName);
    final isRunning = _runningModels.contains(modelName);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: cardBg,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: color.withOpacity(isExpanded ? 0.4 : 0.15)),
      ),
      child: Column(
        children: [
          // Header Row
          InkWell(
            onTap: () {
              setState(() {
                if (isExpanded) {
                  _expandedModels.remove(modelName);
                } else {
                  _expandedModels.add(modelName);
                }
              });
            },
            borderRadius: BorderRadius.circular(16),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                children: [
                  Container(
                    padding: const EdgeInsets.all(8),
                    decoration: BoxDecoration(
                      color: color.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(meta['icon'] as IconData, color: color, size: 18),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              modelName,
                              style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: color),
                            ),
                            const SizedBox(width: 8),
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                              decoration: BoxDecoration(
                                color: color.withOpacity(0.1),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Text(
                                '${items.length}건',
                                style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: color),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 2),
                        Text(
                          meta['desc'] as String,
                          style: TextStyle(fontSize: 11, color: Colors.grey.shade500),
                        ),
                      ],
                    ),
                  ),
                  // Run single model button
                  TextButton.icon(
                    onPressed: (items.isEmpty || isRunning) ? null : () => _runSingleModel(modelName),
                    icon: isRunning
                        ? const SizedBox(width: 12, height: 12, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.play_arrow_rounded, size: 16),
                    label: const Text('실행', style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold)),
                    style: TextButton.styleFrom(
                      foregroundColor: color,
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    ),
                  ),
                  Icon(
                    isExpanded ? Icons.expand_less_rounded : Icons.expand_more_rounded,
                    color: Colors.grey,
                  ),
                ],
              ),
            ),
          ),

          // Drawer items
          if (isExpanded)
            Container(
              decoration: BoxDecoration(
                border: Border(top: BorderSide(color: Colors.black.withOpacity(0.06))),
              ),
              child: items.isEmpty
                  ? const Padding(
                      padding: EdgeInsets.all(16),
                      child: Text('할당된 문장이 없습니다.', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    )
                  : ListView.separated(
                      shrinkWrap: true,
                      physics: const NeverScrollableScrollPhysics(),
                      itemCount: items.length,
                      separatorBuilder: (_, __) => Divider(height: 1, color: Colors.white.withOpacity(0.04)),
                      itemBuilder: (ctx, idx) {
                        final item = items[idx];
                        return Padding(
                          padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                          child: Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: Colors.grey.withOpacity(0.15),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Text('L:${item.length}', style: const TextStyle(fontSize: 10, fontWeight: FontWeight.bold)),
                              ),
                              const SizedBox(width: 10),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      item.originalText,
                                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
                                    ),
                                    if (item.oldTranslatedText != null && item.oldTranslatedText!.isNotEmpty) ...[
                                      const SizedBox(height: 4),
                                      Text(
                                        item.oldTranslatedText!,
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: Colors.redAccent.withOpacity(0.7),
                                          decoration: TextDecoration.lineThrough,
                                        ),
                                      ),
                                    ],
                                  ],
                                ),
                              ),
                              IconButton(
                                icon: const Icon(Icons.delete_outline_rounded, size: 16, color: Colors.redAccent),
                                tooltip: '제외',
                                onPressed: () => _deleteItem(item.queueId),
                                padding: EdgeInsets.zero,
                                constraints: const BoxConstraints(),
                              ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
        ],
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
            const Icon(Icons.check_circle_outline_rounded, size: 56, color: Colors.amber),
            const SizedBox(height: 14),
            const Text(
              '재재번역 대기 중인 문장이 없습니다.',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
            const SizedBox(height: 6),
            Text(
              '1차 AI 검수 화면에서 거절(Swipe Left)한 문장들이 이곳으로 들어옵니다.',
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12, color: Colors.grey.shade500),
            ),
          ],
        ),
      ),
    );
  }
}
