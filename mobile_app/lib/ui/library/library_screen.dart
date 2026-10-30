import 'dart:async';
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../models/book.dart';
import '../../services/local_db_service.dart';
import '../../services/preferences_service.dart';
import '../../services/sync_service.dart';
import '../themes/reader_themes.dart';
import '../themes/hyper_aesthetic_theme.dart';
import '../viewer/reader_screen.dart';
import '../glossary/glossary_screen.dart';
import '../glossary/character_fixer_screen.dart';
import '../ai_review/ai_review_screen.dart';
import '../settings/settings_screen.dart';
import '../../services/app_update_service.dart';
import '../../services/notification_service.dart';
import '../../services/status_dashboard_service.dart';
import 'notification_center_sheet.dart';
import '../remote/remote_control_screen.dart';

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({super.key});

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  int _currentNavIndex = 0;
  List<Book> _books = [];
  Book? _recentBook;
  bool _isLoading = true;

  String _filter = 'all'; // all, pinned, reading, unread, completed, hidden
  String _sort = 'recent';
  String _searchQuery = '';
  bool _isGridView = true;

  bool _isTrustedWifi = false;
  bool _isServerOnline = false;
  bool _isSyncing = false;

  final TextEditingController _searchController = TextEditingController();
  Timer? _searchDebounce;

  @override
  void initState() {
    super.initState();
    _isGridView = (PreferencesService.libraryViewMode == 'grid');
    _loadLibrary();
    _checkNetworkAndServer();
    NotificationService.fetchRecentNotifications();
    StatusDashboardService.enterForeground();
  }

  @override
  void dispose() {
    _searchDebounce?.cancel();
    StatusDashboardService.enterBackground();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _checkNetworkAndServer() async {
    final trusted = await SyncService.isConnectedToTrustedWifi();
    bool serverOnline = false;
    if (trusted) {
      serverOnline = await SyncService.pingServer();
      if (serverOnline && mounted) {
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            AppUpdateService.checkForUpdate(silent: true, context: context);
          }
        });
      }
    }
    if (!mounted) return;
    setState(() {
      _isTrustedWifi = trusted;
      _isServerOnline = serverOnline;
    });
  }

  Future<void> _loadLibrary() async {
    setState(() => _isLoading = true);
    final books = await LocalDbService.getBooks(
      filter: _filter,
      query: _searchQuery,
      sort: _sort,
    );

    Book? recent;
    final allBooks = await LocalDbService.getBooks(sort: 'recent', syncIntegrity: false);
    final readingBooks = allBooks.where((b) => (b.lastReadTimestamp ?? 0) > 0 && !b.isCompleted).toList();
    if (readingBooks.isNotEmpty) {
      recent = readingBooks.first;
    }

    if (!mounted) return;
    setState(() {
      _books = books;
      _recentBook = recent;
      _isLoading = false;
    });
  }

  Future<void> _triggerQuickSync() async {
    if (_isSyncing) return;
    HapticFeedback.mediumImpact();
    setState(() => _isSyncing = true);

    try {
      final res = await SyncService.performIncrementalSync(ignoreWifiCheck: true);
      if (!mounted) return;

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(res.message, style: const TextStyle(fontWeight: FontWeight.bold)),
          backgroundColor: res.success ? const Color(0xFF10B981) : Colors.redAccent,
          behavior: SnackBarBehavior.floating,
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
        ),
      );
      if (res.success) {
        await _loadLibrary();
      }
    } finally {
      if (mounted) {
        setState(() => _isSyncing = false);
      }
    }
  }

  void _openReader(Book book) {
    HapticFeedback.lightImpact();
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ReaderScreen(
          bookName: book.folderName,
          initialChapterTitle: book.lastReadChapterTitle,
        ),
      ),
    ).then((_) => _loadLibrary());
  }

  void _showBookActionSheet(Book book, ReaderThemeData theme) {
    HapticFeedback.heavyImpact();
    showModalBottomSheet(
      context: context,
      backgroundColor: Colors.transparent,
      isScrollControlled: true,
      builder: (ctx) => ClipRRect(
        borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 18, sigmaY: 18),
          child: Container(
          decoration: BoxDecoration(
            color: (theme.isDark ? theme.surfaceColor : Colors.white).withOpacity(0.88),
            borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
            border: Border.all(
              color: theme.isDark ? Colors.white12 : Colors.black12,
              width: 1.2,
            ),
          ),
          padding: const EdgeInsets.fromLTRB(20, 12, 20, 28),
          child: SafeArea(
            top: false,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                // 핸들 바
                Container(
                  width: 44,
                  height: 4.5,
                  margin: const EdgeInsets.only(bottom: 16),
                  decoration: BoxDecoration(
                    color: theme.subTextColor.withOpacity(0.35),
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                Row(
                  children: [
                    Container(
                      width: 44,
                      height: 44,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [
                            HyperAestheticTheme.getAmbientPrimary(theme),
                            HyperAestheticTheme.getAmbientSecondary(theme),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(12),
                        boxShadow: [
                          BoxShadow(
                            color: HyperAestheticTheme.getAmbientPrimary(theme).withOpacity(0.35),
                            blurRadius: 10,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: const Icon(Icons.menu_book_rounded, color: Colors.white, size: 22),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            book.folderName,
                            style: TextStyle(
                              color: theme.textColor,
                              fontSize: 16,
                              fontWeight: FontWeight.bold,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          const SizedBox(height: 2),
                          Text(
                            '총 ${book.totalChapters}화 수록',
                            style: TextStyle(color: theme.subTextColor, fontSize: 12),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Divider(color: theme.borderColor.withOpacity(0.5)),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(9),
                    decoration: BoxDecoration(
                      color: HyperAestheticTheme.getAmbientPrimary(theme).withOpacity(0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(Icons.auto_fix_high_rounded, color: HyperAestheticTheme.getAmbientPrimary(theme), size: 20),
                  ),
                  title: Text(
                    '인명·고유명사 스마트 교정기',
                    style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  subtitle: Text(
                    'PC 서버와 연동하여 오독 검수 및 실시간 Diff 교정',
                    style: TextStyle(color: theme.subTextColor, fontSize: 11),
                  ),
                  onTap: () {
                    Navigator.pop(ctx);
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => CharacterFixerScreen(initialFolderName: book.folderName),
                      ),
                    );
                  },
                ),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(9),
                    decoration: BoxDecoration(
                      color: Colors.amber.withOpacity(0.18),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: const Icon(Icons.swipe_rounded, color: Colors.amber, size: 20),
                  ),
                  title: Text(
                    'AI 번역 검수 스튜디오',
                    style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  subtitle: Text(
                    '이상 번역 슬라이드 승인/거절 & 2차 재재번역',
                    style: TextStyle(color: theme.subTextColor, fontSize: 11),
                  ),
                  onTap: () {
                    Navigator.pop(ctx);
                    Navigator.push(
                      context,
                      MaterialPageRoute(
                        builder: (_) => const AiReviewScreen(),
                      ),
                    );
                  },
                ),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(9),
                    decoration: BoxDecoration(
                      color: (book.isPinned ? Colors.amber : theme.subTextColor).withOpacity(0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      book.isPinned ? Icons.star_rounded : Icons.star_border_rounded,
                      color: book.isPinned ? Colors.amber : theme.subTextColor,
                      size: 20,
                    ),
                  ),
                  title: Text(
                    book.isPinned ? '상단 고정 해제' : '상단 고정 등록',
                    style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  onTap: () async {
                    Navigator.pop(ctx);
                    await LocalDbService.togglePinBook(book.folderName, book.isPinned);
                    _loadLibrary();
                  },
                ),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(9),
                    decoration: BoxDecoration(
                      color: (book.isCompleted ? Colors.green : theme.subTextColor).withOpacity(0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      book.isCompleted ? Icons.check_circle_rounded : Icons.check_circle_outline_rounded,
                      color: book.isCompleted ? Colors.green : theme.subTextColor,
                      size: 20,
                    ),
                  ),
                  title: Text(
                    book.isCompleted ? '완독 취소 (읽는 중으로 변경)' : '완독 처리',
                    style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  onTap: () async {
                    Navigator.pop(ctx);
                    await LocalDbService.toggleCompleteBook(book.folderName, book.isCompleted);
                    _loadLibrary();
                  },
                ),
                ListTile(
                  leading: Container(
                    padding: const EdgeInsets.all(9),
                    decoration: BoxDecoration(
                      color: (book.isVisible ? theme.subTextColor : Colors.purpleAccent).withOpacity(0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Icon(
                      book.isVisible ? Icons.archive_outlined : Icons.unarchive_outlined,
                      color: book.isVisible ? theme.subTextColor : Colors.purpleAccent,
                      size: 20,
                    ),
                  ),
                  title: Text(
                    book.isVisible ? '보관함으로 숨기기' : '서재로 다시 복원',
                    style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14),
                  ),
                  onTap: () async {
                    Navigator.pop(ctx);
                    await LocalDbService.toggleVisibilityBook(book.folderName, book.isVisible);
                    _loadLibrary();
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    ),
  );
}

  @override
  Widget build(BuildContext context) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);

    final pages = [
      _buildLibraryView(theme),
      const GlossaryScreen(),
      SettingsScreen(onThemeChanged: () => setState(() {})),
    ];

    return Scaffold(
      backgroundColor: theme.background,
      extendBody: true, // 하단 플로팅 글래스 독을 위해 본문 확장
      body: HyperAmbientMeshBackground(
        theme: theme,
        child: pages[_currentNavIndex],
      ),
      bottomNavigationBar: _buildFloatingGlassNavDock(theme),
    );
  }

  /// ============================================================================
  /// 정제된 하단 플로팅 네비게이션 독 (Refined Floating Navigation Dock)
  /// ============================================================================
  Widget _buildFloatingGlassNavDock(ReaderThemeData theme) {
    final items = [
      {'icon': Icons.menu_book_rounded, 'label': '서재'},
      {'icon': Icons.find_replace_rounded, 'label': '찾아바꾸기'},
      {'icon': Icons.settings_rounded, 'label': '설정'},
    ];

    final primary = HyperAestheticTheme.getAmbientPrimary(theme);

    return SafeArea(
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
        height: 64,
        decoration: HyperAestheticTheme.glassBox(
          theme: theme,
          borderRadius: 32,
          opacity: 0.88,
          borderWidth: 1.0,
          glow: true,
          glowColor: primary.withOpacity(0.12),
        ),
        child: ClipRRect(
          borderRadius: BorderRadius.circular(32),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 16, sigmaY: 16),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceEvenly,
              children: List.generate(items.length, (idx) {
                final isSelected = (_currentNavIndex == idx);
                final item = items[idx];

                return InkWell(
                  onTap: () {
                    HapticFeedback.selectionClick();
                    setState(() => _currentNavIndex = idx);
                    if (idx == 0) _loadLibrary();
                  },
                  borderRadius: BorderRadius.circular(24),
                  child: ConstrainedBox(
                    constraints: const BoxConstraints(minWidth: 56, minHeight: 48),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 220),
                      curve: Curves.easeOutCubic,
                      padding: EdgeInsets.symmetric(
                        horizontal: isSelected ? 14 : 10,
                        vertical: 8,
                      ),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? primary.withOpacity(theme.isDark ? 0.22 : 0.12)
                            : Colors.transparent,
                        borderRadius: BorderRadius.circular(20),
                        border: isSelected
                            ? Border.all(color: primary.withOpacity(0.4), width: 1.0)
                            : null,
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(
                            item['icon'] as IconData,
                            size: 20,
                            color: isSelected ? primary : theme.subTextColor,
                          ),
                          if (isSelected) ...[
                            const SizedBox(width: 6),
                            Text(
                              item['label'] as String,
                              style: TextStyle(
                                color: isSelected ? primary : theme.subTextColor,
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                letterSpacing: -0.2,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildLibraryView(ReaderThemeData theme) {
    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        onRefresh: () async {
          await _checkNetworkAndServer();
          await _loadLibrary();
          await NotificationService.fetchRecentNotifications();
        },
        color: HyperAestheticTheme.getAmbientPrimary(theme),
        child: CustomScrollView(
          physics: const BouncingScrollPhysics(),
          slivers: [
            // 1. 하이퍼 에스테틱 플로팅 글래스 헤더
            SliverToBoxAdapter(
              child: _buildHeaderHub(theme),
            ),

            // 2. 검색 & 뷰 모드 독
            SliverToBoxAdapter(
              child: _buildSearchAndModeDock(theme),
            ),

            // 2.5 실시간 번역 진행 배너 (서버 작업 중일 때 동적 활성화)
            SliverToBoxAdapter(
              child: _buildLiveTranslationBanner(theme),
            ),

            // 3. Hero 앰비언트 쇼케이스 카드 (최근 읽던 소설)
            if (_recentBook != null && _searchQuery.isEmpty && _filter == 'all')
              SliverToBoxAdapter(
                child: _buildHeroContinueCard(theme, _recentBook!),
              ),

            // 4. 네온 글래스 필터 캡슐 바
            SliverToBoxAdapter(
              child: _buildFilterChips(theme),
            ),

            // 5. 책 목록 (그리드 vs 리스트)
            if (_isLoading)
              SliverFillRemaining(
                child: Center(
                  child: CircularProgressIndicator(
                    color: HyperAestheticTheme.getAmbientPrimary(theme),
                  ),
                ),
              )
            else if (_books.isEmpty)
              SliverFillRemaining(
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.auto_stories_outlined,
                        size: 56,
                        color: theme.subTextColor.withOpacity(0.4),
                      ),
                      const SizedBox(height: 14),
                      Text(
                        '표시할 소설이 없습니다.',
                        style: TextStyle(
                          color: theme.subTextColor,
                          fontSize: 15,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      const SizedBox(height: 18),
                      HyperHapticPill(
                        theme: theme,
                        icon: const Icon(Icons.sync_rounded, color: Colors.white, size: 16),
                        label: '서버와 즉시 동기화',
                        isPrimary: true,
                        onTap: _triggerQuickSync,
                      ),
                    ],
                  ),
                ),
              )
            else if (_isGridView)
              _buildGridSliver(theme)
            else
              _buildListSliver(theme),

            // 플로팅 독 여백 확보
            const SliverPadding(
              padding: EdgeInsets.only(bottom: 100),
            ),
          ],
        ),
      ),
    );
  }

  /// ============================================================================
  /// 상단 헤더 허브 (Header Hub)
  /// ============================================================================
  Widget _buildHeaderHub(ReaderThemeData theme) {
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);
    final secondary = HyperAestheticTheme.getAmbientSecondary(theme);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              // 정제된 엠블럼 아이콘
              Container(
                width: 38,
                height: 38,
                decoration: BoxDecoration(
                  gradient: LinearGradient(colors: [primary, secondary]),
                  borderRadius: BorderRadius.circular(12),
                  boxShadow: [
                    BoxShadow(
                      color: primary.withOpacity(0.25),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: const Icon(Icons.local_library_rounded, color: Colors.white, size: 20),
              ),
              const SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Text(
                        'LANOVEL',
                        style: TextStyle(
                          color: theme.textColor,
                          fontSize: 20,
                          fontWeight: FontWeight.w900,
                          letterSpacing: -0.6,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                        decoration: BoxDecoration(
                          color: primary.withOpacity(0.14),
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: primary.withOpacity(0.3), width: 0.8),
                        ),
                        child: Text(
                          '${_books.length}작품',
                          style: TextStyle(
                            color: primary,
                            fontSize: 10,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ],
                  ),
                  Text(
                    '독립 오프라인 전자책 서재',
                    style: TextStyle(
                      color: theme.subTextColor,
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ],
              ),
            ],
          ),

          // 우측 컨트롤 그룹 (최소 44dp 안심 터치 타깃 보장)
          Row(
            children: [

              IconButton(
                icon: Icon(Icons.settings_remote_rounded, color: primary, size: 21),
                tooltip: '번역 리모컨',
                constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                padding: const EdgeInsets.all(8),
                onPressed: () {
                  HapticFeedback.lightImpact();
                  Navigator.push(context, MaterialPageRoute(builder: (_) => const RemoteControlScreen()));
                },
              ),
              const SizedBox(width: 4),
              _buildNotificationBell(theme),
              const SizedBox(width: 6),
              _buildSyncStatusBadge(theme),
            ],
          ),
        ],
      ),
    );
  }

  /// ============================================================================
  /// 검색창 & 뷰 모드 토글 독 (Search & Mode Dock)
  /// ============================================================================
  Widget _buildSearchAndModeDock(ReaderThemeData theme) {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
      child: Row(
        children: [
          Expanded(
            child: Container(
              height: 44,
              decoration: BoxDecoration(
                color: theme.surfaceColor,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: theme.borderColor.withOpacity(0.85),
                  width: 1.0,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(theme.isDark ? 0.22 : 0.03),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: TextField(
                controller: _searchController,
                style: TextStyle(color: theme.textColor, fontSize: 13, fontWeight: FontWeight.w500),
                decoration: InputDecoration(
                  hintText: '장서 내 제목 또는 작가 검색...',
                  hintStyle: TextStyle(
                    color: theme.subTextColor.withOpacity(0.65),
                    fontSize: 13,
                  ),
                  prefixIcon: Icon(Icons.search_rounded, size: 18, color: theme.subTextColor),
                  prefixIconConstraints: const BoxConstraints(minWidth: 32, minHeight: 32),
                  suffixIcon: _searchQuery.isNotEmpty
                      ? IconButton(
                          icon: const Icon(Icons.clear_rounded, size: 16),
                          constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                          onPressed: () {
                            _searchController.clear();
                            setState(() => _searchQuery = '');
                            _loadLibrary();
                          },
                        )
                      : null,
                  border: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(vertical: 12),
                ),
                onChanged: (val) {
                  setState(() => _searchQuery = val);
                  _searchDebounce?.cancel();
                  _searchDebounce = Timer(const Duration(milliseconds: 250), () {
                    if (mounted) _loadLibrary();
                  });
                },
              ),
            ),
          ),
          const SizedBox(width: 8),
          // 정렬 선택 팝업 버튼 (44dp 안심 터치 타깃)
          Theme(
            data: Theme.of(context).copyWith(cardColor: theme.surfaceColor),
            child: PopupMenuButton<String>(
              tooltip: '정렬 기준',
              initialValue: _sort,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
                side: BorderSide(color: theme.borderColor.withOpacity(0.85)),
              ),
              color: theme.surfaceColor,
              onSelected: (val) {
                HapticFeedback.selectionClick();
                setState(() => _sort = val);
                _loadLibrary();
              },
              child: Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: theme.surfaceColor,
                  borderRadius: BorderRadius.circular(14),
                  border: Border.all(
                    color: theme.borderColor.withOpacity(0.85),
                    width: 1.0,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(theme.isDark ? 0.22 : 0.03),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Icon(
                  Icons.sort_rounded,
                  color: _sort != 'recent' ? HyperAestheticTheme.getAmbientPrimary(theme) : theme.textColor,
                  size: 20,
                ),
              ),
              itemBuilder: (ctx) => [
                PopupMenuItem(
                  value: 'recent',
                  child: Row(
                    children: [
                      Icon(Icons.history_rounded, size: 18, color: _sort == 'recent' ? HyperAestheticTheme.getAmbientPrimary(theme) : theme.subTextColor),
                      const SizedBox(width: 10),
                      Text('최근 읽은 순', style: TextStyle(color: _sort == 'recent' ? HyperAestheticTheme.getAmbientPrimary(theme) : theme.textColor, fontWeight: _sort == 'recent' ? FontWeight.bold : FontWeight.normal, fontSize: 13)),
                    ],
                  ),
                ),
                PopupMenuItem(
                  value: 'name',
                  child: Row(
                    children: [
                      Icon(Icons.sort_by_alpha_rounded, size: 18, color: _sort == 'name' ? HyperAestheticTheme.getAmbientPrimary(theme) : theme.subTextColor),
                      const SizedBox(width: 10),
                      Text('가나다 이름순', style: TextStyle(color: _sort == 'name' ? HyperAestheticTheme.getAmbientPrimary(theme) : theme.textColor, fontWeight: _sort == 'name' ? FontWeight.bold : FontWeight.normal, fontSize: 13)),
                    ],
                  ),
                ),
                PopupMenuItem(
                  value: 'chapters',
                  child: Row(
                    children: [
                      Icon(Icons.format_list_numbered_rounded, size: 18, color: _sort == 'chapters' ? HyperAestheticTheme.getAmbientPrimary(theme) : theme.subTextColor),
                      const SizedBox(width: 10),
                      Text('회차 많은 순', style: TextStyle(color: _sort == 'chapters' ? HyperAestheticTheme.getAmbientPrimary(theme) : theme.textColor, fontWeight: _sort == 'chapters' ? FontWeight.bold : FontWeight.normal, fontSize: 13)),
                    ],
                  ),
                ),
                PopupMenuItem(
                  value: 'pinned',
                  child: Row(
                    children: [
                      Icon(Icons.star_rounded, size: 18, color: _sort == 'pinned' ? Colors.amber : theme.subTextColor),
                      const SizedBox(width: 10),
                      Text('즐겨찾기 우선', style: TextStyle(color: _sort == 'pinned' ? Colors.amber : theme.textColor, fontWeight: _sort == 'pinned' ? FontWeight.bold : FontWeight.normal, fontSize: 13)),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          // 그리드/리스트 토글 버튼 (44dp 안심 터치 타깃)
          InkWell(
            onTap: () async {
              HapticFeedback.selectionClick();
              final next = !_isGridView;
              await PreferencesService.setLibraryViewMode(next ? 'grid' : 'list');
              setState(() => _isGridView = next);
            },
            borderRadius: BorderRadius.circular(14),
            child: Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: theme.surfaceColor,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(
                  color: theme.borderColor.withOpacity(0.85),
                  width: 1.0,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(theme.isDark ? 0.22 : 0.03),
                    blurRadius: 8,
                    offset: const Offset(0, 2),
                  ),
                ],
              ),
              child: Icon(
                _isGridView ? Icons.view_list_rounded : Icons.grid_view_rounded,
                color: theme.textColor,
                size: 20,
              ),
            ),
          ),
        ],
      ),
    );
  }

  /// ============================================================================
  /// Hero 이어보기 쇼케이스 카드 (Hero Showcase Card)
  /// ============================================================================
  Widget _buildHeroContinueCard(ReaderThemeData theme, Book book) {
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);
    final secondary = HyperAestheticTheme.getAmbientSecondary(theme);

    final progress = book.estimatedProgress;

    return Container(
      margin: const EdgeInsets.fromLTRB(20, 10, 20, 14),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: theme.borderColor.withOpacity(0.9),
          width: 1.0,
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(theme.isDark ? 0.25 : 0.04),
            blurRadius: 10,
            offset: const Offset(0, 3),
          ),
        ],
      ),
      child: Material(
        color: Colors.transparent,
        borderRadius: BorderRadius.circular(20),
        child: InkWell(
          onTap: () => _openReader(book),
          borderRadius: BorderRadius.circular(20),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    // 북 자켓 프리뷰 (2:3 비율 미니어처)
                    Container(
                      width: 52,
                      height: 72,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [
                            primary.withOpacity(0.9),
                            secondary.withOpacity(0.9),
                          ],
                        ),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                          color: Colors.white.withOpacity(0.2),
                          width: 1.0,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(theme.isDark ? 0.35 : 0.12),
                            blurRadius: 8,
                            offset: const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: Stack(
                        children: [
                          // 책 등표지(Spine) 제본 라인
                          Positioned(
                            left: 0,
                            top: 0,
                            bottom: 0,
                            width: 5,
                            child: Container(
                              decoration: BoxDecoration(
                                color: Colors.white.withOpacity(0.25),
                                borderRadius: const BorderRadius.horizontal(left: Radius.circular(9)),
                              ),
                            ),
                          ),
                          // 상단 림라이트
                          Positioned(
                            top: 0,
                            left: 0,
                            right: 0,
                            height: 1.5,
                            child: Container(
                              decoration: BoxDecoration(
                                gradient: LinearGradient(
                                  colors: [Colors.white.withOpacity(0.4), Colors.transparent],
                                ),
                              ),
                            ),
                          ),
                          const Center(
                            child: Icon(Icons.auto_stories_rounded, color: Colors.white, size: 24),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                decoration: BoxDecoration(
                                  color: primary.withOpacity(0.14),
                                  borderRadius: BorderRadius.circular(6),
                                  border: Border.all(color: primary.withOpacity(0.3), width: 0.8),
                                ),
                                child: Text(
                                  '계속 읽기',
                                  style: TextStyle(color: primary, fontSize: 10, fontWeight: FontWeight.bold),
                                ),
                              ),
                              const SizedBox(width: 8),
                              Text(
                                '${book.totalChapters}화 수록',
                                style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.w500),
                              ),
                            ],
                          ),
                          const SizedBox(height: 5),
                          Text(
                            book.folderName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: theme.textColor,
                              fontSize: 15,
                              fontWeight: FontWeight.bold,
                              letterSpacing: -0.3,
                            ),
                          ),
                          const SizedBox(height: 3),
                          Text(
                            book.lastReadChapterTitle ?? '첫 회차',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: theme.subTextColor,
                              fontSize: 12,
                              fontWeight: FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(width: 8),
                    // 정제된 프로그레스 링
                    HyperProgressRing(
                      progress: progress,
                      size: 44,
                      theme: theme,
                      centerWidget: Text(
                        '${(progress * 100).toInt()}%',
                        style: TextStyle(
                          color: primary,
                          fontSize: 10,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 12),
                SizedBox(
                  width: double.infinity,
                  child: HyperHapticPill(
                    theme: theme,
                    icon: const Icon(Icons.play_arrow_rounded, color: Colors.white, size: 18),
                    label: '이어서 읽기',
                    isPrimary: true,
                    height: 42,
                    onTap: () => _openReader(book),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  /// ============================================================================
  /// 정제된 필터 캡슐 바 (Filter Chips)
  /// ============================================================================
  Widget _buildFilterChips(ReaderThemeData theme) {
    final filters = [
      {'id': 'all', 'label': '전체'},
      {'id': 'pinned', 'label': '⭐ 즐겨찾기'},
      {'id': 'reading', 'label': '📖 읽는 중'},
      {'id': 'unread', 'label': '미독'},
      {'id': 'completed', 'label': '완독'},
      {'id': 'hidden', 'label': '보관함'},
    ];

    final primary = HyperAestheticTheme.getAmbientPrimary(theme);

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      physics: const BouncingScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      child: Row(
        children: filters.map((f) {
          final isSelected = (_filter == f['id']);
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: InkWell(
              onTap: () {
                HapticFeedback.selectionClick();
                setState(() => _filter = f['id']!);
                _loadLibrary();
              },
              borderRadius: BorderRadius.circular(18),
              child: ConstrainedBox(
                constraints: const BoxConstraints(minHeight: 38),
                child: AnimatedContainer(
                  duration: const Duration(milliseconds: 180),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                  decoration: BoxDecoration(
                    color: isSelected
                        ? primary
                        : theme.surfaceColor,
                    borderRadius: BorderRadius.circular(18),
                    border: Border.all(
                      color: isSelected
                          ? primary
                          : theme.borderColor.withOpacity(0.85),
                      width: 1.0,
                    ),
                    boxShadow: [
                      if (isSelected)
                        BoxShadow(
                          color: primary.withOpacity(0.28),
                          blurRadius: 8,
                          offset: const Offset(0, 2),
                        )
                      else
                        BoxShadow(
                          color: Colors.black.withOpacity(theme.isDark ? 0.2 : 0.02),
                          blurRadius: 4,
                          offset: const Offset(0, 1),
                        ),
                    ],
                  ),
                  child: Text(
                    f['label']!,
                    style: TextStyle(
                      color: isSelected ? Colors.white : theme.textColor,
                      fontSize: 12,
                      fontWeight: isSelected ? FontWeight.bold : FontWeight.w500,
                    ),
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }

  /// ============================================================================
  /// 모던 북 자켓 그리드 슬리버 (Modern Book Jacket Grid)
  /// ============================================================================
  Widget _buildGridSliver(ReaderThemeData theme) {
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);
    final secondary = HyperAestheticTheme.getAmbientSecondary(theme);

    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      sliver: SliverGrid(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          childAspectRatio: 0.68,
          crossAxisSpacing: 14,
          mainAxisSpacing: 14,
        ),
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            final book = _books[index];
            return Container(
              decoration: BoxDecoration(
                color: theme.surfaceColor,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(
                  color: theme.borderColor.withOpacity(0.85),
                  width: 1.0,
                ),
                boxShadow: [
                  BoxShadow(
                    color: Colors.black.withOpacity(theme.isDark ? 0.25 : 0.04),
                    blurRadius: 10,
                    offset: const Offset(0, 3),
                  ),
                ],
              ),
              child: Material(
                color: Colors.transparent,
                borderRadius: BorderRadius.circular(16),
                child: InkWell(
                  onTap: () => _openReader(book),
                  onLongPress: () => _showBookActionSheet(book, theme),
                  borderRadius: BorderRadius.circular(16),
                  child: Padding(
                    padding: const EdgeInsets.all(10),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // 상단 모던 북 자켓 커버 (2:3 비율)
                        Expanded(
                          child: Container(
                            width: double.infinity,
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [
                                  primary.withOpacity(0.85),
                                  secondary.withOpacity(0.85),
                                ],
                              ),
                              borderRadius: BorderRadius.circular(12),
                              border: Border.all(
                                color: Colors.white.withOpacity(0.2),
                                width: 1.0,
                              ),
                              boxShadow: [
                                BoxShadow(
                                  color: Colors.black.withOpacity(theme.isDark ? 0.35 : 0.1),
                                  blurRadius: 8,
                                  offset: const Offset(0, 3),
                                ),
                              ],
                            ),
                            child: Stack(
                              children: [
                                // 왼쪽 등표지(Spine) 제본 라인
                                Positioned(
                                  left: 0,
                                  top: 0,
                                  bottom: 0,
                                  width: 6,
                                  child: Container(
                                    decoration: BoxDecoration(
                                      color: Colors.white.withOpacity(0.25),
                                      borderRadius: const BorderRadius.horizontal(left: Radius.circular(11)),
                                    ),
                                  ),
                                ),
                                // 상단 루미너리 림라이트
                                Positioned(
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  height: 1.5,
                                  child: Container(
                                    decoration: BoxDecoration(
                                      gradient: LinearGradient(
                                        colors: [Colors.white.withOpacity(0.35), Colors.transparent],
                                      ),
                                    ),
                                  ),
                                ),
                                Center(
                                  child: Icon(
                                    Icons.auto_stories_rounded,
                                    size: 34,
                                    color: Colors.white.withOpacity(0.9),
                                  ),
                                ),
                                // 즐겨찾기 별 뱃지 (안전한 터치 타깃)
                                Positioned(
                                  top: 4,
                                  right: 4,
                                  child: InkWell(
                                    onTap: () async {
                                      HapticFeedback.selectionClick();
                                      await LocalDbService.togglePinBook(book.folderName, book.isPinned);
                                      _loadLibrary();
                                    },
                                    borderRadius: BorderRadius.circular(20),
                                    child: Container(
                                      width: 32,
                                      height: 32,
                                      alignment: Alignment.center,
                                      decoration: BoxDecoration(
                                        color: book.isPinned ? Colors.amber : Colors.black26,
                                        shape: BoxShape.circle,
                                      ),
                                      child: Icon(
                                        book.isPinned ? Icons.star_rounded : Icons.star_border_rounded,
                                        size: 16,
                                        color: book.isPinned ? Colors.black87 : Colors.white,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          book.folderName,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: theme.textColor,
                            fontSize: 13,
                            fontWeight: FontWeight.bold,
                            letterSpacing: -0.3,
                          ),
                        ),
                        const SizedBox(height: 3),
                        Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              '총 ${book.totalChapters}화',
                              style: TextStyle(color: theme.subTextColor, fontSize: 11, fontWeight: FontWeight.w500),
                            ),
                            if (book.isCompleted)
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1.5),
                                decoration: BoxDecoration(
                                  color: const Color(0xFF10B981).withOpacity(0.16),
                                  borderRadius: BorderRadius.circular(4),
                                ),
                                child: const Text(
                                  '완결',
                                  style: TextStyle(color: Color(0xFF10B981), fontSize: 9, fontWeight: FontWeight.bold),
                                ),
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            );
          },
          childCount: _books.length,
        ),
      ),
    );
  }

  /// ============================================================================
  /// 리스트형 책 슬리버 (Clean Surface Book List)
  /// ============================================================================
  Widget _buildListSliver(ReaderThemeData theme) {
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);
    final secondary = HyperAestheticTheme.getAmbientSecondary(theme);

    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      sliver: SliverList(
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            final book = _books[index];
            return Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Container(
                decoration: BoxDecoration(
                  color: theme.surfaceColor,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: theme.borderColor.withOpacity(0.85),
                    width: 1.0,
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(theme.isDark ? 0.22 : 0.03),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ],
                ),
                child: Material(
                  color: Colors.transparent,
                  borderRadius: BorderRadius.circular(16),
                  child: InkWell(
                    onTap: () => _openReader(book),
                    onLongPress: () => _showBookActionSheet(book, theme),
                    borderRadius: BorderRadius.circular(16),
                    child: Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      child: Row(
                        children: [
                          Container(
                            width: 44,
                            height: 56,
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                                colors: [primary.withOpacity(0.85), secondary.withOpacity(0.85)],
                              ),
                              borderRadius: BorderRadius.circular(8),
                              border: Border.all(color: Colors.white.withOpacity(0.2), width: 1.0),
                            ),
                            child: Stack(
                              children: [
                                Positioned(
                                  left: 0,
                                  top: 0,
                                  bottom: 0,
                                  width: 4,
                                  child: Container(
                                    decoration: BoxDecoration(
                                      color: Colors.white.withOpacity(0.25),
                                      borderRadius: const BorderRadius.horizontal(left: Radius.circular(7)),
                                    ),
                                  ),
                                ),
                                const Center(
                                  child: Icon(Icons.book_rounded, color: Colors.white, size: 20),
                                ),
                              ],
                            ),
                          ),
                          const SizedBox(width: 14),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    if (book.isPinned) ...[
                                      const Icon(Icons.star_rounded, color: Colors.amber, size: 16),
                                      const SizedBox(width: 4),
                                    ],
                                    Expanded(
                                      child: Text(
                                        book.folderName,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: TextStyle(
                                          color: theme.textColor,
                                          fontWeight: FontWeight.bold,
                                          fontSize: 14,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                                const SizedBox(height: 3),
                                Text(
                                  book.lastReadChapterTitle != null
                                      ? '읽던 곳: ${book.lastReadChapterTitle}'
                                      : '총 ${book.totalChapters}화',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(color: theme.subTextColor, fontSize: 11),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            icon: Icon(
                              book.isPinned ? Icons.star_rounded : Icons.star_border_rounded,
                              color: book.isPinned ? Colors.amber : theme.subTextColor,
                            ),
                            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
                            onPressed: () async {
                              HapticFeedback.selectionClick();
                              await LocalDbService.togglePinBook(book.folderName, book.isPinned);
                              _loadLibrary();
                            },
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ),
            );
          },
          childCount: _books.length,
        ),
      ),
    );
  }

  /// ============================================================================
  /// 실시간 번역 배너
  /// ============================================================================
  Widget _buildLiveTranslationBanner(ReaderThemeData theme) {
    return ValueListenableBuilder<DashboardStatusData?>(
      valueListenable: StatusDashboardService.currentStatus,
      builder: (context, status, _) {
        if (status == null || !status.isActive) return const SizedBox.shrink();

        final bookName = status.bookTitle ?? '번역 진행 중';
        final epName = status.currentEpisodeTitle ?? '';
        final progress = (status.percentage / 100.0).clamp(0.0, 1.0);
        final primary = HyperAestheticTheme.getAmbientPrimary(theme);

        return Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: () {
              HapticFeedback.lightImpact();
              Navigator.push(
                context,
                MaterialPageRoute(builder: (_) => const RemoteControlScreen()),
              );
            },
            borderRadius: BorderRadius.circular(16),
            child: HyperGlassCard(
              theme: theme,
              margin: const EdgeInsets.fromLTRB(20, 6, 20, 10),
              borderRadius: 16,
              blur: 0,
              opacity: 1.0,
              glow: false,
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: const BoxDecoration(
                          color: Color(0xFF10B981),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 8),
                      Text(
                        'PC 서버 실시간 번역 중',
                        style: TextStyle(
                          color: primary,
                          fontSize: 12,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(width: 4),
                      Icon(Icons.open_in_new_rounded, size: 13, color: primary),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: const Color(0xFF10B981).withOpacity(0.15),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      'API 쿼터 ${status.percentage.toStringAsFixed(1)}%',
                      style: const TextStyle(
                        color: Color(0xFF10B981),
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Text(
                '$bookName • $epName',
                style: TextStyle(
                  color: theme.textColor,
                  fontSize: 13,
                  fontWeight: FontWeight.bold,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 8),
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: LinearProgressIndicator(
                  value: progress,
                  minHeight: 4,
                  backgroundColor: theme.borderColor.withOpacity(0.4),
                  valueColor: AlwaysStoppedAnimation<Color>(primary),
                ),
              ),
              const SizedBox(height: 6),
              Text(
                status.statusText,
                style: TextStyle(color: theme.subTextColor, fontSize: 11),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ),
    );
  },
    );
  }

  // 알림 센터 벨 (44dp 안심 터치 타깃)
  Widget _buildNotificationBell(ReaderThemeData theme) {
    return ValueListenableBuilder<int>(
      valueListenable: NotificationService.unreadCount,
      builder: (context, unread, _) {
        return InkWell(
          onTap: () {
            HapticFeedback.lightImpact();
            showModalBottomSheet(
              context: context,
              backgroundColor: Colors.transparent,
              isScrollControlled: true,
              builder: (_) => NotificationCenterSheet(
                theme: theme,
                onNotificationOpened: () => _loadLibrary(),
              ),
            );
          },
          borderRadius: BorderRadius.circular(20),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minWidth: 44, minHeight: 44),
            child: Center(
              child: Stack(
                clipBehavior: Clip.none,
                children: [
                  Icon(
                    unread > 0 ? Icons.notifications_active_rounded : Icons.notifications_none_rounded,
                    color: unread > 0 ? HyperAestheticTheme.getAmbientPrimary(theme) : theme.textColor,
                    size: 21,
                  ),
                  if (unread > 0)
                    Positioned(
                      top: -2,
                      right: -2,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
                        decoration: const BoxDecoration(
                          color: Colors.redAccent,
                          shape: BoxShape.circle,
                        ),
                        constraints: const BoxConstraints(minWidth: 14, minHeight: 14),
                        child: Text(
                          unread > 9 ? '9+' : '$unread',
                          textAlign: TextAlign.center,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          ),
        );
      },
    );
  }

  // 동기화 상태 뱃지
  Widget _buildSyncStatusBadge(ReaderThemeData theme) {
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);

    if (_isSyncing) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: primary.withOpacity(0.18),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 12,
              height: 12,
              child: CircularProgressIndicator(strokeWidth: 2, color: primary),
            ),
            const SizedBox(width: 6),
            Text('동기화 중', style: TextStyle(color: primary, fontSize: 11, fontWeight: FontWeight.bold)),
          ],
        ),
      );
    }

    if (_isTrustedWifi && _isServerOnline) {
      return GestureDetector(
        onTap: _triggerQuickSync,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
          decoration: BoxDecoration(
            color: const Color(0xFF10B981).withOpacity(0.14),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: const Color(0xFF10B981).withOpacity(0.4)),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.sync_rounded, color: Color(0xFF10B981), size: 14),
              SizedBox(width: 4),
              Text(
                '동기화 가능',
                style: TextStyle(color: Color(0xFF10B981), fontSize: 11, fontWeight: FontWeight.bold),
              ),
            ],
          ),
        ),
      );
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: theme.borderColor),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.cloud_off_rounded, color: theme.subTextColor, size: 13),
          const SizedBox(width: 4),
          Text(
            '오프라인',
            style: TextStyle(color: theme.subTextColor, fontSize: 11),
          ),
        ],
      ),
    );
  }
}
