import '../../services/font_helper.dart';
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:intl/intl.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../models/chapter.dart';
import '../../models/sentence.dart';
import '../../models/sentence_highlight.dart';
import '../../services/local_db_service.dart';
import '../../services/preferences_service.dart';
import '../../services/sync_service.dart';
import '../themes/reader_themes.dart';
import '../themes/hyper_aesthetic_theme.dart';
import 'novel_ruby_text.dart';
import 'quick_edit_dialog.dart';
import 'reader_settings_sheet.dart';
import 'similar_translations_panel.dart';
import 'toc_drawer.dart';
import 'tts_player_panel.dart';

class ReaderScreen extends StatefulWidget {
  final String bookName;
  final String? initialChapterTitle;
  final String? initialPid;

  const ReaderScreen({
    super.key,
    required this.bookName,
    this.initialChapterTitle,
    this.initialPid,
  });

  @override
  State<ReaderScreen> createState() => _ReaderScreenState();
}

class _ReaderScreenState extends State<ReaderScreen> {
  final GlobalKey<ScaffoldState> _scaffoldKey = GlobalKey<ScaffoldState>();

  List<Chapter> _chapters = [];
  int _currentChapterIndex = 0;
  List<Sentence> _sentences = [];
  bool _isLoading = true;
  bool _showControls = false;
  bool _showTtsPanel = false;
  bool _isTransitioningChapter = false;
  String? _similarSearchKeyword;
  final Set<String> _expandedOriginalPids = {};

  // 페이징 및 스크롤 컨트롤러
  PageController _pageController = PageController();
  final ScrollController _scrollController = ScrollController();
  int _currentPage = 0;
  double _currentScrollProgress = 0.0;

  // 독서 시간 기록용 타이머
  Timer? _readingTimer;
  int _sessionSeconds = 0;
  Timer? _saveProgressTimer;

  // 폰트 크기 및 대역 모드에 따른 화면당 최적 문장 수 동적 계산
  int get _sentencesPerPage {
    final fontSize = PreferencesService.fontSize;
    final isBilingual = PreferencesService.originalTextMode == 'bilingual';

    if (isBilingual) {
      if (fontSize >= 24) return 3;
      if (fontSize >= 18) return 4;
      return 5;
    } else {
      if (fontSize >= 26) return 4;
      if (fontSize >= 22) return 5;
      if (fontSize >= 18) return 6;
      return 7;
    }
  }

  // 본문 순수 페이지 수
  int get _contentPageCount {
    if (_sentences.isEmpty) return 1;
    return (_sentences.length / _sentencesPerPage).ceil().clamp(1, 9999);
  }

  static const MethodChannel _volumeChannel = MethodChannel('com.lanovel.lanovel_reader/volume_key');

  void _nextPageOrScroll() {
    if (PreferencesService.viewMode == 'paging' && _pageController.hasClients) {
      if (_currentPage < _contentPageCount - 1) {
        _pageController.nextPage(duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      } else {
        if (_currentChapterIndex < _chapters.length - 1) {
          _loadChapter(_currentChapterIndex + 1);
        }
      }
    } else if (_scrollController.hasClients) {
      final target = (_scrollController.offset + 400).clamp(0.0, _scrollController.position.maxScrollExtent);
      _scrollController.animateTo(target, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
    }
  }

  void _prevPageOrScroll() {
    if (PreferencesService.viewMode == 'paging' && _pageController.hasClients) {
      if (_currentPage > 0) {
        _pageController.previousPage(duration: const Duration(milliseconds: 250), curve: Curves.easeOut);
      } else {
        if (_currentChapterIndex > 0) {
          _loadChapter(_currentChapterIndex - 1, loadLastPage: true);
        }
      }
    } else if (_scrollController.hasClients) {
      final target = (_scrollController.offset - 400).clamp(0.0, _scrollController.position.maxScrollExtent);
      _scrollController.animateTo(target, duration: const Duration(milliseconds: 200), curve: Curves.easeOut);
    }
  }

  @override
  void initState() {
    super.initState();
    _initReader();
    _startReadingTracker();
    if (PreferencesService.keepScreenOn) {
      WakelockPlus.enable();
    }
    if (PreferencesService.volumeKeyPaging) {
      _volumeChannel.invokeMethod('enableVolumeKeyPaging', {'enable': true});
      _volumeChannel.setMethodCallHandler((call) async {
        if (call.method == 'onVolumeKeyDown') {
          final direction = call.arguments?['direction'] as String?;
          if (direction == 'next') {
            _nextPageOrScroll();
          } else if (direction == 'prev') {
            _prevPageOrScroll();
          }
        }
      });
    }

    _scrollController.addListener(() {
      if (_scrollController.hasClients && _scrollController.position.maxScrollExtent > 0) {
        final progress = (_scrollController.offset / _scrollController.position.maxScrollExtent).clamp(0.0, 1.0);
        if ((progress - _currentScrollProgress).abs() > 0.005) {
          setState(() {
            _currentScrollProgress = progress;
          });
        }
      }
      if (PreferencesService.viewMode != 'paging' && _scrollController.hasClients) {
        _debounceSaveProgress();
      }
    });
  }

  @override
  void dispose() {
    SyncService.activeReadingUrl = null;
    _volumeChannel.invokeMethod('enableVolumeKeyPaging', {'enable': false});
    _volumeChannel.setMethodCallHandler(null);
    _readingTimer?.cancel();
    _saveProgressTimer?.cancel();
    _saveCurrentPosition();
    _flushReadingLog();
    _pageController.dispose();
    _scrollController.dispose();
    WakelockPlus.disable();
    super.dispose();
  }

  // 화면 탭 통합 핸들러 (텍스트 위든 여백이든 동일하게 처리)
  void _handleScreenTap(Offset globalPosition) {
    // 1. 컨트롤 바나 TTS 패널이 열려 있을 때는 화면 어디(텍스트/여백)를 눌러도 즉시 닫기
    if (_showControls || _showTtsPanel) {
      setState(() {
        _showControls = false;
        _showTtsPanel = false;
      });
      return;
    }

    final screenWidth = MediaQuery.of(context).size.width;
    final tapX = globalPosition.dx;
    final isPaging = PreferencesService.viewMode == 'paging';

    if (isPaging) {
      // 3분할 탭: 좌 25%(이전), 우 25%(다음), 중앙 50%(컨트롤바 토글)
      if (tapX < screenWidth * 0.25) {
        if (_currentPage > 0) {
          _pageController.previousPage(
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeInOut,
          );
        } else if (_currentChapterIndex > 0 && !_isTransitioningChapter) {
          _loadChapter(_currentChapterIndex - 1, loadLastPage: true);
        }
      } else if (tapX > screenWidth * 0.75) {
        final maxPage = _contentPageCount - 1;
        if (_currentPage < maxPage) {
          _pageController.nextPage(
            duration: const Duration(milliseconds: 250),
            curve: Curves.easeInOut,
          );
        } else if (_currentChapterIndex < _chapters.length - 1 && !_isTransitioningChapter) {
          _loadChapter(_currentChapterIndex + 1);
        } else {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('마지막 회차입니다.'),
              duration: Duration(seconds: 1),
            ),
          );
        }
      } else {
        setState(() => _showControls = true);
      }
    } else {
      // 스크롤 모드에서는 탭 시 컨트롤바 열기
      setState(() => _showControls = true);
    }
  }

