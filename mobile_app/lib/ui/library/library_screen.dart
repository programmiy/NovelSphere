import 'package:flutter/material.dart';
import '../../models/book.dart';
import '../../services/local_db_service.dart';
import '../../services/preferences_service.dart';
import '../../services/sync_service.dart';
import '../themes/reader_themes.dart';
import '../viewer/reader_screen.dart';
import 'reading_stats_sheet.dart';
import '../glossary/glossary_screen.dart';
import '../settings/settings_screen.dart';
import '../../services/app_update_service.dart';
import '../../services/notification_service.dart';
import '../../services/status_dashboard_service.dart';
import 'notification_center_sheet.dart';

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
        // 앱 실행 시 서버에 새 업데이트가 있는지 조용히 확인
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted) {
            AppUpdateService.checkForUpdate(silent: true, context: context);
          }
        });
      }
    }
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

    // 가장 최근 읽은 책 추출
    Book? recent;
    final allBooks = await LocalDbService.getBooks(sort: 'recent');
    final readingBooks = allBooks.where((b) => b.lastReadTimestamp != null && !b.isCompleted).toList();
    if (readingBooks.isNotEmpty) {
      recent = readingBooks.first;
    }

    setState(() {
      _books = books;
      _recentBook = recent;
      _isLoading = false;
    });
  }

  Future<void> _triggerQuickSync() async {
    setState(() => _isSyncing = true);
    final res = await SyncService.performIncrementalSync();
    setState(() => _isSyncing = false);

    if (mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(res.message),
          backgroundColor: res.success ? Colors.green : Colors.redAccent,
        ),
      );
    }
    await _loadLibrary();
    await _checkNetworkAndServer();
  }

  void _openReader(Book book) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => ReaderScreen(bookName: book.folderName),
      ),
    ).then((_) => _loadLibrary());
  }

  @override
  Widget build(BuildContext context) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);

    final pages = [
      _buildLibraryView(theme),
      const GlossaryScreen(),
      _buildReadingStatsView(theme),
      SettingsScreen(onThemeChanged: () => setState(() {})),
    ];

    return Scaffold(
      backgroundColor: theme.background,
      body: pages[_currentNavIndex],
      bottomNavigationBar: NavigationBar(
        backgroundColor: theme.surfaceColor,
        indicatorColor: theme.accentColor.withOpacity(0.18),
        selectedIndex: _currentNavIndex,
        onDestinationSelected: (idx) {
          setState(() => _currentNavIndex = idx);
          if (idx == 0) _loadLibrary();
        },
        destinations: [
          NavigationDestination(
            icon: Icon(Icons.menu_book_outlined, color: theme.textColor),
            selectedIcon: Icon(Icons.menu_book_rounded, color: theme.accentColor),
            label: '서재',
          ),
          NavigationDestination(
            icon: Icon(Icons.find_replace_outlined, color: theme.textColor),
            selectedIcon: Icon(Icons.find_replace_rounded, color: theme.accentColor),
            label: '찾아바꾸기',
          ),
          NavigationDestination(
            icon: Icon(Icons.insights_outlined, color: theme.textColor),
            selectedIcon: Icon(Icons.insights_rounded, color: theme.accentColor),
            label: '독서 잔디',
          ),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined, color: theme.textColor),
            selectedIcon: Icon(Icons.settings_rounded, color: theme.accentColor),
            label: '설정',
          ),
        ],
      ),
    );
  }

  Widget _buildLibraryView(ReaderThemeData theme) {
    return SafeArea(
      child: RefreshIndicator(
        onRefresh: () async {
          await _checkNetworkAndServer();
          await _loadLibrary();
          await NotificationService.fetchRecentNotifications();
        },
        color: theme.accentColor,
        child: CustomScrollView(
          slivers: [
            // 1. 헤더 & 동기화 상태 칩 & 알림 벨
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(20, 16, 20, 12),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Row(
                      children: [
                        Icon(Icons.local_library_rounded, color: theme.accentColor, size: 28),
                        const SizedBox(width: 10),
                        Text(
                          'LANOVEL 서재',
                          style: TextStyle(
                            color: theme.textColor,
                            fontSize: 22,
                            fontWeight: FontWeight.bold,
                            letterSpacing: -0.5,
                          ),
                        ),
                      ],
                    ),
                    // 알림 센터 벨 & 네트워크 상태 뱃지
                    Row(
                      children: [
                        _buildNotificationBell(theme),
                        const SizedBox(width: 8),
                        _buildSyncStatusBadge(theme),
                      ],
                    ),
                  ],
                ),
              ),
            ),

            // 2. 검색 & 뷰 모드 토글
            SliverToBoxAdapter(
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 4),
                child: Row(
                  children: [
                    Expanded(
                      child: Container(
                        height: 42,
                        decoration: BoxDecoration(
                          color: theme.surfaceColor,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: theme.borderColor),
                        ),
                        child: TextField(
                          controller: _searchController,
                          style: TextStyle(color: theme.textColor, fontSize: 13),
                          decoration: InputDecoration(
                            hintText: '서재 내 소설 검색...',
                            hintStyle: TextStyle(color: theme.subTextColor.withOpacity(0.6), fontSize: 13),
                            prefixIcon: Icon(Icons.search, size: 18, color: theme.subTextColor),
                            suffixIcon: _searchQuery.isNotEmpty
                                ? IconButton(
                                    icon: const Icon(Icons.clear, size: 16),
                                    onPressed: () {
                                      _searchController.clear();
                                      setState(() => _searchQuery = '');
                                      _loadLibrary();
                                    },
                                  )
                                : null,
                            border: InputBorder.none,
                            contentPadding: const EdgeInsets.symmetric(vertical: 10),
                          ),
                          onChanged: (val) {
                            setState(() => _searchQuery = val);
                            _loadLibrary();
                          },
                        ),
                      ),
                    ),
                    const SizedBox(width: 8),
                    // 그리드 / 리스트 토글 버튼
                    IconButton(
                      icon: Icon(
                        _isGridView ? Icons.view_list_rounded : Icons.grid_view_rounded,
                        color: theme.textColor,
                      ),
                      onPressed: () async {
                        final next = !_isGridView;
                        await PreferencesService.setLibraryViewMode(next ? 'grid' : 'list');
                        setState(() => _isGridView = next);
                      },
                    ),
                  ],
                ),
              ),
            ),

            // 2.5 실시간 번역 진행 현황 배너 (작업 진행 중일 때만 동적 노출)
            SliverToBoxAdapter(
              child: _buildLiveTranslationBanner(theme),
            ),

            // 3. Hero 이어보기 카드 (최근 읽던 소설)
            if (_recentBook != null && _searchQuery.isEmpty && _filter == 'all')
              SliverToBoxAdapter(
                child: _buildHeroContinueCard(theme, _recentBook!),
              ),

            // 4. 필터 칩 바 (가로 스크롤)
            SliverToBoxAdapter(
              child: _buildFilterChips(theme),
            ),

            // 5. 책 목록 (그리드 vs 리스트)
            if (_isLoading)
              SliverFillRemaining(
                child: Center(child: CircularProgressIndicator(color: theme.accentColor)),
              )
            else if (_books.isEmpty)
              SliverFillRemaining(
                child: Center(
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(Icons.auto_stories_outlined, size: 54, color: theme.subTextColor.withOpacity(0.5)),
                      const SizedBox(height: 12),
                      Text(
                        '표시할 소설이 없습니다.',
                        style: TextStyle(color: theme.subTextColor, fontSize: 15),
                      ),
                      const SizedBox(height: 16),
                      OutlinedButton.icon(
                        style: OutlinedButton.styleFrom(
                          foregroundColor: theme.accentColor,
                          side: BorderSide(color: theme.accentColor),
                        ),
                        onPressed: _triggerQuickSync,
                        icon: const Icon(Icons.sync),
                        label: const Text('PC 서버에서 서재 동기화'),
                      ),
                    ],
                  ),
                ),
              )
            else
              _isGridView ? _buildGridSliver(theme) : _buildListSliver(theme),

            const SliverToBoxAdapter(child: SizedBox(height: 40)),
          ],
        ),
      ),
    );
  }

  // 실시간 번역 진행 현황 배너 (앱 포그라운드 실시간 모니터링)
  Widget _buildLiveTranslationBanner(ReaderThemeData theme) {
    return ValueListenableBuilder<DashboardStatusData?>(
      valueListenable: StatusDashboardService.currentStatus,
      builder: (context, status, _) {
        if (status == null || !status.isActive) {
          return const SizedBox.shrink();
        }

        final bookName = status.bookTitle ?? '진행 중인 소설';
        final epName = status.currentEpisodeTitle ?? '회차 번역 중';
        final progress = (status.percentage / 100.0).clamp(0.0, 1.0);

        return Container(
          margin: const EdgeInsets.fromLTRB(16, 4, 16, 10),
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: theme.surfaceColor,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: theme.accentColor.withOpacity(0.4), width: 1.2),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.04),
                blurRadius: 8,
                offset: const Offset(0, 2),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 9,
                    height: 9,
                    decoration: BoxDecoration(
                      color: Colors.greenAccent.shade700,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: Colors.greenAccent.withOpacity(0.5),
                          blurRadius: 4,
                          spreadRadius: 1,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    'PC 서버 실시간 번역 중',
                    style: TextStyle(
                      color: theme.accentColor,
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const Spacer(),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: theme.accentColor.withOpacity(0.12),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '${status.percentage}%',
                      style: TextStyle(
                        color: theme.accentColor,
                        fontSize: 12,
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
                  minHeight: 6,
                  backgroundColor: theme.borderColor.withOpacity(0.5),
                  valueColor: AlwaysStoppedAnimation<Color>(theme.accentColor),
                ),
              ),
              const SizedBox(height: 8),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Expanded(
                    child: Text(
                      status.statusText,
                      style: TextStyle(color: theme.subTextColor, fontSize: 11),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  if (status.apiErrorsTotal > 0)
                    Text(
                      '⚠️ ${status.apiErrorsSummary}',
                      style: const TextStyle(
                        color: Colors.orange,
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                      ),
                    )
                  else
                    Text(
                      '• Gemini 정상',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11),
                    ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  // 알림 센터 벨 & 읽지 않은 알림 뱃지
  Widget _buildNotificationBell(ReaderThemeData theme) {
    return ValueListenableBuilder<int>(
      valueListenable: NotificationService.unreadCount,
      builder: (context, unread, _) {
        return InkWell(
          onTap: () {
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
          child: Padding(
            padding: const EdgeInsets.all(6),
            child: Stack(
              clipBehavior: Clip.none,
              children: [
                Icon(
                  unread > 0 ? Icons.notifications_active_rounded : Icons.notifications_none_rounded,
                  color: unread > 0 ? theme.accentColor : theme.textColor,
                  size: 24,
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
        );
      },
    );
  }

  // 동기화 상태 뱃지
  Widget _buildSyncStatusBadge(ReaderThemeData theme) {
    if (_isSyncing) {
      return Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
        decoration: BoxDecoration(
          color: theme.accentColor.withOpacity(0.15),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 12,
              height: 12,
              child: CircularProgressIndicator(strokeWidth: 2, color: theme.accentColor),
            ),
            const SizedBox(width: 6),
            Text('동기화 중...', style: TextStyle(color: theme.accentColor, fontSize: 11, fontWeight: FontWeight.bold)),
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
            color: Colors.green.withOpacity(0.12),
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: Colors.green.withOpacity(0.4)),
          ),
          child: const Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.sync_rounded, color: Colors.green, size: 14),
              SizedBox(width: 4),
              Text(
                '동기화 가능',
                style: TextStyle(color: Colors.green, fontSize: 11, fontWeight: FontWeight.bold),
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
          Icon(Icons.cloud_off_rounded, color: theme.subTextColor, size: 14),
          const SizedBox(width: 4),
          Text(
            '오프라인 서재',
            style: TextStyle(color: theme.subTextColor, fontSize: 11),
          ),
        ],
      ),
    );
  }

  // Hero 이어보기 카드
  Widget _buildHeroContinueCard(ReaderThemeData theme, Book book) {
    return Container(
      margin: const EdgeInsets.fromLTRB(20, 10, 20, 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: theme.surfaceColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: theme.borderColor),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        children: [
          Container(
            width: 52,
            height: 68,
            decoration: BoxDecoration(
              color: theme.accentColor.withOpacity(0.15),
              borderRadius: BorderRadius.circular(8),
              border: Border.all(color: theme.accentColor.withOpacity(0.3)),
            ),
            child: Icon(Icons.bookmark_added_rounded, color: theme.accentColor, size: 28),
          ),
          const SizedBox(width: 14),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: theme.accentColor,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: const Text(
                        '이어서 읽기',
                        style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold),
                      ),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      '${book.totalChapters}화 수록',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11),
                    ),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  book.folderName,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: theme.textColor, fontSize: 15, fontWeight: FontWeight.bold),
                ),
                const SizedBox(height: 2),
                Text(
                  book.lastReadChapterTitle ?? '첫 회차',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: theme.subTextColor, fontSize: 12),
                ),
              ],
            ),
          ),
          IconButton(
            icon: Icon(Icons.play_circle_filled_rounded, color: theme.accentColor, size: 36),
            onPressed: () => _openReader(book),
          ),
        ],
      ),
    );
  }

  // 필터 칩 바
  Widget _buildFilterChips(ReaderThemeData theme) {
    final filters = [
      {'id': 'all', 'label': '전체'},
      {'id': 'pinned', 'label': '⭐ 즐겨찾기'},
      {'id': 'reading', 'label': '📖 읽는 중'},
      {'id': 'unread', 'label': '미독'},
      {'id': 'completed', 'label': '완독'},
      {'id': 'hidden', 'label': '보관함'},
    ];

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 6),
      child: Row(
        children: filters.map((f) {
          final isSelected = (_filter == f['id']);
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: FilterChip(
              label: Text(f['label']!),
              selected: isSelected,
              showCheckmark: false,
              selectedColor: theme.accentColor,
              backgroundColor: theme.surfaceColor,
              labelStyle: TextStyle(
                color: isSelected ? Colors.white : theme.textColor,
                fontSize: 12,
                fontWeight: isSelected ? FontWeight.bold : FontWeight.normal,
              ),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(20),
                side: BorderSide(color: isSelected ? theme.accentColor : theme.borderColor),
              ),
              onSelected: (val) {
                setState(() => _filter = f['id']!);
                _loadLibrary();
              },
            ),
          );
        }).toList(),
      ),
    );
  }

  // 그리드형 책 목록
  Widget _buildGridSliver(ReaderThemeData theme) {
    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
      sliver: SliverGrid(
        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: 2,
          childAspectRatio: 0.8,
          crossAxisSpacing: 14,
          mainAxisSpacing: 14,
        ),
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            final book = _books[index];
            return GestureDetector(
              onTap: () => _openReader(book),
              child: Container(
                decoration: BoxDecoration(
                  color: theme.surfaceColor,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: theme.borderColor),
                ),
                padding: const EdgeInsets.all(12),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Container(
                        width: double.infinity,
                        decoration: BoxDecoration(
                          color: theme.background,
                          borderRadius: BorderRadius.circular(8),
                          border: Border.all(color: theme.borderColor),
                        ),
                        child: Center(
                          child: Icon(Icons.book_rounded, size: 40, color: theme.accentColor.withOpacity(0.6)),
                        ),
                      ),
                    ),
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        if (book.isPinned) ...[
                          const Icon(Icons.star_rounded, color: Colors.amber, size: 14),
                          const SizedBox(width: 4),
                        ],
                        Expanded(
                          child: Text(
                            book.folderName,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              color: theme.textColor,
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 4),
                    Text(
                      '총 ${book.totalChapters}화',
                      style: TextStyle(color: theme.subTextColor, fontSize: 11),
                    ),
                  ],
                ),
              ),
            );
          },
          childCount: _books.length,
        ),
      ),
    );
  }

  // 리스트형 책 목록
  Widget _buildListSliver(ReaderThemeData theme) {
    return SliverPadding(
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 8),
      sliver: SliverList(
        delegate: SliverChildBuilderDelegate(
          (context, index) {
            final book = _books[index];
            return Container(
              margin: const EdgeInsets.only(bottom: 10),
              decoration: BoxDecoration(
                color: theme.surfaceColor,
                borderRadius: BorderRadius.circular(10),
                border: Border.all(color: theme.borderColor),
              ),
              child: ListTile(
                onTap: () => _openReader(book),
                leading: CircleAvatar(
                  backgroundColor: theme.accentColor.withOpacity(0.15),
                  child: Icon(Icons.book, color: theme.accentColor, size: 20),
                ),
                title: Row(
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
                        style: TextStyle(color: theme.textColor, fontWeight: FontWeight.bold, fontSize: 14),
                      ),
                    ),
                  ],
                ),
                subtitle: Text(
                  book.lastReadChapterTitle != null ? '읽던 곳: ${book.lastReadChapterTitle}' : '총 ${book.totalChapters}화',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(color: theme.subTextColor, fontSize: 12),
                ),
                trailing: IconButton(
                  icon: Icon(
                    book.isPinned ? Icons.star_rounded : Icons.star_border_rounded,
                    color: book.isPinned ? Colors.amber : theme.subTextColor,
                  ),
                  onPressed: () async {
                    await LocalDbService.togglePinBook(book.folderName, book.isPinned);
                    _loadLibrary();
                  },
                ),
              ),
            );
          },
          childCount: _books.length,
        ),
      ),
    );
  }

  Widget _buildReadingStatsView(ReaderThemeData theme) {
    return Scaffold(
      backgroundColor: theme.background,
      appBar: AppBar(
        backgroundColor: theme.surfaceColor,
        elevation: 0,
        title: Text(
          '독서 통계 & 잔디 심기',
          style: TextStyle(color: theme.textColor, fontSize: 18, fontWeight: FontWeight.bold),
        ),
      ),
      body: ReadingStatsSheet(theme: theme),
    );
  }
}
