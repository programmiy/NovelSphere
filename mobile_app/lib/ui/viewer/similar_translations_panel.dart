import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../../services/local_db_service.dart';
import '../../services/preferences_service.dart';
import '../themes/reader_themes.dart';

/// LANOVEL Mobile - 유사 번역 용례 탐색기 (Similar Translations Explorer)
/// 화면 하단에 반투명하게 붙어있어 위아래로 가볍게 접고 펼치며,
/// 꼬리를 무는 연쇄 탐색(Chained Context Exploration)을 지원하는 미니 패널
class SimilarTranslationsPanel extends StatefulWidget {
  final String initialKeyword;
  final String? bookName;
  final ReaderThemeData theme;
  final String koreanFont;
  final String japaneseFont;
  final VoidCallback onClose;

  const SimilarTranslationsPanel({
    super.key,
    required this.initialKeyword,
    this.bookName,
    required this.theme,
    required this.koreanFont,
    required this.japaneseFont,
    required this.onClose,
  });

  @override
  State<SimilarTranslationsPanel> createState() => _SimilarTranslationsPanelState();
}

class _SimilarTranslationsPanelState extends State<SimilarTranslationsPanel> {
  late String _currentKeyword;
  final List<String> _history = [];
  List<Map<String, dynamic>> _examples = [];
  bool _isLoading = false;
  bool _isCollapsed = false;

  @override
  void initState() {
    super.initState();
    _currentKeyword = widget.initialKeyword.trim();
    _fetchSimilarExamples(_currentKeyword);
  }