  // PageView 페이지 변경 감지 (스와이프로 이전 화 / 다음 화 넘어가기)
  void _onPageChanged(int page) {
    if (_isTransitioningChapter) return;

    final hasPrev = _currentChapterIndex > 0;
    final prevOffset = hasPrev ? 1 : 0;
    final contentPages = _contentPageCount;

    // 1. 이전 화 전환 슬롯으로 스와이프된 경우 (첫 페이지 앞에서 이전으로 스와이프)
    if (hasPrev && page == 0) {
      _loadChapter(_currentChapterIndex - 1, loadLastPage: true);
      return;
    }

    // 2. 다음 화 전환 슬롯으로 스와이프된 경우 (마지막 페이지 뒤로 스와이프)
    if (page >= prevOffset + contentPages) {
      if (_currentChapterIndex < _chapters.length - 1) {
        _loadChapter(_currentChapterIndex + 1);
      }
      return;
    }

    // 3. 본문 페이지
    final actualPage = page - prevOffset;
    setState(() => _currentPage = actualPage);
    _debounceSaveProgress();
  }

  void _debounceSaveProgress() {
    _saveProgressTimer?.cancel();
    _saveProgressTimer = Timer(const Duration(milliseconds: 700), () {
      _saveCurrentPosition();
    });
  }

  void _saveCurrentPosition() {
    if (_sentences.isEmpty || _chapters.isEmpty || _currentChapterIndex >= _chapters.length) return;
    final perPage = _sentencesPerPage;
    String? pid;

    final isPaging = PreferencesService.viewMode == 'paging';
    if (isPaging) {
      final startIdx = _currentPage * perPage;
      pid = (startIdx < _sentences.length) ? _sentences[startIdx].pid : _sentences.first.pid;
    } else {
      if (_scrollController.hasClients && _scrollController.position.maxScrollExtent > 0) {
        final ratio = (_scrollController.offset / _scrollController.position.maxScrollExtent).clamp(0.0, 1.0);
        final sIdx = (ratio * (_sentences.length - 1)).round();
        pid = _sentences[sIdx].pid;
      } else {
        pid = _sentences.first.pid;
      }
    }

    final targetChapter = _chapters[_currentChapterIndex];
    LocalDbService.updateReadingProgress(
      bookName: widget.bookName,
      chapterTitle: targetChapter.title,
      pid: pid,
      isCompleted: (_currentChapterIndex == _chapters.length - 1 && _currentPage >= _contentPageCount - 1),
    );
  }

  void _startReadingTracker() {
    _readingTimer = Timer.periodic(const Duration(seconds: 15), (timer) {
      _sessionSeconds += 15;
      _flushReadingLog();
    });
  }

  void _flushReadingLog() {
    if (_sessionSeconds >= 15 && _chapters.isNotEmpty && _currentChapterIndex < _chapters.length) {
      final todayStr = DateFormat('yyyy-MM-dd').format(DateTime.now());
      LocalDbService.recordReadingTime(
        date: todayStr,
        additionalSeconds: _sessionSeconds,
        additionalPages: 1,
        bookTitle: widget.bookName,
        chapterTitle: _chapters[_currentChapterIndex].title,
      );
      _sessionSeconds = 0;
    }
  }

  Future<void> _initReader() async {
    setState(() => _isLoading = true);
    _chapters = await LocalDbService.getChapters(widget.bookName);

    if (_chapters.isNotEmpty) {
      int initialIdx = 0;
      String? initialPid;
      final book = await LocalDbService.getBook(widget.bookName);

      if (widget.initialChapterTitle != null) {
        final found = _chapters.indexWhere((c) => c.title == widget.initialChapterTitle);
        if (found != -1) {
          initialIdx = found;
          if (widget.initialPid != null) {
            initialPid = widget.initialPid;
          } else if (book?.lastReadChapterTitle == widget.initialChapterTitle) {
            initialPid = book?.lastReadPid;
          }
        }
      } else {
        // 책의 마지막 읽던 챕터 확인
        if (book?.lastReadChapterTitle != null) {
          final found = _chapters.indexWhere((c) => c.title == book!.lastReadChapterTitle);
          if (found != -1) {
            initialIdx = found;
            initialPid = book?.lastReadPid;
          }
        }
      }
      await _loadChapter(initialIdx, targetPid: initialPid);
    } else {
      setState(() => _isLoading = false);
    }
  }

