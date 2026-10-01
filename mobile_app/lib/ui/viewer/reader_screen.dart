import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../models/chapter.dart';
import '../../models/sentence.dart';
import '../../services/local_db_service.dart';
import '../../services/preferences_service.dart';
import '../themes/reader_themes.dart';
import 'novel_ruby_text.dart';
import 'quick_edit_dialog.dart';
import 'reader_settings_sheet.dart';
import 'similar_translations_panel.dart';
import 'toc_drawer.dart';
import 'tts_player_panel.dart';

class ReaderScreen extends StatefulWidget {
  final String bookName;
  final String? initialChapterTitle;

  const ReaderScreen({
    super.key,
    required this.bookName,
    this.initialChapterTitle,
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

  @override
  void initState() {
    super.initState();
    _initReader();
    _startReadingTracker();
    if (PreferencesService.keepScreenOn) {
      WakelockPlus.enable();
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
          if (book?.lastReadChapterTitle == widget.initialChapterTitle) {
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
    final sentences = await LocalDbService.loadChapterSentences(targetChapter.id!);

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

  void _onSentenceLongPressed(Sentence sentence) {
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

          // 2. 상단 헤더 컨트롤 바
          if (_showControls)
            Positioned(
              top: 0,
              left: 0,
              right: 0,
              child: _buildTopBar(theme, currentChap),
            ),

          // 3. 하단 네비게이션 & 현재 회차 진행도 컨트롤 바
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

  // 상단 앱바
  Widget _buildTopBar(ReaderThemeData theme, Chapter currentChap) {
    return Container(
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        border: Border(bottom: BorderSide(color: theme.borderColor)),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.08), blurRadius: 4, offset: const Offset(0, 2)),
        ],
      ),
      child: SafeArea(
        bottom: false,
        child: Row(
          children: [
            IconButton(
              icon: Icon(Icons.arrow_back, color: theme.textColor),
              onPressed: () => Navigator.pop(context),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    widget.bookName,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: theme.subTextColor, fontSize: 11),
                  ),
                  Text(
                    currentChap.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(color: theme.textColor, fontSize: 14, fontWeight: FontWeight.bold),
                  ),
                ],
              ),
            ),
            // 목차 버튼
            IconButton(
              icon: Icon(Icons.list_rounded, color: theme.textColor),
              onPressed: () => _scaffoldKey.currentState?.openDrawer(),
            ),
            // 유사 번역 검색 버튼
            IconButton(
              icon: Icon(
                Icons.manage_search_rounded,
                color: _similarSearchKeyword != null ? Colors.amber : theme.textColor,
              ),
              tooltip: '유사 번역 용례 검색',
              onPressed: () => _promptSimilarSearch(theme),
            ),
            // TTS 버튼
            IconButton(
              icon: Icon(Icons.headphones_rounded, color: _showTtsPanel ? theme.accentColor : theme.textColor),
              onPressed: () => setState(() => _showTtsPanel = !_showTtsPanel),
            ),
            // 설정 버튼 (12테마, 한/일 폰트 등)
            IconButton(
              icon: Icon(Icons.text_format_rounded, color: theme.textColor),
              onPressed: () {
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
      ),
    );
  }

  // 하단 슬라이더 바 (현재 보고 있는 회차의 진행도 표기 및 제어)
  Widget _buildBottomBar(ReaderThemeData theme) {
    final isPaging = PreferencesService.viewMode == 'paging';
    final contentPages = _contentPageCount;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        border: Border(top: BorderSide(color: theme.borderColor)),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.12), blurRadius: 6, offset: const Offset(0, -2)),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            // 1. 회차 전환 및 회차 위치 표시줄
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                // 이전 화 버튼
                TextButton.icon(
                  style: TextButton.styleFrom(
                    foregroundColor: _currentChapterIndex > 0 ? theme.textColor : theme.borderColor,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  icon: const Icon(Icons.arrow_back_ios_rounded, size: 13),
                  label: const Text('이전 화', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  onPressed: _currentChapterIndex > 0 ? () => _loadChapter(_currentChapterIndex - 1) : null,
                ),

                // 현재 회차 정보 (탭 시 목차 오픈)
                InkWell(
                  onTap: () => _scaffoldKey.currentState?.openDrawer(),
                  borderRadius: BorderRadius.circular(6),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          '제 ${_currentChapterIndex + 1}화',
                          style: TextStyle(
                            color: theme.accentColor,
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                        Text(
                          ' / ${_chapters.length}화',
                          style: TextStyle(
                            color: theme.subTextColor,
                            fontSize: 12,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(Icons.unfold_more_rounded, size: 14, color: theme.subTextColor),
                      ],
                    ),
                  ),
                ),

                // 다음 화 버튼
                TextButton.icon(
                  style: TextButton.styleFrom(
                    foregroundColor: _currentChapterIndex < _chapters.length - 1 ? theme.accentColor : theme.borderColor,
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    minimumSize: Size.zero,
                    tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  ),
                  icon: const Text('다음 화', style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
                  label: const Icon(Icons.arrow_forward_ios_rounded, size: 13),
                  onPressed: _currentChapterIndex < _chapters.length - 1 ? () => _loadChapter(_currentChapterIndex + 1) : null,
                ),
              ],
            ),

            const SizedBox(height: 2),

            // 2. 현재 회차 진행도 슬라이더 바
            if (isPaging) ...[
              // 페이징 모드: 현재 회차의 페이지 슬라이더
              Row(
                children: [
                  Text(
                    '${_currentPage + 1}p',
                    style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.w500),
                  ),
                  Expanded(
                    child: Slider(
                      value: _currentPage.clamp(0, contentPages - 1).toDouble(),
                      min: 0,
                      max: (contentPages - 1 > 0 ? contentPages - 1 : 1).toDouble(),
                      divisions: contentPages > 1 ? contentPages - 1 : 1,
                      activeColor: theme.accentColor,
                      inactiveColor: theme.borderColor,
                      onChanged: contentPages > 1
                          ? (val) {
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
                    style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.w500),
                  ),
                ],
              ),
              // 진행도 표기
              Text(
                '현재 회차: ${_currentPage + 1} / $contentPages 페이지 (${((_currentPage + 1) / contentPages * 100).toStringAsFixed(1)}%)',
                style: TextStyle(color: theme.subTextColor, fontSize: 11),
              ),
            ] else ...[
              // 스크롤 모드: 현재 회차의 스크롤 퍼센트 슬라이더
              Row(
                children: [
                  Text(
                    '${(_currentScrollProgress * 100).toInt()}%',
                    style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.w500),
                  ),
                  Expanded(
                    child: Slider(
                      value: _currentScrollProgress.clamp(0.0, 1.0),
                      min: 0.0,
                      max: 1.0,
                      activeColor: theme.accentColor,
                      inactiveColor: theme.borderColor,
                      onChanged: (val) {
                        setState(() => _currentScrollProgress = val);
                        if (_scrollController.hasClients && _scrollController.position.maxScrollExtent > 0) {
                          _scrollController.jumpTo(val * _scrollController.position.maxScrollExtent);
                        }
                      },
                    ),
                  ),
                  Text(
                    '100%',
                    style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.w500),
                  ),
                ],
              ),
              // 진행도 표기
              Text(
                '현재 회차 진행도: ${(_currentScrollProgress * 100).toStringAsFixed(1)}%',
                style: TextStyle(color: theme.subTextColor, fontSize: 11),
              ),
            ],
          ],
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

  // 문장 렌더러 (독립 한/일 폰트 적용 & 롱프레스 오역 수정 & 원문 대역 지원 & 탭 시 화면 컨트롤/네비게이션 연동)
  Widget _buildSentenceItem(Sentence sentence, ReaderThemeData theme) {
    final showOriginal = PreferencesService.originalTextMode == 'bilingual';

    return Padding(
      padding: EdgeInsets.only(bottom: PreferencesService.paragraphSpacing),
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onTapUp: (details) => _handleScreenTap(details.globalPosition),
        onLongPress: () => _onSentenceLongPressed(sentence),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 한국어 번역문 (루비/방점 자동 전환 및 선택한 한국어 폰트 적용)
              NovelRubyText(
                text: sentence.translated,
                style: TextStyle(
                  color: theme.textColor,
                  fontSize: PreferencesService.fontSize,
                  fontFamily: PreferencesService.koreanFont,
                  height: PreferencesService.lineHeight,
                  letterSpacing: -0.2,
                ),
              ),
              // 원문 대역 표시 (선택한 일본어 폰트 적용)
              if (showOriginal && sentence.original.isNotEmpty) ...[
                const SizedBox(height: 4),
                Text(
                  sentence.original,
                  style: TextStyle(
                    color: theme.originalTextColor,
                    fontSize: PreferencesService.fontSize * 0.85,
                    fontFamily: PreferencesService.japaneseFont,
                    height: 1.4,
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