  @override
  void didUpdateWidget(covariant SimilarTranslationsPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.initialKeyword.trim() != oldWidget.initialKeyword.trim() &&
        widget.initialKeyword.trim().isNotEmpty) {
      _navigateToKeyword(widget.initialKeyword.trim());
    }
  }

  void _navigateToKeyword(String newKeyword) {
    final trimmed = newKeyword.trim();
    if (trimmed.isEmpty || trimmed == _currentKeyword) return;
    _history.add(_currentKeyword);
    setState(() {
      _currentKeyword = trimmed;
      if (_isCollapsed) _isCollapsed = false;
    });
    _fetchSimilarExamples(trimmed);
  }

  void _goBackHistory() {
    if (_history.isEmpty) return;
    final prevKeyword = _history.removeLast();
    setState(() {
      _currentKeyword = prevKeyword;
    });
    _fetchSimilarExamples(prevKeyword);
  }

  Future<void> _fetchSimilarExamples(String keyword) async {
    if (keyword.isEmpty) return;
    setState(() {
      _isLoading = true;
    });

    try {
      // 1. 로컬 Sqflite DB에서 즉시 0ms 검색
      final localResults = await LocalDbService.searchSimilarTranslations(
        keyword: keyword,
        currentBookName: widget.bookName,
        limit: 12,
      );

      if (mounted) {
        setState(() {
          _examples = localResults;
        });
      }

      // 2. PC 서버와 통신 가능하면 서버 전체 DB에서도 보완 조회
      final rawServerUrl = PreferencesService.serverUrl;
      final serverUrl = PreferencesService.normalizeServerUrl(rawServerUrl);
      if (serverUrl.isNotEmpty) {
        final uri = Uri.parse(
          '$serverUrl/translations/similar_examples?keyword=${Uri.encodeComponent(keyword)}&folder=${Uri.encodeComponent(widget.bookName ?? '')}&limit=8',
        );

        final res = await http.get(uri).timeout(const Duration(milliseconds: 1500));
        if (res.statusCode == 200) {
          final data = jsonDecode(utf8.decode(res.bodyBytes));
          final serverList = (data['examples'] as List<dynamic>?) ?? [];

          final Set<String> existingKeys = _examples
              .map((e) => '${e['original']}||${e['translated']}')
              .toSet();

          final List<Map<String, dynamic>> merged = List.from(_examples);
          for (final item in serverList) {
            final orig = item['original'] as String? ?? '';
            final trans = item['translated'] as String? ?? '';
            final key = '$orig||$trans';
            if (!existingKeys.contains(key)) {
              existingKeys.add(key);
              merged.add({
                'id': item['id'],
                'pid': item['pid'],
                'original': orig,
                'translated': trans,
                'book_name': item['folderName'] as String? ?? '',
                'title': item['title'] as String? ?? '',
              });
            }
          }

          if (mounted) {
            setState(() {
              _examples = merged;
            });
          }
        }
      }
    } catch (_) {
      // 오프라인이거나 서버 타임아웃 시 로컬 결과 유지
    } finally {
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final panelBg = Colors.black.withOpacity(0.88);
    final borderColor = widget.theme.accentColor.withOpacity(0.4);

    return AnimatedContainer(
      duration: const Duration(milliseconds: 250),
      curve: Curves.easeOutCubic,
      height: _isCollapsed ? 56 : 280,
      decoration: BoxDecoration(
        color: panelBg,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
        border: Border(
          top: BorderSide(color: borderColor, width: 1.5),
          left: BorderSide(color: borderColor.withOpacity(0.3), width: 1),
          right: BorderSide(color: borderColor.withOpacity(0.3), width: 1),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.45),
            blurRadius: 16,
            offset: const Offset(0, -4),
          ),
        ],
      ),
      child: Column(
        children: [
          // 상단 컨트롤 바
          _buildHeaderBar(),
          // 본문 카드 목록
          if (!_isCollapsed)
            Expanded(
              child: _isLoading && _examples.isEmpty
                  ? const Center(
                      child: SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(strokeWidth: 2, color: Colors.amber),
                      ),
                    )
                  : _examples.isEmpty
                      ? _buildEmptyState()
                      : _buildExamplesList(),
            ),
        ],
      ),
    );
  }

  Widget _buildHeaderBar() {
    return GestureDetector(
      onTap: () {
        setState(() {
          _isCollapsed = !_isCollapsed;
        });
      },
      behavior: HitTestBehavior.opaque,
      child: Container(
        height: 52,
        padding: const EdgeInsets.symmetric(horizontal: 14),
        child: Row(
          children: [
            // 히스토리 뒤로가기 버튼
            if (_history.isNotEmpty)
              IconButton(
                icon: const Icon(Icons.arrow_back_rounded, color: Colors.amber, size: 20),
                tooltip: '이전 검색어로 돌아가기',
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
                onPressed: _goBackHistory,
              )
            else
              const Icon(Icons.manage_search_rounded, color: Colors.amber, size: 22),
            const SizedBox(width: 8),

            // 현재 검색 키워드 배지
            Expanded(
              child: Row(
                children: [
                  Flexible(
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.amber.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: Colors.amber.withOpacity(0.4)),
                      ),
                      child: Text(
                        _currentKeyword,
                        style: const TextStyle(
                          color: Colors.amber,
                          fontWeight: FontWeight.bold,
                          fontSize: 13,
                        ),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    '유사 번역 (${_examples.length}건)',
                    style: TextStyle(
                      color: Colors.white.withOpacity(0.8),
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ),

            // 접기/펼치기 토글
            IconButton(
              icon: Icon(
                _isCollapsed ? Icons.expand_less_rounded : Icons.expand_more_rounded,
                color: Colors.white70,
                size: 22,
              ),
              onPressed: () {
                setState(() {
                  _isCollapsed = !_isCollapsed;
                });
              },
            ),

            // 닫기 버튼
            IconButton(
              icon: const Icon(Icons.close_rounded, color: Colors.white70, size: 20),
              onPressed: widget.onClose,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_off_rounded, color: Colors.white.withOpacity(0.35), size: 36),
            const SizedBox(height: 8),
            Text(
              '\'$_currentKeyword\'에 대한 다른 번역 사례를 찾지 못했습니다.',
              style: TextStyle(color: Colors.white.withOpacity(0.6), fontSize: 13),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildExamplesList() {
    return ListView.builder(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      itemCount: _examples.length,
      itemBuilder: (context, index) {
        final item = _examples[index];
        final orig = item['original'] as String? ?? '';
        final trans = item['translated'] as String? ?? '';
        final bName = item['book_name'] as String? ?? '';
        final title = item['title'] as String? ?? '';

        return Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.06),
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Colors.white.withOpacity(0.08)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 출처 헤더 배지
              if (bName.isNotEmpty || title.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 5),
                  child: Row(
                    children: [
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                        decoration: BoxDecoration(
                          color: widget.theme.accentColor.withOpacity(0.25),
                          borderRadius: BorderRadius.circular(6),
                        ),
                        child: Text(
                          bName.isNotEmpty ? bName : '다른 소설',
                          style: TextStyle(
                            color: widget.theme.accentColor,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                      if (title.isNotEmpty) ...[
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            title,
                            style: TextStyle(
                              color: Colors.white.withOpacity(0.5),
                              fontSize: 10,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),

              // 원문 (단어 선택 및 연쇄 탐색을 지원하는 대조 뷰)
              _buildSelectableHighlightedText(
                label: '원문',
                text: orig,
                keyword: _currentKeyword,
                fontFamily: widget.japaneseFont,
                textColor: Colors.white.withOpacity(0.85),
                highlightColor: Colors.amber.withOpacity(0.35),
              ),

              const SizedBox(height: 5),

              // 번역문
              _buildSelectableHighlightedText(
                label: '번역',
                text: trans,
                keyword: _currentKeyword,
                fontFamily: widget.koreanFont,
                textColor: Colors.white,
                highlightColor: Colors.amber.withOpacity(0.4),
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildSelectableHighlightedText({
    required String label,
    required String text,
    required String keyword,
    required String fontFamily,
    required Color textColor,
    required Color highlightColor,
  }) {
    // 키워드 하이라이팅 및 텍스트 렌더링
    final spans = <TextSpan>[];
    final lowerText = text.toLowerCase();
    final lowerKw = keyword.toLowerCase();

    int start = 0;
    while (true) {
      final index = lowerText.indexOf(lowerKw, start);
      if (index < 0) {
        if (start < text.length) {
          spans.add(TextSpan(text: text.substring(start)));
        }
        break;
      }
      if (index > start) {
        spans.add(TextSpan(text: text.substring(start, index)));
      }
      spans.add(
        TextSpan(
          text: text.substring(index, index + keyword.length),
          style: TextStyle(
            backgroundColor: highlightColor,
            color: Colors.amberAccent,
            fontWeight: FontWeight.bold,
          ),
        ),
      );
      start = index + keyword.length;
    }

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          margin: const EdgeInsets.only(top: 2, right: 6),
          padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.12),
            borderRadius: BorderRadius.circular(4),
          ),
          child: Text(
            label,
            style: TextStyle(color: Colors.white.withOpacity(0.7), fontSize: 9, fontWeight: FontWeight.bold),
          ),
        ),
        Expanded(
          child: SelectableText.rich(
            TextSpan(
              style: TextStyle(
                color: textColor,
                fontSize: 12.5,
                height: 1.4,
                fontFamily: fontFamily,
              ),
              children: spans,
            ),
            contextMenuBuilder: (context, editableTextState) {
              final selectedText = editableTextState.textEditingValue.selection.textInside(
                editableTextState.textEditingValue.text,
              ).trim();

              return AdaptiveTextSelectionToolbar.buttonItems(
                anchors: editableTextState.contextMenuAnchors,
                buttonItems: [
                  if (selectedText.isNotEmpty)
                    ContextMenuButtonItem(
                      onPressed: () {
                        editableTextState.hideToolbar();
                        _navigateToKeyword(selectedText);
                      },
                      label: '🔍 연쇄 유사번역 조회',
                    ),
                  ...editableTextState.contextMenuButtonItems,
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}