  Future<void> _loadChapter(int index, {String? targetPid, bool loadLastPage = false}) async {
    if (index < 0 || index >= _chapters.length) return;
    if (_isTransitioningChapter && index == _currentChapterIndex) return;

    _isTransitioningChapter = true;

    setState(() {
      _isLoading = true;
      _currentChapterIndex = index;
      _currentScrollProgress = 0.0;
    });

    final targetChapter = _chapters[index];
    SyncService.activeReadingUrl = targetChapter.url;
    final sentences = await LocalDbService.loadChapterSentences(targetChapter.id!);
    final highlightedPids = await LocalDbService.getHighlightedPids(targetChapter.url);
    for (var s in sentences) {
      if (s.pid != null && highlightedPids.contains(s.pid)) {
        s.isHighlighted = true;
      }
    }

    final perPage = _sentencesPerPage;
    final pageCount = (sentences.length / perPage).ceil().clamp(1, 9999);

    int targetPage = 0;
    if (loadLastPage) {
      targetPage = pageCount - 1;
    } else if (targetPid != null && sentences.isNotEmpty) {
      final sIdx = sentences.indexWhere((s) => s.pid == targetPid);
      if (sIdx != -1) {
        targetPage = (sIdx / perPage).floor().clamp(0, pageCount - 1);
      }
    }

    if (!mounted) return;

    final hasPrev = index > 0;
    final prevOffset = hasPrev ? 1 : 0;
    final pageControllerTarget = targetPage + prevOffset;

    // 새로운 페이지 컨트롤러 할당으로 초기 페이지 확실하게 바인딩
    _pageController.dispose();
    _pageController = PageController(initialPage: pageControllerTarget);

    setState(() {
      _sentences = sentences;
      _isLoading = false;
      _currentPage = targetPage;
    });

    // 독서 진도 저장
    final currentFirstPid = sentences.isNotEmpty
        ? ((targetPage * perPage < sentences.length)
            ? sentences[targetPage * perPage].pid
            : sentences.first.pid)
        : null;

    await LocalDbService.updateReadingProgress(
      bookName: widget.bookName,
      chapterTitle: targetChapter.title,
      pid: currentFirstPid,
      isCompleted: (index == _chapters.length - 1 && targetPage >= pageCount - 1),
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scrollController.hasClients) {
        if (loadLastPage && _scrollController.position.maxScrollExtent > 0) {
          _scrollController.jumpTo(_scrollController.position.maxScrollExtent);
        } else if (targetPid != null && sentences.isNotEmpty && _scrollController.position.maxScrollExtent > 0) {
          final sIdx = sentences.indexWhere((s) => s.pid == targetPid);
          if (sIdx != -1) {
            final ratio = sIdx / (sentences.length - 1);
            final offset = (ratio * _scrollController.position.maxScrollExtent).clamp(0.0, _scrollController.position.maxScrollExtent);
            _scrollController.jumpTo(offset);
          }
        } else {
          _scrollController.jumpTo(0.0);
        }
      }

      // 전환 안정화 후 가드 해제
      Future.delayed(const Duration(milliseconds: 200), () {
        if (mounted) {
          setState(() {
            _isTransitioningChapter = false;
          });
        }
      });
    });
  }

  void _openSimilarTranslations(String keyword) {
    final trimmed = keyword.trim();
    if (trimmed.isEmpty) return;
    setState(() {
      _similarSearchKeyword = trimmed;
      _showControls = false;
      _showTtsPanel = false;
    });
  }

  void _promptSimilarSearch(ReaderThemeData theme) {
    final controller = TextEditingController();
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: theme.surfaceColor,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        title: Row(
          children: [
            const Icon(Icons.manage_search_rounded, color: Colors.amber, size: 24),
            const SizedBox(width: 8),
            Text(
              '유사 번역 용례 검색',
              style: TextStyle(color: theme.textColor, fontSize: 16, fontWeight: FontWeight.bold),
            ),
          ],
        ),
        content: TextField(
          controller: controller,
          autofocus: true,
          style: TextStyle(color: theme.textColor, fontSize: 15),
          decoration: InputDecoration(
            hintText: '검색할 일본어 또는 한국어 단어...',
            hintStyle: TextStyle(color: theme.subTextColor.withOpacity(0.5)),
            filled: true,
            fillColor: theme.background,
            border: OutlineInputBorder(borderRadius: BorderRadius.circular(8)),
            focusedBorder: OutlineInputBorder(
              borderRadius: BorderRadius.circular(8),
              borderSide: const BorderSide(color: Colors.amber, width: 2),
            ),
          ),
          onSubmitted: (val) {
            Navigator.pop(ctx);
            _openSimilarTranslations(val);
          },
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text('취소', style: TextStyle(color: theme.subTextColor)),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.amber,
              foregroundColor: Colors.black,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
            ),
            onPressed: () {
              Navigator.pop(ctx);
              _openSimilarTranslations(controller.text);
            },
            child: const Text('용례 조회', style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        ],
      ),
    );
  }

  Future<void> _toggleHighlight(Sentence sentence) async {
    final currentChap = _chapters[_currentChapterIndex];
    final isNowHighlighted = !sentence.isHighlighted;

    setState(() {
      sentence.isHighlighted = isNowHighlighted;
    });

    if (isNowHighlighted) {
      final item = SentenceHighlight(
        bookName: currentChap.bookName,
        chapterTitle: currentChap.title,
        url: currentChap.url,
        pid: sentence.pid ?? 'p0',
        original: sentence.original,
        translated: sentence.translated,
        createdAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
        isResolved: 0,
      );
      await LocalDbService.addSentenceHighlight(item);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('수정 대기 하이라이트가 등록되었습니다. (PC/폰에서 바로 조회 및 수정 가능)'),
            duration: Duration(seconds: 2),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    } else {
      await LocalDbService.removeSentenceHighlight(currentChap.url, sentence.pid ?? 'p0');
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('하이라이트가 해제되었습니다.'),
            duration: Duration(seconds: 2),
            behavior: SnackBarBehavior.floating,
          ),
        );
      }
    }
  }

  void _onSentenceLongPressed(Sentence sentence) {
    if (sentence.original.isEmpty) {
      _showSentenceActionSheet(sentence);
      return;
    }
    HapticFeedback.lightImpact();
    setState(() {
      if (sentence.pid != null) {
        if (_expandedOriginalPids.contains(sentence.pid)) {
          _expandedOriginalPids.remove(sentence.pid);
        } else {
          _expandedOriginalPids.add(sentence.pid!);
        }
      }
    });
  }

  void _showSentenceActionSheet(Sentence sentence) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);
    final isOriginalExpanded = _expandedOriginalPids.contains(sentence.pid);

    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            final isHl = sentence.isHighlighted;
            return Container(
              margin: const EdgeInsets.all(16),
              padding: const EdgeInsets.fromLTRB(20, 16, 20, 24),
              decoration: HyperAestheticTheme.glassBox(
                theme: theme,
                borderRadius: 24,
                opacity: 0.96,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Center(
                    child: Container(
                      width: 40,
                      height: 4,
                      margin: const EdgeInsets.only(bottom: 16),
                      decoration: BoxDecoration(
                        color: theme.subTextColor.withOpacity(0.3),
                        borderRadius: BorderRadius.circular(2),
                      ),
                    ),
                  ),
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Container(
                        padding: const EdgeInsets.all(6),
                        decoration: BoxDecoration(
                          color: (isHl ? Colors.amber : primary).withOpacity(0.15),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Icon(
                          isHl ? Icons.edit_note_rounded : Icons.translate_rounded,
                          color: isHl ? Colors.amber : primary,
                          size: 20,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              sentence.translated.isNotEmpty ? sentence.translated : '(빈 번역문)',
                              style: TextStyle(
                                color: theme.textColor,
                                fontSize: 15,
                                fontWeight: FontWeight.w600,
                                height: 1.4,
                              ),
                              maxLines: 3,
                              overflow: TextOverflow.ellipsis,
                            ),
                            if (sentence.original.isNotEmpty) ...[
                              const SizedBox(height: 6),
                              Text(
                                sentence.original,
                                style: TextStyle(
                                  color: theme.originalTextColor,
                                  fontSize: 13,
                                  height: 1.35,
                                ),
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                              ),
                            ],
                          ],
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),
                  const Divider(height: 1),
                  const SizedBox(height: 12),
                  // 액션 버튼 1: [수정 대기 하이라이트 토글] (원터치 콕)
                  InkWell(
                    onTap: () async {
                      Navigator.pop(ctx);
                      await _toggleHighlight(sentence);
                    },
                    borderRadius: BorderRadius.circular(14),
                    child: Container(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      decoration: BoxDecoration(
                        color: (isHl ? Colors.amber : primary).withOpacity(0.12),
                        borderRadius: BorderRadius.circular(14),
                        border: Border.all(
                          color: (isHl ? Colors.amber : primary).withOpacity(0.35),
                          width: 1.2,
                        ),
                      ),
                      child: Row(
                        children: [
                          Icon(
                            isHl ? Icons.bookmark_remove_rounded : Icons.bookmark_add_rounded,
                            color: isHl ? Colors.amber : primary,
                            size: 22,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  isHl ? '수정 대기 마킹 해제' : '수정 대기 하이라이트 콕 찍기',
                                  style: TextStyle(
                                    color: theme.textColor,
                                    fontSize: 14,
                                    fontWeight: FontWeight.bold,
                                  ),
                                ),
                                const SizedBox(height: 2),
                                Text(
                                  isHl ? '마킹을 해제하고 정상 표시로 되돌립니다.' : '태블릿에서 콕 찍어두고 PC/폰에서 키보드로 바로 수정',
                                  style: TextStyle(
                                    color: theme.subTextColor,
                                    fontSize: 11,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: (isHl ? Colors.amber : primary).withOpacity(0.2),
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              isHl ? 'ON' : 'OFF',
                              style: TextStyle(
                                color: isHl ? Colors.amber : primary,
                                fontSize: 11,
                                fontWeight: FontWeight.bold,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (sentence.original.isNotEmpty)
                    ListTile(
                      dense: true,
                      leading: Icon(
                        isOriginalExpanded ? Icons.visibility_off_outlined : Icons.visibility_outlined,
                        color: theme.subTextColor,
                      ),
                      title: Text(
                        isOriginalExpanded ? '본문에서 원문 숨기기' : '본문에서 원문 항상 펼치기',
                        style: TextStyle(color: theme.textColor, fontSize: 14),
                      ),
                      onTap: () {
                        Navigator.pop(ctx);
                        setState(() {
                          if (isOriginalExpanded) {
                            _expandedOriginalPids.remove(sentence.pid);
                          } else {
                            if (sentence.pid != null) _expandedOriginalPids.add(sentence.pid!);
                          }
                        });
                      },
                    ),
                  ListTile(
                    dense: true,
                    leading: Icon(Icons.edit_outlined, color: theme.subTextColor),
                    title: Text(
                      '키보드로 직접 수정하기',
                      style: TextStyle(color: theme.textColor, fontSize: 14),
                    ),
                    onTap: () {
                      Navigator.pop(ctx);
                      _openQuickEditDialog(sentence);
                    },
                  ),
                  if (sentence.original.isNotEmpty)
                    ListTile(
                      dense: true,
                      leading: Icon(Icons.copy_rounded, color: theme.subTextColor),
                      title: Text('일본어 원문 복사', style: TextStyle(color: theme.textColor, fontSize: 14)),
                      onTap: () {
                        Clipboard.setData(ClipboardData(text: sentence.original));
                        Navigator.pop(ctx);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('원문이 클립보드에 복사되었습니다.')),
                        );
                      },
                    ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _openQuickEditDialog(Sentence sentence) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);
    showDialog(
      context: context,
      builder: (ctx) => QuickEditDialog(
        sentence: sentence,
        theme: theme,
        koreanFont: PreferencesService.koreanFont,
        japaneseFont: PreferencesService.japaneseFont,
        onSearchSimilar: (kw) => _openSimilarTranslations(kw),
        onSave: (newTranslated) async {
          setState(() {
            sentence.translated = newTranslated;
          });
          final currentChap = _chapters[_currentChapterIndex];
          await LocalDbService.updateSentence(currentChap.id!, sentence, _sentences);
          if (mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('번역문이 교정되어 로컬 DB에 저장되었습니다.')),
            );
          }
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);
    final isPaging = PreferencesService.viewMode == 'paging';

    if (_isLoading) {
      return Scaffold(
        backgroundColor: theme.background,
        body: Center(
          child: CircularProgressIndicator(color: theme.accentColor),
        ),
      );
    }

    if (_chapters.isEmpty) {
      return Scaffold(
        backgroundColor: theme.background,
        appBar: AppBar(
          backgroundColor: theme.surfaceColor,
          elevation: 0,
          leading: IconButton(
            icon: Icon(Icons.arrow_back, color: theme.textColor),
            onPressed: () => Navigator.pop(context),
          ),
          title: Text(widget.bookName, style: TextStyle(color: theme.textColor)),
        ),
        body: Center(
          child: Text(
            '챕터 데이터가 없습니다.\n동기화를 먼저 진행해 주세요.',
            textAlign: TextAlign.center,
            style: TextStyle(color: theme.subTextColor),
          ),
        ),
      );
    }

    final currentChap = _chapters[_currentChapterIndex];

    return Scaffold(
      key: _scaffoldKey,
      backgroundColor: theme.background,
      drawer: TocDrawer(
        bookName: widget.bookName,
        chapters: _chapters,
        currentChapterIndex: _currentChapterIndex,
        theme: theme,
        onSelectChapter: (idx) => _loadChapter(idx),
      ),
      body: Stack(
        children: [
          // 1. 뷰어 본문 인터랙션 영역 (텍스트/여백 어디를 눌러도 _handleScreenTap 동작)
          GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTapUp: (details) => _handleScreenTap(details.globalPosition),
            child: isPaging ? _buildPagingView(theme) : _buildScrollView(theme),
          ),

          // 2. 상단 헤더 플로팅 에어-글래스 컨트롤 바
          if (_showControls)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: _buildTopBar(theme, currentChap),
            ),

          // 2.5 평소 독서 중 하단 미니멀 앰비언트 프로그레스 레이
          if (!_showControls && !_showTtsPanel && _similarSearchKeyword == null)
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: _buildAmbientMicroProgressRay(theme),
            ),

          // 3. 하단 네비게이션 & 현재 회차 진행도 플로팅 독
          if (_showControls)
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: _buildBottomBar(theme),
            ),

          // 4. TTS 오디오 플레이어 패널 (토글 시)
          if (_showTtsPanel)
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: TtsPlayerPanel(
                bookName: widget.bookName,
                chapterTitle: currentChap.title,
                theme: theme,
                onClose: () => setState(() => _showTtsPanel = false),
              ),
            ),

          // 5. 유사 번역 용례 탐색기 패널 (선택된 키워드 존재 시)
          if (_similarSearchKeyword != null)
            Positioned(
              bottom: 0,
              left: 0,
              right: 0,
              child: SimilarTranslationsPanel(
                initialKeyword: _similarSearchKeyword!,
                bookName: widget.bookName,
                theme: theme,
                koreanFont: PreferencesService.koreanFont,
                japaneseFont: PreferencesService.japaneseFont,
                onClose: () => setState(() => _similarSearchKeyword = null),
              ),
            ),
        ],
      ),
    );
  }

  // ============================================================================
  // 상단 플로팅 헤더 (Floating Reader Header)
  // ============================================================================
  Widget _buildTopBar(ReaderThemeData theme, Chapter currentChap) {
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);
    final secondary = HyperAestheticTheme.getAmbientSecondary(theme);

    return SafeArea(
      bottom: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 8, 16, 0),
        child: HyperGlassCard(
          theme: theme,
          borderRadius: 20,
          blur: 16.0,
          opacity: 0.92,
          glow: false,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: Row(
            children: [
              // 뒤로가기 버튼 (44dp 안심 터치 타깃)
              InkWell(
                onTap: () {
                  HapticFeedback.lightImpact();
                  Navigator.pop(context);
                },
                borderRadius: BorderRadius.circular(20),
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                  child: Center(
                    child: Container(
                      width: 34,
                      height: 34,
                      decoration: BoxDecoration(
                        color: primary.withOpacity(0.12),
                        shape: BoxShape.circle,
                      ),
                      child: Icon(Icons.arrow_back_rounded, color: theme.textColor, size: 20),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 8),
              // 중앙 소설명 및 챕터명
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            widget.bookName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: theme.subTextColor,
                              fontSize: 11,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                        const SizedBox(width: 6),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1.5),
                          decoration: BoxDecoration(
                            gradient: LinearGradient(colors: [primary, secondary]),
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Text(
                            '제 ${_currentChapterIndex + 1}화',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 9,
                              fontWeight: FontWeight.w900,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 1),
                    Text(
                      currentChap.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: theme.textColor,
                        fontSize: 13,
                        fontWeight: FontWeight.bold,
                        letterSpacing: -0.3,
                      ),
                    ),
                  ],
                ),
              ),
              // 우측 컨트롤 그룹 (최소 44dp 안심 터치 타깃 보장)
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  IconButton(
                    icon: Icon(Icons.list_rounded, color: theme.textColor, size: 22),
                    tooltip: '목차',
                    constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                    padding: const EdgeInsets.all(8),
                    onPressed: () {
                      HapticFeedback.lightImpact();
                      _scaffoldKey.currentState?.openDrawer();
                    },
                  ),
                  IconButton(
                    icon: Icon(
                      Icons.manage_search_rounded,
                      color: _similarSearchKeyword != null ? Colors.amber : theme.textColor,
                      size: 22,
                    ),
                    tooltip: '사전 & 유사 용례 검색',
                    constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                    padding: const EdgeInsets.all(8),
                    onPressed: () {
                      HapticFeedback.lightImpact();
                      _promptSimilarSearch(theme);
                    },
                  ),
                  IconButton(
                    icon: Icon(
                      Icons.headphones_rounded,
                      color: _showTtsPanel ? primary : theme.textColor,
                      size: 20,
                    ),
                    tooltip: 'TTS 오디오',
                    constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                    padding: const EdgeInsets.all(8),
                    onPressed: () {
                      HapticFeedback.selectionClick();
                      setState(() => _showTtsPanel = !_showTtsPanel);
                    },
                  ),
                  IconButton(
                    icon: Icon(Icons.text_format_rounded, color: theme.textColor, size: 22),
                    tooltip: '독서 설정',
                    constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                    padding: const EdgeInsets.all(8),
                    onPressed: () {
                      HapticFeedback.lightImpact();
                      showModalBottomSheet(
                        context: context,
                        backgroundColor: Colors.transparent,
                        builder: (_) => ReaderSettingsSheet(
                          currentTheme: theme,
                          onSettingsChanged: () => setState(() {}),
                        ),
                      );
                    },
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  // ============================================================================
  // 하단 플로팅 컨트롤 독 (Floating Reader Control Deck)
  // ============================================================================
  Widget _buildBottomBar(ReaderThemeData theme) {
    final isPaging = PreferencesService.viewMode == 'paging';
    final contentPages = _contentPageCount;
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);
    final secondary = HyperAestheticTheme.getAmbientSecondary(theme);

    final double currentProgress = isPaging
        ? (_currentPage / (contentPages > 1 ? contentPages - 1 : 1)).clamp(0.0, 1.0)
        : _currentScrollProgress.clamp(0.0, 1.0);

    return SafeArea(
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        child: HyperGlassCard(
          theme: theme,
          borderRadius: 24,
          blur: 16.0,
          opacity: 0.92,
          glow: false,
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 14),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              // 상단 미니멀 프로그레스 레이
              Container(
                height: 2.5,
                width: double.infinity,
                decoration: BoxDecoration(
                  color: theme.isDark ? Colors.white10 : Colors.black12,
                  borderRadius: BorderRadius.circular(1.5),
                ),
                child: FractionallySizedBox(
                  alignment: Alignment.centerLeft,
                  widthFactor: currentProgress.clamp(0.01, 1.0),
                  child: Container(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(colors: [primary, secondary]),
                      borderRadius: BorderRadius.circular(1.5),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 10),

              // 1. 회차 전환 및 회차 위치 표시줄 (최소 44dp 터치 타깃 보장)
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  // 이전 화 캡슐
                  HyperHapticPill(
                    theme: theme,
                    icon: const Icon(Icons.arrow_back_ios_rounded, size: 12),
                    label: '이전 화',
                    height: 40,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    onTap: _currentChapterIndex > 0
                        ? () => _loadChapter(_currentChapterIndex - 1)
                        : () {},
                  ),

                  // 현재 회차 정보 캡슐 (탭 시 목차 오픈, 44dp 안심 영역)
                  InkWell(
                    onTap: () {
                      HapticFeedback.selectionClick();
                      _scaffoldKey.currentState?.openDrawer();
                    },
                    borderRadius: BorderRadius.circular(18),
                    child: Container(
                      height: 40,
                      padding: const EdgeInsets.symmetric(horizontal: 14),
                      decoration: BoxDecoration(
                        color: primary.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(20),
                        border: Border.all(color: primary.withOpacity(0.3), width: 1.0),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            '제 ${_currentChapterIndex + 1}화',
                            style: TextStyle(
                              color: primary,
                              fontSize: 12,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                          Text(
                            ' / ${_chapters.length}화',
                            style: TextStyle(
                              color: theme.subTextColor,
                              fontSize: 11,
                            ),
                          ),
                          const SizedBox(width: 4),
                          Icon(Icons.unfold_more_rounded, size: 13, color: primary),
                        ],
                      ),
                    ),
                  ),

                  // 다음 화 캡슐 (주요 액션 버튼)
                  HyperHapticPill(
                    theme: theme,
                    icon: const Icon(Icons.arrow_forward_ios_rounded, size: 12, color: Colors.white),
                    label: '다음 화',
                    isPrimary: true,
                    height: 40,
                    padding: const EdgeInsets.symmetric(horizontal: 14),
                    onTap: _currentChapterIndex < _chapters.length - 1
                        ? () => _loadChapter(_currentChapterIndex + 1)
                        : () {},
                  ),
                ],
              ),

              const SizedBox(height: 6),

              // 2. 현재 회차 진행도 정밀 슬라이더 바
              if (isPaging) ...[
                Row(
                  children: [
                    Text(
                      '${_currentPage + 1}p',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                    Expanded(
                      child: Slider(
                        value: _currentPage.clamp(0, contentPages - 1).toDouble(),
                        min: 0,
                        max: (contentPages - 1 > 0 ? contentPages - 1 : 1).toDouble(),
                        divisions: contentPages > 1 ? contentPages - 1 : 1,
                        activeColor: primary,
                        inactiveColor: theme.isDark ? Colors.white12 : Colors.black12,
                        onChanged: contentPages > 1
                            ? (val) {
                                HapticFeedback.selectionClick();
                                final p = val.toInt();
                                setState(() => _currentPage = p);
                                final hasPrev = _currentChapterIndex > 0;
                                final prevOffset = hasPrev ? 1 : 0;
                                if (_pageController.hasClients) {
                                  _pageController.jumpToPage(p + prevOffset);
                                }
                              }
                            : null,
                      ),
                    ),
                    Text(
                      '${contentPages}p',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                Text(
                  '${_currentPage + 1} / $contentPages 페이지 (${((_currentPage + 1) / contentPages * 100).toStringAsFixed(1)}%)',
                  style: TextStyle(color: theme.subTextColor, fontSize: 10, fontWeight: FontWeight.w500),
                ),
              ] else ...[
                Row(
                  children: [
                    Text(
                      '${(_currentScrollProgress * 100).toInt()}%',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                    Expanded(
                      child: Slider(
                        value: _currentScrollProgress.clamp(0.0, 1.0),
                        min: 0.0,
                        max: 1.0,
                        activeColor: primary,
                        inactiveColor: theme.isDark ? Colors.white12 : Colors.black12,
                        onChanged: (val) {
                          HapticFeedback.selectionClick();
                          setState(() => _currentScrollProgress = val);
                          if (_scrollController.hasClients && _scrollController.position.maxScrollExtent > 0) {
                            _scrollController.jumpTo(val * _scrollController.position.maxScrollExtent);
                          }
                        },
                      ),
                    ),
                    Text(
                      '100%',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.bold),
                    ),
                  ],
                ),
                Text(
                  '스크롤 진행도: ${(_currentScrollProgress * 100).toStringAsFixed(1)}%',
                  style: TextStyle(color: theme.subTextColor, fontSize: 10, fontWeight: FontWeight.w500),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  // ============================================================================
  // 평소 독서 중 하단 미니멀 프로그레스 레이 (Minimal Slim Progress Ray)
  // ============================================================================
  Widget _buildAmbientMicroProgressRay(ReaderThemeData theme) {
    final isPaging = PreferencesService.viewMode == 'paging';
    final contentPages = _contentPageCount;
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);

    final double progress = isPaging
        ? ((_currentPage + 1) / (contentPages > 0 ? contentPages : 1)).clamp(0.0, 1.0)
        : _currentScrollProgress.clamp(0.0, 1.0);

    return Container(
      height: 1.5,
      width: double.infinity,
      color: Colors.transparent,
      child: FractionallySizedBox(
        alignment: Alignment.centerLeft,
        widthFactor: progress.clamp(0.005, 1.0),
        child: ColoredBox(
          color: primary.withOpacity(0.85),
        ),
      ),
    );
  }

  // 페이징 뷰 (이전 화 & 다음 화 양방향 스와이프 전환 지원 + 하단 여백 및 잘림 방지 스크롤 지원)
  Widget _buildPagingView(ReaderThemeData theme) {
    final perPage = _sentencesPerPage;
    final contentPages = _contentPageCount;
    final hasPrev = _currentChapterIndex > 0;
    final hasNext = _currentChapterIndex < _chapters.length - 1;

    final prevOffset = hasPrev ? 1 : 0;
    final totalPages = contentPages + prevOffset + (hasNext ? 1 : 0);

    return PageView.builder(
      controller: _pageController,
      itemCount: totalPages,
      onPageChanged: _onPageChanged,
      itemBuilder: (context, pageIndex) {
        // 1. 이전 화 스와이프 전환 페이지 (첫 페이지 앞에서 이전으로 스와이프 시)
        if (hasPrev && pageIndex == 0) {
          return _buildPrevChapterTransitionPage(theme);
        }

        // 2. 다음 화 스와이프 전환 페이지 (마지막 페이지 뒤로 스와이프 시)
        if (pageIndex >= prevOffset + contentPages) {
          return _buildNextChapterTransitionPage(theme);
        }

        // 3. 본문 페이지 렌더링
        final contentPageIndex = pageIndex - prevOffset;
        final start = contentPageIndex * perPage;
        final end = (start + perPage).clamp(0, _sentences.length);
        final pageSentences = _sentences.sublist(start, end);

        return SafeArea(
          child: Padding(
            padding: EdgeInsets.fromLTRB(
              PreferencesService.horizontalPadding,
              16,
              PreferencesService.horizontalPadding,
              12,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // 상단 챕터 제목 (첫 페이지에만 표시)
                if (contentPageIndex == 0)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 12),
                    child: Text(
                      _chapters[_currentChapterIndex].title,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        color: theme.accentColor,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),

                // 본문 리스트: 화면을 넘치더라도 잘리지 않도록 BouncingScrollPhysics 적용 & 하단 여백 확보
                Expanded(
                  child: SingleChildScrollView(
                    physics: const BouncingScrollPhysics(),
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 24),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: pageSentences.map((s) => _buildSentenceItem(s, theme)).toList(),
                      ),
                    ),
                  ),
                ),

                // 하단 쪽수 인디케이터 (하단 영역에 걸리지 않도록 안전 여백 확보)
                Container(
                  padding: const EdgeInsets.only(top: 8, bottom: 8),
                  alignment: Alignment.center,
                  child: Text(
                    '${contentPageIndex + 1} / $contentPages',
                    style: TextStyle(
                      color: theme.subTextColor.withOpacity(0.6),
                      fontSize: 11,
                      letterSpacing: 0.5,
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  // 페이징 모드에서 첫 페이지 이전으로 스와이프 시 나타나는 '이전 화 전환' 안내 페이지
  Widget _buildPrevChapterTransitionPage(ReaderThemeData theme) {
    final prevChapter = _chapters[_currentChapterIndex - 1];

    return SafeArea(
      child: Center(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 28),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
          decoration: BoxDecoration(
            color: theme.surfaceColor,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: theme.borderColor),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.06),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.arrow_back_rounded, color: theme.accentColor, size: 36),
              const SizedBox(height: 14),
              Text(
                '이전 화로 넘어갑니다...',
                style: TextStyle(color: theme.textColor, fontSize: 16, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                prevChapter.title,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: theme.subTextColor, fontSize: 13),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: theme.accentColor,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // 페이징 모드에서 마지막 페이지 다음으로 스와이프 시 나타나는 '다음 화 전환' 안내 페이지
  Widget _buildNextChapterTransitionPage(ReaderThemeData theme) {
    final nextChapter = _chapters[_currentChapterIndex + 1];

    return SafeArea(
      child: Center(
        child: Container(
          margin: const EdgeInsets.symmetric(horizontal: 28),
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 32),
          decoration: BoxDecoration(
            color: theme.surfaceColor,
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: theme.borderColor),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.06),
                blurRadius: 10,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.arrow_forward_rounded, color: theme.accentColor, size: 36),
              const SizedBox(height: 14),
              Text(
                '다음 화로 넘어갑니다...',
                style: TextStyle(color: theme.textColor, fontSize: 16, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 8),
              Text(
                nextChapter.title,
                textAlign: TextAlign.center,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: theme.subTextColor, fontSize: 13),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                  strokeWidth: 2.5,
                  color: theme.accentColor,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  // 연속 스크롤 뷰 (하단 여백 충분히 확보 & 챕터 끝 네비게이션 제공 & 오버스크롤 이전/다음화 이동)
  Widget _buildScrollView(ReaderThemeData theme) {
    final hasNextChapter = _currentChapterIndex < _chapters.length - 1;
    final hasPrevChapter = _currentChapterIndex > 0;

    return NotificationListener<ScrollNotification>(
      onNotification: (notification) {
        if (notification is OverscrollNotification) {
          // 스크롤 맨 위에서 아래로 당겼을 때 이전 화로 이동
          if (notification.overscroll < -35 && hasPrevChapter && !_isTransitioningChapter) {
            _loadChapter(_currentChapterIndex - 1, loadLastPage: true);
          }
          // 스크롤 맨 끝에서 아래로 당겼을 때 다음 화로 이동
          else if (notification.overscroll > 35 && hasNextChapter && !_isTransitioningChapter) {
            _loadChapter(_currentChapterIndex + 1);
          }
        }
        return false;
      },
      child: SafeArea(
        child: ListView.builder(
          controller: _scrollController,
          padding: EdgeInsets.fromLTRB(
            PreferencesService.horizontalPadding,
            20,
            PreferencesService.horizontalPadding,
            30,
          ),
          itemCount: _sentences.length + 1,
          itemBuilder: (context, index) {
            if (index == _sentences.length) {
              return _buildScrollChapterFooter(theme);
            }
            return _buildSentenceItem(_sentences[index], theme);
          },
        ),
      ),
    );
  }

  // 스크롤 뷰 하단 네비게이션 및 여백 푸터
  Widget _buildScrollChapterFooter(ReaderThemeData theme) {
    final hasNextChapter = _currentChapterIndex < _chapters.length - 1;
    final hasPrevChapter = _currentChapterIndex > 0;

    return Container(
      margin: const EdgeInsets.only(top: 40),
      child: Column(
        children: [
          Divider(color: theme.borderColor.withOpacity(0.6)),
          const SizedBox(height: 20),
          Text(
            '제 ${_currentChapterIndex + 1}화 완독 🎉',
            style: TextStyle(color: theme.textColor, fontSize: 15, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 6),
          Text(
            _chapters[_currentChapterIndex].title,
            textAlign: TextAlign.center,
            style: TextStyle(color: theme.subTextColor, fontSize: 12),
          ),
          const SizedBox(height: 20),

          // 다음 화 / 이전 화 이동 버튼
          if (hasNextChapter) ...[
            SizedBox(
              width: double.infinity,
              height: 48,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: theme.accentColor,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                icon: const Icon(Icons.arrow_forward_rounded, size: 18),
                label: Text(
                  '다음 화 이어보기: 제 ${_currentChapterIndex + 2}화',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
                ),
                onPressed: () => _loadChapter(_currentChapterIndex + 1),
              ),
            ),
            const SizedBox(height: 12),
          ],

          Row(
            children: [
              if (hasPrevChapter)
                Expanded(
                  child: OutlinedButton.icon(
                    style: OutlinedButton.styleFrom(
                      foregroundColor: theme.textColor,
                      side: BorderSide(color: theme.borderColor),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                    ),
                    icon: const Icon(Icons.arrow_back_rounded, size: 16),
                    label: const Text('이전 화', style: TextStyle(fontSize: 13)),
                    onPressed: () => _loadChapter(_currentChapterIndex - 1),
                  ),
                ),
              if (hasPrevChapter) const SizedBox(width: 10),
              Expanded(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: theme.textColor,
                    side: BorderSide(color: theme.borderColor),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                  ),
                  icon: const Icon(Icons.list_rounded, size: 16),
                  label: const Text('목차', style: TextStyle(fontSize: 13)),
                  onPressed: () => _scaffoldKey.currentState?.openDrawer(),
                ),
              ),
            ],
          ),

          // 텍스트가 하단 영역에 걸리지 않도록 넉넉한 여백 제공
          const SizedBox(height: 90),
        ],
      ),
    );
  }

  // 문장 렌더러 (독립 한/일 폰트 적용 & 하이라이트(수정 대기) 시각화 & 롱프레스 액션 시트 & 원문 대역 지원)
  Widget _buildSentenceItem(Sentence sentence, ReaderThemeData theme) {
    final originalMode = PreferencesService.originalTextMode;
    final isOriginalExpanded = sentence.pid != null && _expandedOriginalPids.contains(sentence.pid);
    final showOriginal = (originalMode == 'bilingual') || isOriginalExpanded;
    final isHl = sentence.isHighlighted;

    return Padding(
      padding: EdgeInsets.only(bottom: PreferencesService.paragraphSpacing),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapUp: (details) => _handleScreenTap(details.globalPosition),
        onLongPress: () => _onSentenceLongPressed(sentence),
        child: Container(
          decoration: isHl
              ? BoxDecoration(
                  color: Colors.amber.withOpacity(theme.isDark ? 0.16 : 0.22),
                  borderRadius: BorderRadius.circular(8),
                  border: Border(
                    left: BorderSide(
                      color: Colors.amber.shade600,
                      width: 3.5,
                    ),
                  ),
                )
              : null,
          padding: isHl
              ? const EdgeInsets.fromLTRB(10, 6, 8, 6)
              : const EdgeInsets.symmetric(vertical: 2),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 하이라이트(수정 대기) 배지
              if (isHl)
                Padding(
                  padding: const EdgeInsets.only(bottom: 3),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(Icons.edit_note_rounded, size: 14, color: Colors.amber.shade700),
                      const SizedBox(width: 4),
                      Text(
                        '수정 대기 마킹됨',
                        style: TextStyle(
                          color: Colors.amber.shade700,
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                          letterSpacing: 0.2,
                        ),
                      ),
                    ],
                  ),
                ),
              // 한국어 번역문 (루비/방점 자동 전환 및 선택한 한국어 폰트 적용)
              NovelRubyText(
                text: sentence.translated,
                style: FontHelper.getKoreanStyle(
                  baseStyle: TextStyle(
                    color: theme.textColor,
                    fontSize: PreferencesService.fontSize,
                    height: PreferencesService.lineHeight,
                    letterSpacing: -0.2,
                  ),
                  fontName: PreferencesService.koreanFont,
                ),
              ),
              // 원문 대역 표시 (선택한 일본어 폰트 적용 & 길게 누르면 다시 원문 닫힘)
              if (showOriginal && sentence.original.isNotEmpty) ...[
                const SizedBox(height: 6),
                GestureDetector(
                  behavior: HitTestBehavior.opaque,
                  onTap: () {}, // 배경 탭 흡수로 상하단 바 불필요한 토글 방지
                  onLongPress: () {
                    HapticFeedback.lightImpact();
                    setState(() {
                      if (sentence.pid != null) {
                        _expandedOriginalPids.remove(sentence.pid);
                      }
                    });
                  },
                  child: Container(
                    padding: const EdgeInsets.fromLTRB(10, 8, 10, 8),
                    decoration: BoxDecoration(
                      color: theme.isDark
                          ? Colors.white.withOpacity(0.04)
                          : Colors.black.withOpacity(0.03),
                      borderRadius: BorderRadius.circular(6),
                      border: Border(
                        left: BorderSide(
                          color: theme.accentColor.withOpacity(0.6),
                          width: 2.5,
                        ),
                      ),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Text(
                              '日本語 原文',
                              style: TextStyle(
                                color: theme.accentColor,
                                fontSize: 10,
                                fontWeight: FontWeight.bold,
                                letterSpacing: 0.5,
                              ),
                            ),
                            const Spacer(),
                            // 원터치 하이라이트 콕 찍기 버튼
                            InkWell(
                              onTap: () => _toggleHighlight(sentence),
                              borderRadius: BorderRadius.circular(4),
                              child: Container(
                                padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                                decoration: BoxDecoration(
                                  color: isHl ? Colors.amber.shade700 : theme.subTextColor.withOpacity(0.12),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(
                                      isHl ? Icons.bookmark_added_rounded : Icons.bookmark_add_outlined,
                                      size: 11,
                                      color: isHl ? Colors.white : theme.subTextColor,
                                    ),
                                    const SizedBox(width: 3),
                                    Text(
                                      isHl ? '마킹됨' : '마킹',
                                      style: TextStyle(
                                        color: isHl ? Colors.white : theme.subTextColor,
                                        fontSize: 10,
                                        fontWeight: isHl ? FontWeight.bold : FontWeight.normal,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                            const SizedBox(width: 6),
                            // 상세 액션 시트 (키보드 수정, 복사 등)
                            InkWell(
                              onTap: () => _showSentenceActionSheet(sentence),
                              borderRadius: BorderRadius.circular(4),
                              child: Padding(
                                padding: const EdgeInsets.all(2),
                                child: Icon(
                                  Icons.more_horiz_rounded,
                                  size: 16,
                                  color: theme.subTextColor,
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 4),
                        Text(
                          sentence.original,
                          style: FontHelper.getJapaneseStyle(
                            baseStyle: TextStyle(
                              color: theme.originalTextColor,
                              fontSize: PreferencesService.fontSize * 0.88,
                              height: 1.45,
                            ),
                            fontName: PreferencesService.japaneseFont,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
