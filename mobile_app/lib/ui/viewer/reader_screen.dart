import 'dart:async';
import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../../models/chapter.dart';
import '../../models/sentence.dart';
import '../../services/local_db_service.dart';
import '../../services/preferences_service.dart';
import '../themes/reader_themes.dart';
import 'quick_edit_dialog.dart';
import 'reader_settings_sheet.dart';
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

  // 페이징 컨트롤러
  final PageController _pageController = PageController();
  final ScrollController _scrollController = ScrollController();
  int _currentPage = 0;

  // 독서 시간 기록용 타이머
  Timer? _readingTimer;
  int _sessionSeconds = 0;
  Timer? _saveProgressTimer;

  @override
  void initState() {
    super.initState();
    _initReader();
    _startReadingTracker();
    if (PreferencesService.keepScreenOn) {
      WakelockPlus.enable();
    }

    _scrollController.addListener(() {
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

  void _onPageChanged(int page) {
    setState(() => _currentPage = page);
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
    const sentencesPerPage = 8;
    String? pid;

    final isPaging = PreferencesService.viewMode == 'paging';
    if (isPaging) {
      final startIdx = _currentPage * sentencesPerPage;
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
      isCompleted: (_currentChapterIndex == _chapters.length - 1 && _currentPage >= (_sentences.length / sentencesPerPage).ceil() - 1),
    );
  }

  void _startReadingTracker() {
    _readingTimer = Timer.periodic(const Duration(seconds: 15), (timer) {
      _sessionSeconds += 15;
      _flushReadingLog();
    });
  }

  void _flushReadingLog() {
    if (_sessionSeconds >= 15 && _chapters.isNotEmpty) {
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

  Future<void> _loadChapter(int index, {String? targetPid}) async {
    if (index < 0 || index >= _chapters.length) return;

    setState(() {
      _isLoading = true;
      _currentChapterIndex = index;
    });

    final targetChapter = _chapters[index];
    // 챕터 압축 해제 로드 (1ms)
    final sentences = await LocalDbService.loadChapterSentences(targetChapter.id!);

    const sentencesPerPage = 8;
    int targetPage = 0;
    if (targetPid != null && sentences.isNotEmpty) {
      final sIdx = sentences.indexWhere((s) => s.pid == targetPid);
      if (sIdx != -1) {
        targetPage = (sIdx / sentencesPerPage).floor();
      }
    }

    setState(() {
      _sentences = sentences;
      _isLoading = false;
      _currentPage = targetPage;
    });

    // 독서 진도 저장
    final currentFirstPid = sentences.isNotEmpty
        ? ((targetPage * sentencesPerPage < sentences.length)
            ? sentences[targetPage * sentencesPerPage].pid
            : sentences.first.pid)
        : null;

    await LocalDbService.updateReadingProgress(
      bookName: widget.bookName,
      chapterTitle: targetChapter.title,
      pid: currentFirstPid,
      isCompleted: (index == _chapters.length - 1),
    );

    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_pageController.hasClients) {
        _pageController.jumpToPage(targetPage);
      }
      if (_scrollController.hasClients && targetPid != null && sentences.isNotEmpty) {
        final sIdx = sentences.indexWhere((s) => s.pid == targetPid);
        if (sIdx != -1 && _scrollController.position.maxScrollExtent > 0) {
          final ratio = sIdx / (sentences.length - 1);
          final offset = (ratio * _scrollController.position.maxScrollExtent).clamp(0.0, _scrollController.position.maxScrollExtent);
          _scrollController.jumpTo(offset);
        }
      }
    });
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
          // 1. 뷰어 본문 인터랙션 영역
          GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTapUp: (details) {
              final screenWidth = MediaQuery.of(context).size.width;
              final tapX = details.globalPosition.dx;

              if (isPaging) {
                // 3분할 탭 네비게이션: 좌 25%(이전), 우 25%(다음), 중앙 50%(컨트롤 토글)
                if (tapX < screenWidth * 0.25) {
                  _pageController.previousPage(
                    duration: const Duration(milliseconds: 250),
                    curve: Curves.easeInOut,
                  );
                } else if (tapX > screenWidth * 0.75) {
                  _pageController.nextPage(
                    duration: const Duration(milliseconds: 250),
                    curve: Curves.easeInOut,
                  );
                } else {
                  setState(() => _showControls = !_showControls);
                }
              } else {
                setState(() => _showControls = !_showControls);
              }
            },
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

          // 3. 하단 네비게이션 & 챕터 슬라이더 컨트롤 바
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

  // 하단 슬라이더 바
  Widget _buildBottomBar(ReaderThemeData theme) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        border: Border(top: BorderSide(color: theme.borderColor)),
        boxShadow: [
          BoxShadow(color: Colors.black.withOpacity(0.08), blurRadius: 4, offset: const Offset(0, -2)),
        ],
      ),
      child: SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Row(
              children: [
                // 이전 챕터 버튼
                IconButton(
                  icon: Icon(Icons.skip_previous_rounded, color: _currentChapterIndex > 0 ? theme.textColor : theme.borderColor),
                  onPressed: _currentChapterIndex > 0 ? () => _loadChapter(_currentChapterIndex - 1) : null,
                ),
                // 챕터 슬라이더
                Expanded(
                  child: Slider(
                    value: _currentChapterIndex.toDouble(),
                    min: 0,
                    max: (_chapters.length - 1).toDouble(),
                    divisions: _chapters.length > 1 ? _chapters.length - 1 : 1,
                    activeColor: theme.accentColor,
                    inactiveColor: theme.borderColor,
                    onChanged: (val) {
                      _loadChapter(val.toInt());
                    },
                  ),
                ),
                // 다음 챕터 버튼
                IconButton(
                  icon: Icon(Icons.skip_next_rounded, color: _currentChapterIndex < _chapters.length - 1 ? theme.textColor : theme.borderColor),
                  onPressed: _currentChapterIndex < _chapters.length - 1 ? () => _loadChapter(_currentChapterIndex + 1) : null,
                ),
              ],
            ),
            Text(
              '${_currentChapterIndex + 1} / ${_chapters.length} 챕터 (${((_currentChapterIndex + 1) / _chapters.length * 100).toStringAsFixed(1)}%) • ${_currentPage + 1}p',
              style: TextStyle(color: theme.subTextColor, fontSize: 11),
            ),
          ],
        ),
      ),
    );
  }

  // 페이징 뷰 (문단 단위 슬라이스 렌더링)
  Widget _buildPagingView(ReaderThemeData theme) {
    // 1페이지당 적정 문장 수(약 8~12문장씩) 분할 페이징
    const sentencesPerPage = 8;
    final pageCount = (_sentences.length / sentencesPerPage).ceil().clamp(1, 9999);

    return PageView.builder(
      controller: _pageController,
      itemCount: pageCount,
      onPageChanged: _onPageChanged,
      itemBuilder: (context, pageIndex) {
        final start = pageIndex * sentencesPerPage;
        final end = (start + sentencesPerPage).clamp(0, _sentences.length);
        final pageSentences = _sentences.sublist(start, end);

        return SafeArea(
          child: Padding(
            padding: EdgeInsets.symmetric(
              horizontal: PreferencesService.horizontalPadding,
              vertical: 24,
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: ListView(
                    physics: const NeverScrollableScrollPhysics(),
                    children: pageSentences.map((s) => _buildSentenceItem(s, theme)).toList(),
                  ),
                ),
                // 하단 쪽수 인디케이터
                Center(
                  child: Text(
                    '${pageIndex + 1} / $pageCount',
                    style: TextStyle(color: theme.subTextColor.withOpacity(0.6), fontSize: 11),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }

  // 연속 스크롤 뷰
  Widget _buildScrollView(ReaderThemeData theme) {
    return SafeArea(
      child: ListView.builder(
        controller: _scrollController,
        padding: EdgeInsets.symmetric(
          horizontal: PreferencesService.horizontalPadding,
          vertical: 24,
        ),
        itemCount: _sentences.length,
        itemBuilder: (context, index) {
          return _buildSentenceItem(_sentences[index], theme);
        },
      ),
    );
  }

  // 문장 렌더러 (독립 한/일 폰트 적용 & 롱프레스 오역 수정 & 원문 대역 지원)
  Widget _buildSentenceItem(Sentence sentence, ReaderThemeData theme) {
    final showOriginal = PreferencesService.originalTextMode == 'bilingual';

    return Padding(
      padding: EdgeInsets.only(bottom: PreferencesService.paragraphSpacing),
      child: InkWell(
        onLongPress: () => _onSentenceLongPressed(sentence),
        borderRadius: BorderRadius.circular(6),
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // 한국어 번역문 (선택한 한국어 폰트 적용)
              Text(
                sentence.translated,
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
