document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let allBooks = [];
    let activeTagFilter = null;
    let activeStatusFilter = 'all'; // 'all', 'pinned', 'reading', 'unread', 'completed'
    let searchQuery = '';
    let currentSort = 'recent'; // 'recent', 'pinned', 'name_asc', 'chapters_desc'
    let currentViewMode = localStorage.getItem('library_view_mode') || 'grid'; // 'grid' or 'list'
    let currentEditingBook = null;
    let initialModalState = {};
    let modalUrls = [];
    let taskPollInterval = null;

    // --- DOM Elements ---
    const bookShelf = document.getElementById('book-shelf');
    const heroContinueReading = document.getElementById('hero-continue-reading');
    const tagFilterBar = document.getElementById('tag-filter-bar');
    const bookSearchInput = document.getElementById('bookSearchInput');
    const searchClearBtn = document.getElementById('searchClearBtn');
    const sortDropdown = document.getElementById('sortDropdown');
    const btnViewShelf = document.getElementById('btnViewShelf');
    const btnViewGrid = document.getElementById('btnViewGrid');
    const btnViewList = document.getElementById('btnViewList');
    const statusTabBtns = document.querySelectorAll('.status-tab-btn');
    const darkModeToggle = document.getElementById('darkModeToggle');

    // 3D Tome Modal Elements
    const tomeModal = document.getElementById('tome-3d-modal');
    const tomeBook3D = document.getElementById('tomeBook3D');
    const tomeModalCloseBtn = document.getElementById('tomeModalCloseBtn');
    const tomeModalBadge = document.getElementById('tomeModalBadge');
    const tomeModalTitle = document.getElementById('tomeModalTitle');
    const tomeModalTags = document.getElementById('tomeModalTags');
    const tomeDialHand = document.getElementById('tomeDialHand');
    const tomeProgressPct = document.getElementById('tomeProgressPct');
    const tomeChapterCount = document.getElementById('tomeChapterCount');
    const tomeSynopsisText = document.getElementById('tomeSynopsisText');
    const tomeLastChapter = document.getElementById('tomeLastChapter');
    const tomeLastTime = document.getElementById('tomeLastTime');
    const tomeMainReadBtn = document.getElementById('tomeMainReadBtn');
    const tomeTocBtn = document.getElementById('tomeTocBtn');
    const tomePinBtn = document.getElementById('tomePinBtn');
    const tomeEditBtn = document.getElementById('tomeEditBtn');
    let currentTomeBook = null;

    // Stats Elements
    const statTotalBooks = document.getElementById('statTotalBooks');
    const statPinnedBooks = document.getElementById('statPinnedBooks');
    const statReadingBooks = document.getElementById('statReadingBooks');
    const statUnreadBooks = document.getElementById('statUnreadBooks');
    const statCompletedBooks = document.getElementById('statCompletedBooks');
    const countAll = document.getElementById('countAll');
    const countPinned = document.getElementById('countPinned');
    const countReading = document.getElementById('countReading');
    const countUnread = document.getElementById('countUnread');
    const countCompleted = document.getElementById('countCompleted');
    const countReviewed = document.getElementById('countReviewed');
    const countHidden = document.getElementById('countHidden');

    // Task & Action Elements
    const fetchMissingTitlesBtn = document.getElementById('fetch-missing-titles-btn');
    const downloadAllBtn = document.getElementById('download-all-offline-btn');
    const globalDownloadStatus = document.getElementById('global-download-status');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');

    // Tag Editor Modal Elements
    const tagModal = document.getElementById('tag-editor-modal');
    const tagModalBookName = document.getElementById('tag-editor-book-name');
    const isVisibleToggle = document.getElementById('book-is-visible-toggle');
    const isCompletedToggle = document.getElementById('book-is-completed-toggle');
    const isReviewedToggle = document.getElementById('book-is-reviewed-toggle');
    const completedStatusBadge = document.getElementById('completed-status-badge');
    const reviewedStatusBadge = document.getElementById('reviewed-status-badge');
    const visibleStatusBadge = document.getElementById('visible-status-badge');
    const tagCheckboxForm = document.getElementById('tag-checkbox-form');
    const newTagForm = document.getElementById('new-tag-form');
    const newTagNameInput = document.getElementById('new-tag-name');
    const notesSummaryTextarea = document.getElementById('book-notes-summary');
    const summarySourceUrlInput = document.getElementById('book-summary-source-url');
    const crawlSummaryBtn = document.getElementById('crawl-summary-btn');
    const bookTocSourceUrlInput = document.getElementById('book-toc-source-url');
    const syncTocEditorBtn = document.getElementById('sync-toc-editor-btn');
    const tagModalCloseBtn = document.getElementById('tag-editor-close');
    const tagModalCancelBtn = document.getElementById('tag-editor-cancel');
    const tagModalSaveBtn = document.getElementById('tag-editor-save');

    // URL List Modal Elements (Royal Archive Chapter Index Ledger)
    const urlListModal = document.getElementById('url-list-modal');
    const urlListTitle = document.getElementById('url-list-title');
    const urlListBody = document.getElementById('url-list-body');
    const urlListStats = document.getElementById('urlListStats');
    const urlSearchInput = document.getElementById('urlSearchInput');
    const urlSearchClearBtn = document.getElementById('urlSearchClearBtn');
    const importTocBtn = document.getElementById('import-toc-btn');
    const urlListCloseBtn = document.getElementById('url-list-close');
    const urlListCloseBottomBtn = document.getElementById('url-list-close-bottom');
    const tocJumpBookmarkBtn = document.getElementById('toc-jump-bookmark-btn');
    const tocSortToggleBtn = document.getElementById('toc-sort-toggle-btn');
    const tocSortLabel = document.getElementById('toc-sort-label');
    const tocScrollTopBtn = document.getElementById('toc-scroll-top-btn');

    let currentModalBookName = '';
    let currentModalBookData = null;
    let tocSortAscending = true;

    // --- Theme Management ---
    function initTheme() {
        const savedDarkMode = localStorage.getItem('darkMode') === 'true';
        if (savedDarkMode) {
            document.body.classList.add('dark-mode');
        } else {
            document.body.classList.remove('dark-mode');
        }
        updateThemeIcon();
    }

    function updateThemeIcon() {
        if (!darkModeToggle) return;
        const isDark = document.body.classList.contains('dark-mode');
        darkModeToggle.innerHTML = `<span class="material-icons">${isDark ? 'light_mode' : 'dark_mode'}</span>`;
        darkModeToggle.title = isDark ? '라이트 모드로 전환' : '다크 모드로 전환';
    }

    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', () => {
            const isDark = document.body.classList.toggle('dark-mode');
            localStorage.setItem('darkMode', isDark);
            updateThemeIcon();
            showToast(isDark ? '다크 모드가 적용되었습니다.' : '라이트 모드가 적용되었습니다.');
        });
    }

    // --- Utilities ---
    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.toString().replace(/[&<>"']/g, m => map[m]);
    }

    function formatTimeAgo(timestamp) {
        if (!timestamp) return '';
        const now = Math.floor(Date.now() / 1000);
        const diff = now - timestamp;

        if (diff < 60) return '방금 전';
        if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
        if (diff < 604800) return `${Math.floor(diff / 86400)}일 전`;

        const date = new Date(timestamp * 1000);
        return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
    }

    function showToast(message, duration = 2500) {
        let toast = document.getElementById('global-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'global-toast';
            toast.className = 'toast';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.display = 'flex';
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => {
            toast.style.display = 'none';
        }, duration);
    }

    // --- Data Fetching ---
    async function fetchBooks() {
        try {
            const response = await fetch(`/api/books?include_hidden=true&_t=${Date.now()}`, {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            allBooks = await response.json();
            updateStatsBar();
            renderTagFilters();
            renderBooks();
        } catch (error) {
            bookShelf.innerHTML = `
                <div class="empty-shelf-notice">
                    <span class="material-icons" style="color: var(--danger-color);">error_outline</span>
                    <p style="color: var(--danger-color); font-weight: 600;">책 목록을 불러오는 데 실패했습니다.</p>
                    <p style="font-size: 12px; margin-top: 4px;">${escapeHtml(error.message)}</p>
                </div>
            `;
        }
    }

    // --- Stats Bar Update (Difference Engine Manometer Rack) ---
    function updateStatsBar() {
        const visibleBooks = allBooks.filter(b => b.is_visible !== 0);
        const hiddenCount = allBooks.filter(b => b.is_visible === 0).length;

        const total = visibleBooks.length;
        const pinned = visibleBooks.filter(b => b.pinned).length;
        const completed = visibleBooks.filter(b => b.activity && (b.activity.is_completed === 1 || b.activity.is_completed === true)).length;
        const reading = visibleBooks.filter(b => !(b.activity && (b.activity.is_completed === 1 || b.activity.is_completed === true)) && (b.activity && (b.activity.last_read_pid || b.activity.last_read_chapter_title))).length;
        const unread = visibleBooks.filter(b => !(b.activity && (b.activity.is_completed === 1 || b.activity.is_completed === true)) && (!b.activity || (!b.activity.last_read_pid && !b.activity.last_read_chapter_title))).length;
        const reviewed = visibleBooks.filter(b => b.is_reviewed).length;

        if (statTotalBooks) statTotalBooks.textContent = total;
        if (statPinnedBooks) statPinnedBooks.textContent = pinned;
        if (statReadingBooks) statReadingBooks.textContent = reading;
        if (statUnreadBooks) statUnreadBooks.textContent = unread;
        if (statCompletedBooks) statCompletedBooks.textContent = completed;

        if (countAll) countAll.textContent = total;
        if (countPinned) countPinned.textContent = pinned;
        if (countReading) countReading.textContent = reading;
        if (countUnread) countUnread.textContent = unread;
        if (countCompleted) countCompleted.textContent = completed;
        if (countReviewed) countReviewed.textContent = reviewed;
        if (countHidden) countHidden.textContent = hiddenCount;

        // Dynamic needle deflection with realistic damping physics
        const maxVal = Math.max(total, 1);
        const setNeedle = (selector, val, baseMin = -60, baseMax = 60) => {
            const needle = document.querySelector(selector);
            if (needle) {
                const ratio = Math.min(1, Math.max(0, val / maxVal));
                const angle = Math.round(baseMin + ratio * (baseMax - baseMin));
                needle.style.transform = `rotate(${angle}deg)`;
                needle.style.setProperty('--rot', `${angle}deg`);
            }
        };

        setNeedle('.needle-p1', total, 10, 65);
        setNeedle('.needle-p2', pinned, -55, 45);
        setNeedle('.needle-p3', reading, -45, 55);
        setNeedle('.needle-p4', unread, -60, 30);
        setNeedle('.needle-p5', completed, -30, 60);
    }

    // --- Progress & Reading State Calculation (5번 기능) ---
    function calculateProgress(book) {
        const total = book.chapter_count || 0;
        const activity = book.activity;
        const isCompleted = activity && (activity.is_completed === 1 || activity.is_completed === true);
        const lastReadTitle = activity?.last_read_chapter_title || '';
        const lastReadPid = activity?.last_read_pid || '';
        const hasHistory = Boolean(lastReadTitle || lastReadPid);

        // 1. 완결 여부 최우선 판정: 열람 이력 유무와 무관하게 완결작이면 100% 진도 및 완결 표기
        if (isCompleted) {
            return {
                isUnread: false,
                isCompleted: true,
                percentage: 100,
                currentNum: total,
                totalChapters: total,
                displayChapter: lastReadTitle || (total > 0 ? `제 ${total}화 (완결)` : '완결'),
                rawTitle: lastReadTitle
            };
        }

        // 2. 완결이 아니며 독서 이력이 없는 경우 미열람 처리
        if (!hasHistory) {
            return {
                isUnread: true,
                isCompleted: false,
                percentage: 0,
                currentNum: 0,
                totalChapters: total,
                displayChapter: '아직 읽지 않음',
                rawTitle: ''
            };
        }

        // 회차 번호 정규식 추출: "제 45화", "45화", "Chapter 45", "45장" 등
        let currentNum = 0;
        const match = lastReadTitle.match(/(?:제\s*|[#№])?(\d+)\s*(?:화|장|편|회|話|ep|chapter)/i) || lastReadTitle.match(/\b(\d+)\b/);
        if (match) {
            currentNum = parseInt(match[1], 10);
        } else if (lastReadPid) {
            currentNum = 1;
        }

        let percentage = 0;
        if (total > 0) {
            percentage = Math.min(100, Math.max(1, Math.round((currentNum / total) * 100)));
        } else if (currentNum > 0) {
            percentage = 100;
        }

        return {
            isUnread: false,
            isCompleted: false,
            percentage,
            currentNum,
            totalChapters: total,
            displayChapter: lastReadTitle || (lastReadPid ? `최근 위치: ${lastReadPid}` : '읽는 중'),
            rawTitle: lastReadTitle
        };
    }

    // --- Hero Continue Reading Section (Royal Lectern & Difference Engine Console) ---
    function renderHeroContinueReading() {
        if (!heroContinueReading) return;

        // 최근 읽은 이력이 있는 책 중 timestamp 최신 1위 선택
        const readBooks = allBooks.filter(b => b.activity && b.activity.last_read_timestamp && (b.activity.last_read_chapter_title || b.activity.last_read_pid));
        if (readBooks.length === 0) {
            heroContinueReading.style.display = 'none';
            heroContinueReading.innerHTML = '';
            return;
        }

        readBooks.sort((a, b) => (b.activity.last_read_timestamp || 0) - (a.activity.last_read_timestamp || 0));
        const heroBook = readBooks[0];
        const progress = calculateProgress(heroBook);
        const timeAgo = formatTimeAgo(heroBook.activity.last_read_timestamp);
        const isCompleted = heroBook.activity && (heroBook.activity.is_completed === 1 || heroBook.activity.is_completed === true);

        heroContinueReading.innerHTML = `
            <div class="hero-lectern-card">
                <!-- Brass Ornate Corner Accents -->
                <div class="brass-corner c-tl"></div>
                <div class="brass-corner c-tr"></div>
                <div class="brass-corner c-bl"></div>
                <div class="brass-corner c-br"></div>

                <!-- Left: 3D Open Tome Preview on Lectern -->
                <div class="hero-lectern-tome">
                    <div class="hero-tome-cover ${isCompleted ? 'completed' : ''}">
                        <div class="hero-tome-spine"></div>
                        <div class="hero-tome-body">
                            <div class="hero-tome-seal font-typewriter">${isCompleted ? 'CHRONICLE DONE' : 'IN COMPUTATION'}</div>
                            <h3 class="hero-tome-title font-serif" title="${escapeHtml(heroBook.name)}">${escapeHtml(heroBook.name)}</h3>
                            <div class="hero-tome-ribbon"></div>
                        </div>
                    </div>
                </div>

                <!-- Center: Lectern Engine Console & Progress -->
                <div class="hero-lectern-console">
                    <div class="hero-console-header">
                        <span class="hero-plaque font-typewriter">
                            <span class="material-icons" style="font-size: 15px; vertical-align: middle;">history_edu</span>
                            ROYAL LECTERN ARCHIVE
                        </span>
                        <span class="hero-reading-time font-typewriter">${escapeHtml(timeAgo)} 열람</span>
                    </div>

                    <div class="hero-main-title font-serif" data-action="read" data-book-name="${escapeHtml(heroBook.name)}" title="${escapeHtml(heroBook.name)}">
                        ${escapeHtml(heroBook.name)}
                    </div>

                    <div class="hero-chapter-display">
                        <span class="material-icons chapter-icon">bookmark</span>
                        <span class="chapter-text font-serif">${escapeHtml(progress.displayChapter)}</span>
                    </div>

                    <!-- Brass Odometer Progress Gauge -->
                    <div class="hero-progress-rack">
                        <div class="hero-progress-track">
                            <div class="hero-progress-fill" style="width: ${progress.percentage}%;"></div>
                        </div>
                        <div class="hero-progress-meta font-typewriter">
                            <span>COMPUTED: <strong class="hero-progress-pct">${progress.percentage}%</strong></span>
                            <span class="sep">|</span>
                            <span>${progress.currentNum > 0 ? `TOME ${progress.currentNum} / TOTAL ${progress.totalChapters}` : `TOTAL ${progress.totalChapters} CHRONICLES`}</span>
                        </div>
                    </div>
                </div>

                <!-- Right: High-Craftsmanship Brass Actions -->
                <div class="hero-lectern-actions">
                    <button class="btn btn-primary hero-engage-btn font-display" data-action="read" data-book-name="${escapeHtml(heroBook.name)}">
                        <span class="material-icons">menu_book</span> 서책 이어보기
                    </button>
                    <button class="btn btn-outline hero-sub-action font-serif" data-action="toc" data-book-name="${escapeHtml(heroBook.name)}" title="목차 열람">
                        <span class="material-icons">format_list_bulleted</span> 목차 색인
                    </button>
                </div>
            </div>
        `;
        heroContinueReading.style.display = 'block';
    }

    // --- View Mode Management (Grid / Compact List / 3D Steampunk Shelf) ---
    function setViewMode(mode) {
        currentViewMode = mode;
        localStorage.setItem('library_view_mode', mode);

        if (btnViewShelf) btnViewShelf.classList.toggle('active', mode === 'shelf');
        if (btnViewGrid) btnViewGrid.classList.toggle('active', mode === 'grid');
        if (btnViewList) btnViewList.classList.toggle('active', mode === 'list');
        
        if (bookShelf) {
            bookShelf.classList.toggle('list-view', mode === 'list');
            bookShelf.classList.toggle('shelf-view', mode === 'shelf');
        }

        if (window.SteampunkSound) {
            window.SteampunkSound.playSwitch();
        }

        renderBooks();
    }

    // --- Tag Filters ---
    function renderTagFilters() {
        const allTags = new Map();
        allBooks.forEach(book => {
            (book.tags || []).forEach(tag => allTags.set(tag.name, tag));
        });
        const sortedTags = [...allTags.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));

        let filtersHtml = `
            <button class="tag-filter ${!activeTagFilter ? 'active' : ''}" data-tag="null">
                전체 태그
            </button>
        `;

        filtersHtml += sortedTags.map(tag => `
            <button class="tag-filter ${activeTagFilter === tag.name ? 'active' : ''}" data-tag="${escapeHtml(tag.name)}">
                #${escapeHtml(tag.name)}
            </button>
        `).join('');

        tagFilterBar.innerHTML = filtersHtml;
    }

    // --- Book Filtering & Sorting ---
    function getFilteredAndSortedBooks() {
        let list = [...allBooks];

        // 1. Status Filter
        if (activeStatusFilter === 'hidden') {
            list = list.filter(b => b.is_visible === 0);
        } else {
            list = list.filter(b => b.is_visible !== 0);

            if (activeStatusFilter === 'pinned') {
                list = list.filter(b => b.pinned);
            } else if (activeStatusFilter === 'reading') {
                list = list.filter(b => !(b.activity && (b.activity.is_completed === 1 || b.activity.is_completed === true)) && (b.activity && (b.activity.last_read_pid || b.activity.last_read_chapter_title)));
            } else if (activeStatusFilter === 'unread') {
                list = list.filter(b => !(b.activity && (b.activity.is_completed === 1 || b.activity.is_completed === true)) && (!b.activity || (!b.activity.last_read_pid && !b.activity.last_read_chapter_title)));
            } else if (activeStatusFilter === 'completed') {
                list = list.filter(b => b.activity && (b.activity.is_completed === 1 || b.activity.is_completed === true));
            } else if (activeStatusFilter === 'reviewed') {
                list = list.filter(b => b.is_reviewed);
            }
        }

        // 2. Tag Filter
        if (activeTagFilter) {
            list = list.filter(b => (b.tags || []).some(t => t.name === activeTagFilter));
        }

        // 3. Search Query Filter
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            list = list.filter(b => {
                const nameMatch = (b.name || '').toLowerCase().includes(q);
                const summaryMatch = ((b.activity?.summary || b.activity?.notes) || '').toLowerCase().includes(q);
                const tagMatch = (b.tags || []).some(t => t.name.toLowerCase().includes(q));
                return nameMatch || summaryMatch || tagMatch;
            });
        }

        // 4. Sorting
        list.sort((a, b) => {
            const aPinned = a.pinned ? 1 : 0;
            const bPinned = b.pinned ? 1 : 0;
            const aTime = a.activity?.last_read_timestamp || 0;
            const bTime = b.activity?.last_read_timestamp || 0;
            const aChapters = a.chapter_count || 0;
            const bChapters = b.chapter_count || 0;

            if (currentSort === 'recent') {
                if (bTime !== aTime) return bTime - aTime;
                if (bPinned !== aPinned) return bPinned - aPinned;
                return (a.name || '').localeCompare(b.name || '', 'ko');
            } else if (currentSort === 'pinned') {
                if (bPinned !== aPinned) return bPinned - aPinned;
                if (bTime !== aTime) return bTime - aTime;
                return (a.name || '').localeCompare(b.name || '', 'ko');
            } else if (currentSort === 'name_asc') {
                return (a.name || '').localeCompare(b.name || '', 'ko');
            } else if (currentSort === 'chapters_desc') {
                if (bChapters !== aChapters) return bChapters - aChapters;
                return (a.name || '').localeCompare(b.name || '', 'ko');
            }
            return 0;
        });

        return list;
    }

    // --- Book Shelf Rendering (Grid / Compact List / 3D Steampunk Shelf) ---
    function renderBooks() {
        renderHeroContinueReading();

        const booksToRender = getFilteredAndSortedBooks();

        if (booksToRender.length === 0) {
            bookShelf.innerHTML = `
                <div class="empty-shelf-notice">
                    <span class="material-icons">menu_book</span>
                    <p style="font-size: 15px; font-weight: 600; color: var(--text-secondary);">표시할 책이 없습니다.</p>
                    <p style="font-size: 13px; margin-top: 6px;">검색어 또는 선택한 필터 조건을 확인해보세요.</p>
                </div>
            `;
            return;
        }

        if (currentViewMode === 'shelf') {
            bookShelf.classList.add('shelf-view');
            bookShelf.classList.remove('list-view');
            renderShelfView(booksToRender);
        } else if (currentViewMode === 'list') {
            bookShelf.classList.add('list-view');
            bookShelf.classList.remove('shelf-view');
            bookShelf.innerHTML = booksToRender.map(book => renderListRow(book)).join('');
        } else {
            bookShelf.classList.remove('list-view');
            bookShelf.classList.remove('shelf-view');
            bookShelf.innerHTML = booksToRender.map((book, idx) => renderGridCard(book, idx)).join('');
            attachCardHoverSounds();
        }
    }

    // Grid Card HTML (19세기 왕립 양장본 고서 & 차분기관 아카이브 카드)
    function renderGridCard(book, index = 0) {
        const { name, pinned, tags = [], activity = {}, chapter_count = 0 } = book;
        const progress = calculateProgress(book);
        const timeAgo = activity?.last_read_timestamp ? formatTimeAgo(activity.last_read_timestamp) : '';
        const tagsHtml = tags.map(t => `<span class="tag-mini">#${escapeHtml(t.name)}</span>`).join('');

        let badgeClass = 'serializing';
        let badgeText = '연재중';
        let leatherClass = 'leather-amber';

        if (progress.isCompleted) {
            badgeClass = 'completed';
            badgeText = '완결';
            leatherClass = 'leather-obsidian-gold';
        } else if (pinned) {
            badgeClass = 'pinned';
            badgeText = '즐겨찾기';
            leatherClass = 'leather-ruby';
        } else if (progress.isUnread) {
            badgeClass = 'unread';
            badgeText = '미열람';
            leatherClass = 'leather-sapphire';
        } else {
            leatherClass = (index % 2 === 0) ? 'leather-amber' : 'leather-emerald';
        }

        return `
        <div class="book-card tome-card-3d ${leatherClass}" data-book-name="${escapeHtml(name)}">
            <!-- 3D Leather Spine with Embossed Gold Ribs -->
            <div class="tome-card-spine">
                <div class="spine-rib r1"></div>
                <div class="spine-rib r2"></div>
                <div class="spine-rib r3"></div>
            </div>

            <!-- Brass Corner Protectors -->
            <div class="brass-corner c-tl"></div>
            <div class="brass-corner c-tr"></div>
            <div class="brass-corner c-bl"></div>
            <div class="brass-corner c-br"></div>

            <!-- Hanging Silk Ribbon Bookmark -->
            <div class="tome-ribbon-tail"></div>

            <!-- Card Top Bar: Badges & Pin Button -->
            <div class="card-top-bar">
                <div class="badge-group">
                    <span class="status-badge ${badgeClass}">${badgeText}</span>
                    ${book.is_reviewed ? `<span class="status-badge reviewed font-typewriter" title="원문 및 번역문 수정 잠금 완료">✅ 검수완료</span>` : ''}
                    <span class="chapter-count-badge font-typewriter">VOL.${chapter_count}</span>
                </div>
                <button class="pin-btn ${pinned ? 'pinned' : ''}" data-action="pin" data-book-name="${escapeHtml(name)}" title="${pinned ? '즐겨찾기 해제' : '즐겨찾기 추가'}">
                    <span class="material-icons">${pinned ? 'star' : 'star_border'}</span>
                </button>
            </div>

            <!-- Card Main Body: Parchment Inlay with Gold Stamping -->
            <div class="card-main">
                <div class="tome-title-frame">
                    <h2 class="book-card-title font-serif" title="${escapeHtml(name)}">${escapeHtml(name)}</h2>
                </div>

                <!-- Last Read Indicator Box (Brass Inset Plaque) -->
                <div class="last-read-box brass-plaque-inset">
                    <span class="material-icons last-read-icon">
                        ${!progress.isUnread ? 'bookmark' : 'menu_book'}
                    </span>
                    <div class="last-read-content">
                        <div class="last-read-title font-serif" title="${escapeHtml(progress.displayChapter)}">
                            ${escapeHtml(progress.displayChapter)}
                        </div>
                        ${timeAgo ? `<div class="last-read-time font-typewriter">${escapeHtml(timeAgo)} 열람</div>` : ''}
                    </div>
                </div>

                <!-- Card Reading Progress Bar (Brass Gear Ratio) -->
                ${!progress.isUnread ? `
                <div class="card-progress-wrap">
                    <div class="card-progress-track">
                        <div class="card-progress-fill" style="width: ${progress.percentage}%;"></div>
                    </div>
                    <div class="card-progress-labels font-typewriter">
                        <span>진도율 <strong class="card-progress-pct">${progress.percentage}%</strong></span>
                        <span>${progress.currentNum > 0 ? `${progress.currentNum}/${progress.totalChapters}화` : ''}</span>
                    </div>
                </div>
                ` : ''}

                <!-- Mini Tags -->
                <div class="tags-container">${tagsHtml}</div>
            </div>

            <!-- Card Bottom Actions: Tactile Brass Controls -->
            <div class="card-actions">
                <button class="btn btn-primary btn-read font-display" data-action="read" data-book-name="${escapeHtml(name)}">
                    <span class="material-icons">play_arrow</span> ${!progress.isUnread ? '이어보기' : '첫화 읽기'}
                </button>
                <button class="btn btn-outline btn-toc font-serif" data-action="toc" data-book-name="${escapeHtml(name)}">
                    <span class="material-icons">format_list_bulleted</span> 목차
                </button>
                <button class="btn btn-outline btn-info" data-action="edit" data-book-name="${escapeHtml(name)}" title="책 정보 및 설정">
                    <span class="material-icons">settings</span>
                </button>
            </div>
        </div>
        `;
    }

    // Compact List Row HTML (4번 콤팩트 리스트 뷰)
    function renderListRow(book) {
        const { name, pinned, tags = [], activity = {}, chapter_count = 0 } = book;
        const progress = calculateProgress(book);
        const timeAgo = activity?.last_read_timestamp ? formatTimeAgo(activity.last_read_timestamp) : '-';
        const tagsHtml = tags.slice(0, 3).map(t => `<span class="tag-mini">#${escapeHtml(t.name)}</span>`).join('');

        let badgeClass = 'serializing';
        let badgeText = '연재중';
        if (progress.isCompleted) {
            badgeClass = 'completed';
            badgeText = '완결';
        } else if (progress.isUnread) {
            badgeClass = 'unread';
            badgeText = '미열람';
        }

        return `
        <div class="book-list-row" data-book-name="${escapeHtml(name)}">
            <!-- Pin Button -->
            <button class="pin-btn ${pinned ? 'pinned' : ''}" data-action="pin" data-book-name="${escapeHtml(name)}" title="${pinned ? '즐겨찾기 해제' : '즐겨찾기 추가'}">
                <span class="material-icons">${pinned ? 'star' : 'star_border'}</span>
            </button>

            <!-- Book Info: Title & Tags -->
            <div class="book-list-info">
                <div class="book-list-title" data-action="read" data-book-name="${escapeHtml(name)}" title="${escapeHtml(name)}">
                    ${escapeHtml(name)}
                </div>
                ${tagsHtml ? `<div class="book-list-tags">${tagsHtml}</div>` : ''}
            </div>

            <!-- Reading Progress Col -->
            <div class="book-list-progress-col">
                <div class="book-list-chapter" title="${escapeHtml(progress.displayChapter)}">
                    ${escapeHtml(progress.displayChapter)}
                </div>
                ${!progress.isUnread ? `
                <div class="book-list-progress-bar">
                    <div class="book-list-progress-bar-fill" style="width: ${progress.percentage}%;"></div>
                </div>
                <div style="font-size: 10px; color: var(--text-muted);">
                    ${progress.percentage}% ${progress.currentNum > 0 ? `(${progress.currentNum}/${progress.totalChapters}화)` : ''}
                </div>
                ` : '<div style="font-size: 10px; color: var(--text-muted);">미열람 신규 도서</div>'}
            </div>

            <!-- Status Badge -->
            <div class="book-list-status">
                <span class="status-badge ${badgeClass}">${badgeText}</span>
                ${book.is_reviewed ? `<span class="status-badge reviewed font-typewriter" style="margin-left: 4px;" title="원문 및 번역문 수정 잠금 완료">✅ 검수완료</span>` : ''}
            </div>

            <!-- Total Chapters -->
            <div class="book-list-chapters">
                총 ${chapter_count}화
            </div>

            <!-- Last Read Time -->
            <div class="book-list-time">
                ${timeAgo}
            </div>

            <!-- Actions -->
            <div class="book-list-actions">
                <button class="btn btn-primary btn-sm" data-action="read" data-book-name="${escapeHtml(name)}">
                    <span class="material-icons" style="font-size: 15px;">play_arrow</span> ${!progress.isUnread ? '이어보기' : '읽기'}
                </button>
                <button class="btn btn-outline btn-sm" data-action="toc" data-book-name="${escapeHtml(name)}" title="목차">
                    <span class="material-icons" style="font-size: 15px;">format_list_bulleted</span>
                </button>
                <button class="btn btn-outline btn-sm" data-action="edit" data-book-name="${escapeHtml(name)}" title="설정">
                    <span class="material-icons" style="font-size: 15px;">settings</span>
                </button>
            </div>
        </div>
        `;
    }

    // ==========================================================================
    // 3D Steampunk Mahogany Bookshelf & Hardcover Tome Showcase Engine
    // ==========================================================================

    let lastSfxHoverTime = 0;

    // Render Bookshelf Rack Rows
    function renderShelfView(books) {
        if (!books || books.length === 0) {
            bookShelf.innerHTML = '';
            return;
        }

        // Divide tomes into shelf tiers (8 books per tier)
        const BOOKS_PER_SHELF = 8;
        const tiers = [];
        for (let i = 0; i < books.length; i += BOOKS_PER_SHELF) {
            tiers.push(books.slice(i, i + BOOKS_PER_SHELF));
        }

        let html = '';
        tiers.forEach((shelfBooks, tierIdx) => {
            const tomesHtml = shelfBooks.map((b, idx) => {
                const globalIdx = (tierIdx * BOOKS_PER_SHELF) + idx;
                return renderTomeSpine(b, globalIdx);
            }).join('');

            html += `
            <div class="wooden-shelf-rack">
                <div class="shelf-bracket bracket-left"></div>
                <div class="shelf-bracket bracket-right"></div>
                <div class="shelf-tomes-row">
                    ${tomesHtml}
                </div>
                <div class="wooden-shelf-plank">
                    <div class="shelf-inlay-brass"></div>
                    <div class="shelf-wood-grain"></div>
                </div>
            </div>
            `;
        });

        bookShelf.innerHTML = html;

        // Attach tactical hover sound to each 3D tome spine
        const spineItems = bookShelf.querySelectorAll('.tome-spine-item');
        spineItems.forEach(spine => {
            spine.addEventListener('mouseenter', () => {
                const now = Date.now();
                if (now - lastSfxHoverTime > 75) {
                    lastSfxHoverTime = now;
                    if (window.SteampunkSound && typeof window.SteampunkSound.playKeyClick === 'function') {
                        window.SteampunkSound.playKeyClick();
                    }
                }
            });
        });
    }

    // Render Individual 3D Spine
    function renderTomeSpine(book, index) {
        const { name, pinned, activity = {}, chapter_count = 0 } = book;
        const progress = calculateProgress(book);

        // Leather Palette Mapping
        let leatherClass = 'leather-amber';
        if (progress.isCompleted) {
            leatherClass = 'leather-obsidian-gold';
        } else if (pinned) {
            leatherClass = 'leather-ruby';
        } else if (!progress.isUnread) {
            leatherClass = (index % 2 === 0) ? 'leather-sapphire' : 'leather-emerald';
        }

        // Variational thickness and height based on title hash and chapters
        const hash = (name || '').split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
        const spineHeight = 258 + (hash % 26); // 258px ~ 283px
        const spineWidth = 52 + Math.min(22, Math.floor(chapter_count / 15)); // 52px ~ 74px

        let badgeHtml = '';
        if (progress.isCompleted) {
            badgeHtml = '<div class="tome-spine-ch-badge">완결</div>';
        } else if (progress.percentage > 0) {
            badgeHtml = `<div class="tome-spine-ch-badge">${progress.percentage}%</div>`;
        } else if (chapter_count > 0) {
            badgeHtml = `<div class="tome-spine-ch-badge">${chapter_count}화</div>`;
        }

        const ribbonHtml = !progress.isUnread ? '<div class="tome-ribbon-tail"></div>' : '';

        return `
        <div class="tome-spine-item" data-book-name="${escapeHtml(name)}" style="width: ${spineWidth}px; height: ${spineHeight}px;" title="${escapeHtml(name)} (클릭하여 3D 양장본 펼치기)">
            <div class="tome-spine-shadow"></div>
            <div class="tome-spine-face ${leatherClass}">
                <div class="tome-rib-line"></div>
                <div class="tome-rib-line" style="margin-top: 4px;"></div>
                <div class="tome-spine-title">${escapeHtml(name)}</div>
                ${badgeHtml}
                <div class="tome-rib-line" style="margin-top: auto; margin-bottom: 4px;"></div>
                <div class="tome-rib-line"></div>
                ${ribbonHtml}
            </div>
        </div>
        `;
    }

    // 3D Tome Showcase Modal Control
    function openTomeModal(bookName) {
        const book = allBooks.find(b => b.name === bookName);
        if (!book || !tomeModal) return;

        currentTomeBook = book;
        const { name, pinned, tags = [], activity = {}, chapter_count = 0 } = book;
        const progress = calculateProgress(book);
        const timeAgo = activity?.last_read_timestamp ? formatTimeAgo(activity.last_read_timestamp) : '';

        // Left Wing (Parchment Metadata)
        if (tomeModalBadge) {
            let badgeText = '연재중';
            if (progress.isCompleted) badgeText = '완결작';
            else if (progress.isUnread) badgeText = '미열람';
            tomeModalBadge.textContent = badgeText;
        }
        if (tomeModalTitle) tomeModalTitle.textContent = name;
        if (tomeModalTags) {
            tomeModalTags.innerHTML = tags.map(t => `<span class="tag-mini">#${escapeHtml(t.name)}</span>`).join('');
        }
        if (tomeProgressPct) tomeProgressPct.textContent = `${progress.percentage}%`;
        if (tomeChapterCount) tomeChapterCount.textContent = `총 ${chapter_count}화`;
        if (tomeDialHand) {
            // Dial rotates from -90deg (0%) to +90deg (100%)
            const angle = (progress.percentage * 1.8) - 90;
            tomeDialHand.style.transform = `rotate(${angle}deg)`;
        }
        if (tomeSynopsisText) {
            const summary = activity?.summary || activity?.notes || '등록된 줄거리나 메모가 없습니다. [설정]에서 줄거리를 크롤링하거나 입력할 수 있습니다.';
            tomeSynopsisText.textContent = summary;
        }

        // Right Wing (Record & Action Deck)
        if (tomeLastChapter) {
            tomeLastChapter.textContent = progress.displayChapter || '아직 읽지 않은 도서입니다.';
        }
        if (tomeLastTime) {
            tomeLastTime.textContent = timeAgo ? `${timeAgo} 읽음` : (progress.isUnread ? '독서 대기 중' : '기록 없음');
        }

        // Buttons
        if (tomePinBtn) {
            tomePinBtn.innerHTML = `<span class="material-icons">${pinned ? 'star' : 'star_border'}</span> ${pinned ? '즐겨찾기 됨' : '즐겨찾기'}`;
            tomePinBtn.classList.toggle('active', Boolean(pinned));
        }

        if (tomeMainReadBtn) {
            tomeMainReadBtn.onclick = () => {
                closeTomeModal();
                window.location.href = `/viewer?book=${encodeURIComponent(name)}${progress.rawTitle ? `&title=${encodeURIComponent(progress.rawTitle)}` : ''}`;
            };
        }

        if (tomeTocBtn) {
            tomeTocBtn.onclick = () => {
                closeTomeModal();
                openUrlListModal(name);
            };
        }

        if (tomePinBtn) {
            tomePinBtn.onclick = async () => {
                await togglePin(name);
                const updated = allBooks.find(b => b.name === name);
                if (updated && tomePinBtn) {
                    tomePinBtn.innerHTML = `<span class="material-icons">${updated.pinned ? 'star' : 'star_border'}</span> ${updated.pinned ? '즐겨찾기 됨' : '즐겨찾기'}`;
                    tomePinBtn.classList.toggle('active', Boolean(updated.pinned));
                }
            };
        }

        if (tomeEditBtn) {
            tomeEditBtn.onclick = () => {
                closeTomeModal();
                openEditModal(name);
            };
        }

        // Open animation with tactile page flip sound
        if (window.SteampunkSound && typeof window.SteampunkSound.playPageFlip === 'function') {
            window.SteampunkSound.playPageFlip();
        }

        tomeModal.style.display = 'flex';
        requestAnimationFrame(() => {
            tomeModal.classList.add('open');
            if (tomeBook3D) tomeBook3D.classList.add('opened');
        });
    }

    function closeTomeModal() {
        if (!tomeModal || tomeModal.style.display === 'none') return;

        if (window.SteampunkSound && typeof window.SteampunkSound.playPageFlip === 'function') {
            window.SteampunkSound.playPageFlip();
        }

        if (tomeBook3D) tomeBook3D.classList.remove('opened');
        tomeModal.classList.remove('open');
        setTimeout(() => {
            tomeModal.style.display = 'none';
            currentTomeBook = null;
        }, 250);
    }

    // --- Book Actions ---
    async function togglePin(folderName) {
        try {
            const response = await fetch('/api/books/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderName }),
            });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            const data = await response.json();
            showToast(data.message || '즐겨찾기 상태가 변경되었습니다.');
            await fetchBooks();
        } catch (error) {
            console.error('핀 상태 변경 실패:', error);
            showToast(`즐겨찾기 변경 실패: ${error.message}`);
        }
    }

    let allModalTags = [];

    // --- Modal Tab & Status Badge Management ---
    function updateModalStatusBadges() {
        if (completedStatusBadge && isCompletedToggle) {
            if (isCompletedToggle.checked) {
                completedStatusBadge.textContent = '🏆 완결작';
                completedStatusBadge.className = 'completed-pill status-completed';
            } else {
                completedStatusBadge.textContent = '📖 연재중';
                completedStatusBadge.className = 'completed-pill status-serializing';
            }
        }
        if (visibleStatusBadge && isVisibleToggle) {
            if (isVisibleToggle.checked) {
                visibleStatusBadge.textContent = '👁️ 표시중';
                visibleStatusBadge.className = 'completed-pill status-visible';
            } else {
                visibleStatusBadge.textContent = '🔒 숨김 처리';
                visibleStatusBadge.className = 'completed-pill status-hidden';
            }
        }
        if (reviewedStatusBadge && isReviewedToggle) {
            if (isReviewedToggle.checked) {
                reviewedStatusBadge.textContent = '✅ 검수완료';
                reviewedStatusBadge.className = 'completed-pill status-reviewed';
            } else {
                reviewedStatusBadge.textContent = '⏳ 검수대기';
                reviewedStatusBadge.className = 'completed-pill status-review-pending';
            }
        }
    }

    if (isCompletedToggle) isCompletedToggle.addEventListener('change', updateModalStatusBadges);
    if (isVisibleToggle) isVisibleToggle.addEventListener('change', updateModalStatusBadges);
    if (isReviewedToggle) isReviewedToggle.addEventListener('change', updateModalStatusBadges);

    function switchModalTab(tabKey) {
        const modalTabBtns = document.querySelectorAll('.modal-tab-btn');
        const modalTabPanes = document.querySelectorAll('.modal-tab-pane');
        modalTabBtns.forEach(btn => {
            const isActive = btn.dataset.tab === tabKey;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        modalTabPanes.forEach(pane => {
            const isTarget = pane.id === `modalTab-${tabKey}`;
            pane.classList.toggle('active', isTarget);
            pane.style.display = isTarget ? 'block' : 'none';
        });
    }

    // Modal tab click delegation
    document.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.modal-tab-btn');
        if (tabBtn) {
            e.preventDefault();
            switchModalTab(tabBtn.dataset.tab);
        }
    });

    // --- Tag & Info Editor Modal ---
    async function openEditModal(bookName) {
        currentEditingBook = allBooks.find(b => b.name === bookName);
        if (!currentEditingBook) return;

        const { name, tags = [], activity = {} } = currentEditingBook;

        switchModalTab('status'); // 항상 1번 탭(상태 & 서재)으로 초기화
        tagModalBookName.textContent = name;
        tagModalSaveBtn.disabled = false;
        tagModalSaveBtn.innerHTML = '<span class="material-icons" style="font-size: 16px;">check</span> 변경사항 저장';

        // 완결 플래그 또는 '완결' 태그 존재 여부 확인
        const hasCompletedTag = (tags || []).some(t => t.name === '완결');
        const isCompletedFlag = activity?.is_completed === 1 || activity?.is_completed === true;
        isCompletedToggle.checked = isCompletedFlag || hasCompletedTag;

        if (isReviewedToggle) {
            isReviewedToggle.checked = Boolean(currentEditingBook.is_reviewed);
        }

        const isVisibleFlag = currentEditingBook.is_visible !== 0 && activity?.is_visible !== 0;
        if (isVisibleToggle) isVisibleToggle.checked = isVisibleFlag;

        updateModalStatusBadges();

        const currentSummary = activity?.summary || activity?.notes || '';
        const currentSourceUrl = activity?.summary_source_url || '';
        notesSummaryTextarea.value = currentSummary;
        summarySourceUrlInput.value = currentSourceUrl;

        tagModal.style.display = 'flex';

        try {
            const response = await fetch(`/api/tags?_t=${Date.now()}`, { cache: 'no-cache' });
            allModalTags = await response.json();
            const bookTagIds = new Set((tags || []).map(t => t.id));

            // 완결 토글이 켜져있다면, '완결' 태그 체크박스도 기본 체크에 포함
            const completedTagObj = allModalTags.find(t => t.name === '완결');
            if (isCompletedToggle.checked && completedTagObj) {
                bookTagIds.add(completedTagObj.id);
            }

            tagCheckboxForm.innerHTML = allModalTags.map(tag => `
                <label class="tag-chip-label">
                    <input type="checkbox" name="tag" value="${tag.id}" data-tag-name="${escapeHtml(tag.name)}" ${bookTagIds.has(tag.id) ? 'checked' : ''}>
                    <span>#${escapeHtml(tag.name)}</span>
                </label>
            `).join('');

            initialModalState = {
                tags: new Set([...tagCheckboxForm.querySelectorAll('input:checked')].map(cb => parseInt(cb.value))),
                isCompleted: isCompletedToggle.checked,
                isReviewed: isReviewedToggle ? isReviewedToggle.checked : false,
                isVisible: isVisibleToggle ? isVisibleToggle.checked : true,
                summary: currentSummary,
                sourceUrl: currentSourceUrl,
            };
        } catch (error) {
            tagCheckboxForm.innerHTML = '<p style="color: var(--danger-color); font-size: 12px;">태그 목록을 불러오지 못했습니다.</p>';
        }
    }

    function closeEditModal() {
        tagModal.style.display = 'none';
        currentEditingBook = null;
        initialModalState = {};
        tagCheckboxForm.innerHTML = '';
        newTagNameInput.value = '';
        notesSummaryTextarea.value = '';
        summarySourceUrlInput.value = '';
        if (bookTocSourceUrlInput) bookTocSourceUrlInput.value = '';
        tagModalSaveBtn.disabled = false;
        tagModalSaveBtn.innerHTML = '<span class="material-icons" style="font-size: 16px;">check</span> 변경사항 저장';
    }

    function requestCloseModal() {
        const currentTags = new Set([...tagCheckboxForm.querySelectorAll('input:checked')].map(cb => parseInt(cb.value)));
        const summaryChanged = initialModalState.summary !== notesSummaryTextarea.value;
        const sourceUrlChanged = initialModalState.sourceUrl !== summarySourceUrlInput.value;
        const completedChanged = initialModalState.isCompleted !== isCompletedToggle.checked;
        const reviewedChanged = isReviewedToggle && (initialModalState.isReviewed !== isReviewedToggle.checked);
        const visibleChanged = isVisibleToggle && (initialModalState.isVisible !== isVisibleToggle.checked);
        const tagsChanged = initialModalState.tags && (
            initialModalState.tags.size !== currentTags.size ||
            [...initialModalState.tags].some(id => !currentTags.has(id))
        );

        if (tagsChanged || summaryChanged || sourceUrlChanged || completedChanged || reviewedChanged || visibleChanged) {
            if (confirm('저장하지 않은 변경사항이 있습니다. 정말로 닫으시겠습니까?')) {
                closeEditModal();
            }
        } else {
            closeEditModal();
        }
    }

    async function handleSaveModal() {
        if (!currentEditingBook) return;

        const is_completed = isCompletedToggle.checked;
        const is_reviewed = isReviewedToggle ? isReviewedToggle.checked : false;
        const reviewedChanged = isReviewedToggle && (initialModalState.isReviewed !== is_reviewed);
        const is_visible = isVisibleToggle ? isVisibleToggle.checked : true;
        const selectedCheckboxes = [...tagCheckboxForm.querySelectorAll('input[type="checkbox"]:checked')];
        let selectedTagIds = selectedCheckboxes.map(cb => parseInt(cb.value)).filter(id => !isNaN(id));

        // '완결' 태그와 완결 지정 토글 상태 동기화 보장
        if (Array.isArray(allModalTags) && allModalTags.length > 0) {
            const completedTagObj = allModalTags.find(t => t.name === '완결');
            if (completedTagObj) {
                if (is_completed && !selectedTagIds.includes(completedTagObj.id)) {
                    selectedTagIds.push(completedTagObj.id);
                } else if (!is_completed && selectedTagIds.includes(completedTagObj.id)) {
                    selectedTagIds = selectedTagIds.filter(id => id !== completedTagObj.id);
                }
            }
        }

        const summary = notesSummaryTextarea.value;
        const summary_source_url = summarySourceUrlInput.value;

        tagModalSaveBtn.disabled = true;
        tagModalSaveBtn.innerHTML = '<span class="material-icons" style="font-size: 16px;">sync</span> 저장 중...';

        const updatePromises = [
            fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/tags`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tag_ids: selectedTagIds }),
            }),
            fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/activity`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    summary,
                    summary_source_url,
                    notes: summary,
                    is_completed: is_completed,
                    is_visible: is_visible
                }),
            })
        ];

        if (reviewedChanged) {
            updatePromises.push(
                fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/review`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ is_reviewed: is_reviewed }),
                })
            );
        }

        try {
            const responses = await Promise.all(updatePromises);
            for (const res of responses) {
                if (!res.ok) throw new Error(`서버 오류 (${res.status}): ${res.statusText}`);
            }

            // 1. Optimistic Update: 즉시 메모리 및 UI 갱신 (0ms 반응)
            if (!currentEditingBook.activity) {
                currentEditingBook.activity = { folderName: currentEditingBook.name };
            }
            currentEditingBook.activity.is_completed = is_completed ? 1 : 0;
            currentEditingBook.activity.is_visible = is_visible ? 1 : 0;
            currentEditingBook.is_visible = is_visible ? 1 : 0;
            currentEditingBook.is_reviewed = is_reviewed;
            currentEditingBook.activity.summary = summary;
            currentEditingBook.activity.notes = summary;
            currentEditingBook.activity.summary_source_url = summary_source_url;

            // 태그 목록 즉시 반영
            if (Array.isArray(allModalTags)) {
                const selectedSet = new Set(selectedTagIds);
                currentEditingBook.tags = allModalTags.filter(t => selectedSet.has(t.id));
            }

            // allBooks 내 해당 도서 참조 갱신
            const bookIdx = allBooks.findIndex(b => b.name === currentEditingBook.name);
            if (bookIdx !== -1) {
                allBooks[bookIdx] = { ...currentEditingBook };
            }

            // 서재 UI 즉시 다시 그리기
            updateStatsBar();
            renderTagFilters();
            renderBooks();

            showToast(`'${currentEditingBook.name}' 설정이 저장되었습니다.`);
            closeEditModal();

            // 2. 서버 최신 상태 백그라운드 동기화
            await fetchBooks();
        } catch (error) {
            console.error('책 정보 저장 실패:', error);
            tagModalSaveBtn.disabled = false;
            tagModalSaveBtn.innerHTML = '<span class="material-icons" style="font-size: 16px;">check</span> 변경사항 저장';
            alert(`책 정보 저장 실패: ${error.message}`);
        }
    }

    async function handleAddNewTag(e) {
        e.preventDefault();
        const newName = newTagNameInput.value.trim();
        if (!newName || !currentEditingBook) return;

        try {
            const response = await fetch('/api/tags', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: newName }),
            });
            if (!response.ok) throw new Error(`서버 오류: ${response.statusText}`);
            newTagNameInput.value = '';
            await openEditModal(currentEditingBook.name);
            showToast(`새 태그 '#${newName}' 추가 완료`);
        } catch (error) {
            console.error('새 태그 추가 실패:', error);
            alert(`새 태그 추가 실패: ${error.message}`);
        }
    }

    async function handleCrawlSummary() {
        if (!currentEditingBook) return;
        const sourceUrl = summarySourceUrlInput.value.trim();
        if (!sourceUrl) {
            alert('출처 URL을 먼저 입력해주세요.');
            return;
        }

        try {
            const saveResponse = await fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/activity`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ summary_source_url: sourceUrl }),
            });
            if (!saveResponse.ok) throw new Error(`URL 저장 실패: ${saveResponse.statusText}`);

            const crawlResponse = await fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/crawl-summary`, {
                method: 'POST',
            });
            if (!crawlResponse.ok) throw new Error(`가져오기 시작 실패: ${crawlResponse.statusText}`);

            showToast('줄거리 가져오기를 요청했습니다. 잠시 후 다시 확인하세요.');
        } catch (error) {
            console.error('Crawl failed:', error);
            alert(`줄거리 가져오기 오류: ${error.message}`);
        }
    }

    async function handleSyncTocFromEditor() {
        if (!currentEditingBook) return;
        const tocUrl = bookTocSourceUrlInput ? bookTocSourceUrlInput.value.trim() : '';
        if (!tocUrl) {
            alert('목차(TOC) URL을 입력해주세요.');
            return;
        }

        if (syncTocEditorBtn) syncTocEditorBtn.disabled = true;
        showToast('TOC 목차를 가져와 순서를 동기화하는 중...', 5000);

        try {
            const tocResponse = await fetch('/api/import-toc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toc_url: tocUrl }),
            });

            if (!tocResponse.ok) {
                const errorData = await tocResponse.json();
                throw new Error(errorData.detail || 'TOC를 가져오는 데 실패했습니다.');
            }

            const tocUrls = await tocResponse.json();
            const updateResponse = await fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/urls`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: tocUrls }),
            });

            if (!updateResponse.ok) {
                const errorData = await updateResponse.json();
                throw new Error(errorData.detail || '순서 업데이트에 실패했습니다.');
            }

            const updateData = await updateResponse.json();
            showToast(updateData.message || '목차 순서 동기화 완료');
            await fetchBooks();
        } catch (error) {
            console.error('TOC sync failed:', error);
            alert(`TOC 동기화 실패: ${error.message}`);
            showToast(`동기화 실패: ${error.message}`, 4000);
        } finally {
            if (syncTocEditorBtn) syncTocEditorBtn.disabled = false;
        }
    }

    // --- URL List (Royal Archive Chapter Index) Modal Logic ---
    function highlightSearchTerm(text, query) {
        if (!query) return text;
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(${escaped})`, 'gi');
        return text.replace(regex, '<mark class="toc-search-highlight">$1</mark>');
    }

    function getFilteredAndSortedUrls() {
        const q = urlSearchInput ? urlSearchInput.value.toLowerCase().trim() : '';
        let list = modalUrls;
        if (q) {
            list = modalUrls.filter(item => {
                const titleMatch = (item.title || '').toLowerCase().includes(q);
                const urlMatch = (item.url || '').toLowerCase().includes(q);
                return titleMatch || urlMatch;
            });
        }
        return tocSortAscending ? list : [...list].reverse();
    }

    async function openUrlListModal(bookName) {
        currentModalBookName = bookName;
        currentModalBookData = allBooks.find(b => b.name === bookName) || null;
        tocSortAscending = true;
        if (tocSortLabel) tocSortLabel.textContent = '1화부터';

        urlListTitle.textContent = bookName;
        urlListBody.innerHTML = `
            <div class="toc-loading-state">
                <span class="material-icons toc-loading-gear">settings</span>
                <p class="toc-loading-title font-serif">왕립 서고 차분기관 색인 불러오는 중</p>
                <p class="toc-loading-sub font-typewriter">ARCHIVAL REGISTRY SYNCHRONIZING...</p>
            </div>
        `;
        if (urlSearchInput) {
            urlSearchInput.value = '';
            if (urlSearchClearBtn) urlSearchClearBtn.style.display = 'none';
        }
        if (tocJumpBookmarkBtn) tocJumpBookmarkBtn.disabled = true;
        urlListModal.style.display = 'flex';

        if (window.SteampunkSound) {
            window.SteampunkSound.playSwitch();
        }

        try {
            const response = await fetch(`/api/books/${encodeURIComponent(bookName)}/urls`);
            if (!response.ok) throw new Error(`Server error`);
            modalUrls = await response.json();
            renderModalUrls(getFilteredAndSortedUrls(), bookName);

            // Auto-scroll to current reading bookmark if present
            setTimeout(() => {
                const bookmarkEl = urlListBody.querySelector('.is-current-bookmark');
                if (bookmarkEl) {
                    bookmarkEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 140);
        } catch (e) {
            urlListBody.innerHTML = `
                <div class="toc-error-state">
                    <span class="material-icons toc-error-icon">error_outline</span>
                    <p class="toc-error-title font-serif">회차 목차를 불러오지 못했습니다</p>
                    <p class="toc-error-desc font-typewriter">${escapeHtml(e.message || 'Server error')}</p>
                </div>
            `;
        }
    }

    function closeUrlListModal() {
        if (urlListModal) {
            urlListModal.style.display = 'none';
            if (window.SteampunkSound) {
                window.SteampunkSound.playSwitch();
            }
        }
    }

    function renderModalUrls(urls, bookName) {
        const total = modalUrls.length;
        const reviewedCount = modalUrls.filter(u => u.is_reviewed).length;
        const reviewPct = total > 0 ? Math.round((reviewedCount / total) * 100) : 0;
        if (urlListStats) {
            const filterLabel = urls.length === total ? `총 ${total}화` : `색인 ${urls.length} / 총 ${total}화`;
            urlListStats.innerHTML = `[ ${filterLabel} <span class="toc-stat-sep">&bull;</span> <span class="toc-stat-reviewed">✅ 검수 ${reviewedCount}화 (${reviewPct}%)</span> ]`;
        }

        if (urls.length === 0) {
            urlListBody.innerHTML = `
                <div class="toc-empty-state">
                    <span class="material-icons toc-empty-icon">search_off</span>
                    <p class="toc-empty-title font-serif">해당하는 회차가 없습니다</p>
                    <p class="toc-empty-desc font-typewriter">검색어를 다시 확인하거나 정렬 방식을 변경해보세요.</p>
                    <button type="button" class="btn btn-outline btn-sm toc-empty-reset-btn" id="tocEmptyResetBtn">
                        <span class="material-icons">refresh</span> 검색어 초기화
                    </button>
                </div>
            `;
            const resetBtn = document.getElementById('tocEmptyResetBtn');
            if (resetBtn && urlSearchInput) {
                resetBtn.onclick = () => {
                    urlSearchInput.value = '';
                    if (urlSearchClearBtn) urlSearchClearBtn.style.display = 'none';
                    renderModalUrls(getFilteredAndSortedUrls(), bookName);
                    urlSearchInput.focus();
                };
            }
            return;
        }

        // Determine read bookmarks
        const lastReadTitle = currentModalBookData?.activity?.last_read_chapter_title || '';
        const lastReadPid = currentModalBookData?.activity?.last_read_pid || '';
        const isCompleted = currentModalBookData?.activity && (currentModalBookData.activity.is_completed === 1 || currentModalBookData.activity.is_completed === true);

        // Find canonical bookmark index in original modalUrls
        const origBookmarkIdx = modalUrls.findIndex(u => 
            (lastReadTitle && (u.title === lastReadTitle || u.url === lastReadTitle)) || 
            (lastReadPid && u.url === lastReadPid)
        );

        if (tocJumpBookmarkBtn) {
            tocJumpBookmarkBtn.disabled = (origBookmarkIdx === -1);
            if (origBookmarkIdx !== -1) {
                const bmChapter = modalUrls[origBookmarkIdx];
                tocJumpBookmarkBtn.title = `최근 읽은 회차로 이동 (${bmChapter.title || '회차'})`;
            } else {
                tocJumpBookmarkBtn.title = '아직 읽은 이력이 없습니다';
            }
        }

        const searchQuery = urlSearchInput ? urlSearchInput.value.trim().toLowerCase() : '';

        urlListBody.innerHTML = `
            <ul class="url-list-items">
                ${urls.map((item) => {
                    const origIdx = modalUrls.indexOf(item);
                    const originalNum = origIdx !== -1 ? origIdx + 1 : 1;
                    const paddedNum = String(originalNum).padStart(3, '0');

                    const isCurrentBookmark = (origBookmarkIdx !== -1 && origIdx === origBookmarkIdx);
                    const isRead = isCompleted || (origBookmarkIdx !== -1 && origIdx <= origBookmarkIdx);

                    const rawTitle = item.title || item.url || '무제 회차';
                    const highlightedTitle = highlightSearchTerm(escapeHtml(rawTitle), searchQuery);
                    const showUrlSub = item.title && item.url && item.title !== item.url;
                    const highlightedUrl = showUrlSub ? highlightSearchTerm(escapeHtml(item.url), searchQuery) : '';

                    return `
                        <li class="toc-chapter-entry ${isCurrentBookmark ? 'is-current-bookmark' : ''} ${isRead && !isCurrentBookmark ? 'is-read-chapter' : ''}" data-idx="${originalNum}">
                            <a href="/viewer?book=${encodeURIComponent(bookName)}&title=${encodeURIComponent(item.title || item.url)}" class="toc-chapter-link">
                                <div class="toc-chapter-prefix">
                                    <span class="toc-chapter-num font-typewriter">№ ${paddedNum}</span>
                                    ${isCurrentBookmark ? `
                                        <span class="toc-bookmark-pill font-typewriter" title="마지막으로 읽은 회차">
                                            <span class="material-icons">bookmark</span> 최근 위치
                                        </span>
                                    ` : (isRead ? `
                                        <span class="toc-read-check" title="열람 완료된 회차">
                                            <span class="material-icons">check</span>
                                        </span>
                                    ` : '')}
                                </div>
                                <div class="toc-chapter-main">
                                    <span class="toc-chapter-title">${highlightedTitle}</span>
                                    ${showUrlSub ? `<span class="toc-chapter-sub font-typewriter">${highlightedUrl}</span>` : ''}
                                </div>
                                <div class="toc-chapter-meta">
                                    <button type="button" class="toc-review-chip ${item.is_reviewed ? 'is-reviewed' : ''}" data-url="${escapeHtml(item.url)}" title="${item.is_reviewed ? '검수 완료됨 (클릭하여 검수 해제)' : '검수 대기 (클릭하여 검수 완료 지정)'}">
                                        <span class="material-icons">${item.is_reviewed ? 'check_circle' : 'radio_button_unchecked'}</span>
                                        <span class="review-label font-typewriter">${item.is_reviewed ? '검수완료' : '검수대기'}</span>
                                    </button>
                                    <span class="toc-para-badge font-typewriter" title="번역 단락 수">
                                        <span class="material-icons">article</span> ${item.count || 0} 단락
                                    </span>
                                    <span class="toc-action-arrow" title="뷰어에서 열기">
                                        <span class="material-icons">arrow_forward</span>
                                    </span>
                                </div>
                            </a>
                        </li>
                    `;
                }).join('')}
            </ul>
        `;
    }

    // TOC Modal Review Chip click delegation
    if (urlListBody) {
        urlListBody.addEventListener('click', async (e) => {
            const reviewChip = e.target.closest('.toc-review-chip');
            if (!reviewChip) return;
            e.preventDefault();
            e.stopPropagation();

            const url = reviewChip.dataset.url;
            if (!url || !currentModalBookName) return;

            const targetItem = modalUrls.find(u => u.url === url);
            if (!targetItem) return;

            const newReviewedState = !targetItem.is_reviewed;
            reviewChip.disabled = true;

            try {
                const resp = await fetch('/api/chapters/review', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        url: url,
                        is_reviewed: newReviewedState,
                        folder_name: currentModalBookName
                    })
                });
                if (!resp.ok) throw new Error('회차 검수 상태 변경 실패');
                const data = await resp.json();

                targetItem.is_reviewed = newReviewedState;

                // 도서 전체 검수 승격 여부 처리
                if (data.book_promoted) {
                    showToast(`🎉 모든 회차가 검수 완료되어 '${currentModalBookName}' 소설이 검수완료 상태로 자동 승격되었습니다!`, 4000);
                    if (currentModalBookData) currentModalBookData.is_reviewed = true;
                    const bookInList = allBooks.find(b => b.name === currentModalBookName);
                    if (bookInList) bookInList.is_reviewed = true;
                    updateStatsBar();
                    renderBooks();
                } else if (!newReviewedState && currentModalBookData?.is_reviewed) {
                    currentModalBookData.is_reviewed = false;
                    const bookInList = allBooks.find(b => b.name === currentModalBookName);
                    if (bookInList) bookInList.is_reviewed = false;
                    updateStatsBar();
                    renderBooks();
                }

                renderModalUrls(getFilteredAndSortedUrls(), currentModalBookName);
                showToast(`회차 ${newReviewedState ? '검수 완료 (잠금)' : '검수 해제'} 처리되었습니다.`);
            } catch (err) {
                console.error('Chapter review toggle failed:', err);
                showToast(`검수 상태 변경 실패: ${err.message}`, 3000);
                reviewChip.disabled = false;
            }
        });
    }

    if (urlSearchInput) {
        urlSearchInput.addEventListener('input', (e) => {
            const q = e.target.value;
            if (urlSearchClearBtn) {
                urlSearchClearBtn.style.display = q ? 'block' : 'none';
            }
            renderModalUrls(getFilteredAndSortedUrls(), currentModalBookName);
        });
    }

    if (urlSearchClearBtn) {
        urlSearchClearBtn.addEventListener('click', () => {
            if (urlSearchInput) {
                urlSearchInput.value = '';
                urlSearchClearBtn.style.display = 'none';
                renderModalUrls(getFilteredAndSortedUrls(), currentModalBookName);
                urlSearchInput.focus();
            }
        });
    }

    if (tocSortToggleBtn) {
        tocSortToggleBtn.addEventListener('click', () => {
            tocSortAscending = !tocSortAscending;
            if (tocSortLabel) {
                tocSortLabel.textContent = tocSortAscending ? '1화부터' : '최신화부터';
            }
            if (window.SteampunkSound) {
                window.SteampunkSound.playSwitch();
            }
            renderModalUrls(getFilteredAndSortedUrls(), currentModalBookName);
        });
    }

    if (tocJumpBookmarkBtn) {
        tocJumpBookmarkBtn.addEventListener('click', () => {
            const bookmarkEl = urlListBody.querySelector('.is-current-bookmark');
            if (bookmarkEl) {
                bookmarkEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                bookmarkEl.classList.remove('highlight-flash');
                void bookmarkEl.offsetWidth; // trigger reflow
                bookmarkEl.classList.add('highlight-flash');
                if (window.SteampunkSound) {
                    window.SteampunkSound.playLever();
                }
            } else {
                showToast('최근 읽은 회차를 찾을 수 없습니다.');
            }
        });
    }

    if (tocScrollTopBtn) {
        tocScrollTopBtn.addEventListener('click', () => {
            urlListBody.scrollTo({ top: 0, behavior: 'smooth' });
            if (window.SteampunkSound) {
                window.SteampunkSound.playPageFlip();
            }
        });
    }

    async function handleImportToc() {
        const bookName = currentModalBookName || urlListTitle.textContent.split(' - ')[0];
        if (!bookName) {
            alert('책 이름을 확인할 수 없습니다.');
            return;
        }

        const tocUrl = prompt('목차(TOC) 원본 URL을 입력하세요 (카쿠요무, 소설가가 되자 등):');
        if (!tocUrl) return;

        urlListBody.innerHTML = `
            <div class="toc-loading-state">
                <span class="material-icons toc-loading-gear">sync</span>
                <p class="toc-loading-title font-serif">목차 수집 및 순서 정렬 적용 중...</p>
                <p class="toc-loading-sub font-typewriter">CONNECTING TO SOURCE REGISTRY</p>
            </div>
        `;

        try {
            const tocResponse = await fetch('/api/import-toc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toc_url: tocUrl }),
            });

            if (!tocResponse.ok) {
                const errorData = await tocResponse.json();
                throw new Error(errorData.detail || 'TOC를 가져오는 데 실패했습니다.');
            }

            const tocUrls = await tocResponse.json();
            const updateResponse = await fetch(`/api/books/${encodeURIComponent(bookName)}/urls`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: tocUrls }),
            });

            if (!updateResponse.ok) {
                const errorData = await updateResponse.json();
                throw new Error(errorData.detail || '순서 업데이트에 실패했습니다.');
            }

            const updateData = await updateResponse.json();
            showToast(updateData.message || '목차 순서 동기화 완료');
            await openUrlListModal(bookName);
            await fetchBooks();
        } catch (error) {
            urlListBody.innerHTML = `
                <div class="toc-error-state">
                    <span class="material-icons toc-error-icon">error</span>
                    <p class="toc-error-title font-serif">TOC 동기화 실패</p>
                    <p class="toc-error-desc font-typewriter">${escapeHtml(error.message)}</p>
                </div>
            `;
            alert(`TOC 가져오기 실패: ${error.message}`);
        }
    }

    // --- Background Tasks (Missing Titles & Offline Download) ---
    function pollTaskStatus(taskId) {
        if (taskPollInterval) clearInterval(taskPollInterval);

        taskPollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/task_status/${taskId}`);
                if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
                const data = await response.json();

                progressContainer.style.display = 'flex';

                if (data.state === 'PROGRESS') {
                    const percentage = data.meta.percentage || 0;
                    progressBar.style.width = `${percentage}%`;
                    progressText.textContent = `진행 중: ${data.meta.current || 0} / ${data.meta.total || 0}`;
                } else if (data.state === 'SUCCESS' || data.state === 'Completed') {
                    clearInterval(taskPollInterval);
                    taskPollInterval = null;
                    progressBar.style.width = '100%';
                    progressText.textContent = '작업 완료!';
                    showToast('누락된 제목 수집이 완료되었습니다.');
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                        fetchBooks();
                    }, 2500);
                } else if (data.state === 'FAILURE') {
                    clearInterval(taskPollInterval);
                    taskPollInterval = null;
                    progressText.textContent = `오류: ${data.status}`;
                    progressBar.style.backgroundColor = 'var(--danger-color)';
                }
            } catch (error) {
                console.error('Task poll failed:', error);
                clearInterval(taskPollInterval);
                taskPollInterval = null;
            }
        }, 2000);
    }

    async function handleFetchMissingTitles() {
        fetchMissingTitlesBtn.disabled = true;
        progressText.textContent = '누락된 제목 수집 시작 중...';
        progressContainer.style.display = 'flex';
        progressBar.style.width = '0%';

        try {
            const response = await fetch('/fetch_missing_titles', { method: 'POST' });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            const data = await response.json();

            if (data.task_id) {
                pollTaskStatus(data.task_id);
            } else {
                progressText.textContent = data.message || '작업이 시작되지 않았습니다.';
                setTimeout(() => {
                    progressContainer.style.display = 'none';
                }, 3000);
            }
        } catch (error) {
            console.error('Fetch titles failed:', error);
            showToast(`오류: ${error.message}`);
            progressContainer.style.display = 'none';
        } finally {
            fetchMissingTitlesBtn.disabled = false;
        }
    }

    async function handleDownloadAllOffline() {
        if (!confirm('모든 책의 회차 콘텐츠를 브라우저 캐시에 저장합니다. 진행하시겠습니까?')) return;

        downloadAllBtn.disabled = true;
        showToast('모든 책 오프라인 다운로드를 시작합니다.');

        try {
            const response = await fetch('/api/books');
            if (!response.ok) throw new Error(`책 목록 로딩 실패: ${response.statusText}`);
            const books = await response.json();

            let downloadedCount = 0;
            let totalCount = 0;

            for (const book of books) {
                try {
                    const urlsRes = await fetch(`/api/books/${encodeURIComponent(book.name)}/urls`);
                    if (urlsRes.ok) {
                        const urls = await urlsRes.json();
                        totalCount += urls.length;
                        for (const u of urls) {
                            await fetch(`/api/books/${encodeURIComponent(book.name)}/chapter?title=${encodeURIComponent(u.title || u.url)}`);
                            downloadedCount++;
                        }
                    }
                } catch (err) {
                    console.warn(`책 '${book.name}' 다운로드 실패:`, err);
                }
            }
            showToast(`오프라인 다운로드 완료 (${downloadedCount}/${totalCount} 챕터)`);
        } catch (error) {
            console.error('Offline download failed:', error);
            showToast(`오프라인 다운로드 실패: ${error.message}`);
        } finally {
            downloadAllBtn.disabled = false;
        }
    }

    // --- Tactile Card Hover Audio ---
    function attachCardHoverSounds() {
        if (!bookShelf) return;
        const cards = bookShelf.querySelectorAll('.book-card');
        cards.forEach(card => {
            card.addEventListener('mouseenter', () => {
                const now = Date.now();
                if (now - lastSfxHoverTime > 80) {
                    lastSfxHoverTime = now;
                    if (window.SteampunkSound && typeof window.SteampunkSound.playKeyClick === 'function') {
                        window.SteampunkSound.playKeyClick();
                    }
                }
            });
        });
    }

    // --- Interactive Manometer & Status Tab Unified Filter Engine ---
    function setStatusFilter(filterStatus, triggerBounce = true) {
        if (!filterStatus) return;
        activeStatusFilter = filterStatus;

        // 1. Sync Status Tab Buttons
        statusTabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.status === filterStatus);
        });

        // 2. Sync 5-Gauge Manometer Rack Cards
        const manometerCards = document.querySelectorAll('.manometer-gauge-card.interactive-gauge');
        manometerCards.forEach(card => {
            const isMatch = card.dataset.filter === filterStatus;
            card.classList.toggle('active', isMatch);
            if (isMatch && triggerBounce) {
                const needle = card.querySelector('.manometer-needle');
                if (needle) {
                    needle.classList.remove('needle-spring-bounce');
                    void needle.offsetWidth; // Reflow to re-trigger CSS animation
                    needle.classList.add('needle-spring-bounce');
                }
            }
        });

        // 3. Audio Feedback
        if (window.SteampunkSound) {
            window.SteampunkSound.playSwitch();
            window.SteampunkSound.playKeyClick();
        }

        renderBooks();
    }

    // --- Main Steam Valve & Difference Engine Accelerated Gear Rig ---
    let valveAngle = 0;
    const mainSteamValve = document.getElementById('mainSteamValve');
    const steamPuffEmitter = document.getElementById('steamPuffEmitter');
    const steamGearCluster = document.querySelector('.steam-gear-cluster');

    function triggerSteamVent() {
        valveAngle += 180;
        if (mainSteamValve) {
            mainSteamValve.style.transform = `rotate(${valveAngle}deg)`;
        }

        // Acoustic Steam Venting Audio
        if (window.SteampunkSound) {
            window.SteampunkSound.playSteamVent();
        }

        // Animated Steam Puff Cloud Emitter
        if (steamPuffEmitter) {
            steamPuffEmitter.innerHTML = '';
            for (let i = 0; i < 6; i++) {
                const puff = document.createElement('div');
                puff.className = 'steam-puff-particle';
                puff.style.left = `${10 + Math.random() * 20}px`;
                puff.style.animationDelay = `${i * 65}ms`;
                puff.style.setProperty('--drift-x', `${(Math.random() - 0.5) * 50}px`);
                puff.style.setProperty('--scale-mult', `${0.8 + Math.random() * 0.7}`);
                steamPuffEmitter.appendChild(puff);
                setTimeout(() => puff.remove(), 1400);
            }
        }

        // Accelerate Escapement Gears for 3 seconds
        if (steamGearCluster) {
            steamGearCluster.classList.add('gears-accelerated');
            setTimeout(() => {
                steamGearCluster.classList.remove('gears-accelerated');
            }, 3000);
        }

        showToast('차분기관 메인 밸브 개방: 증기 압력 분출 및 기어 고속 연산');
    }

    if (mainSteamValve) {
        mainSteamValve.addEventListener('click', triggerSteamVent);
    }

    // --- Keyboard Shortcuts (1~5: Manometer Filters, V: Steam Valve) ---
    window.addEventListener('keydown', (e) => {
        const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

        if (e.key === '1') setStatusFilter('all');
        else if (e.key === '2') setStatusFilter('pinned');
        else if (e.key === '3') setStatusFilter('reading');
        else if (e.key === '4') setStatusFilter('unread');
        else if (e.key === '5') setStatusFilter('completed');
        else if (e.key && e.key.toLowerCase() === 'v') triggerSteamVent();
    });

    // --- Global Click Event Delegation ---
    document.addEventListener('click', (e) => {
        const target = e.target;
        const closestBtn = (selector) => target.closest(selector);

        // 1. Manometer interactive gauge click
        const gaugeCard = closestBtn('.manometer-gauge-card.interactive-gauge');
        if (gaugeCard) {
            const filterVal = gaugeCard.dataset.filter;
            if (filterVal) {
                setStatusFilter(filterVal, true);
            }
            return;
        }

        // 2. Status filter tab click
        const statusBtn = closestBtn('.status-tab-btn');
        if (statusBtn) {
            const statusVal = statusBtn.dataset.status;
            if (statusVal) {
                setStatusFilter(statusVal, true);
            }
            return;
        }

        // 3. Tag filter click
        const tagFilter = closestBtn('.tag-filter');
        if (tagFilter) {
            const tagVal = tagFilter.dataset.tag;
            activeTagFilter = tagVal === 'null' ? null : tagVal;
            document.querySelectorAll('.tag-filter').forEach(el => {
                el.classList.toggle('active', el.dataset.tag === tagVal);
            });
            renderBooks();
            return;
        }

        // 3. Pin button on card
        const pinBtn = closestBtn('[data-action="pin"]');
        if (pinBtn) {
            e.stopPropagation();
            const bookName = pinBtn.dataset.bookName;
            if (bookName) togglePin(bookName);
            return;
        }

        // 4. Read button
        const readBtn = closestBtn('[data-action="read"]');
        if (readBtn) {
            e.stopPropagation();
            const bookName = readBtn.dataset.bookName;
            window.location.href = `/viewer?book=${encodeURIComponent(bookName)}`;
            return;
        }

        // 5. TOC button
        const tocBtn = closestBtn('[data-action="toc"]');
        if (tocBtn) {
            e.stopPropagation();
            const bookName = tocBtn.dataset.bookName;
            openUrlListModal(bookName);
            return;
        }

        // 6. Edit button
        const editBtn = closestBtn('[data-action="edit"]');
        if (editBtn) {
            e.stopPropagation();
            const bookName = editBtn.dataset.bookName;
            openEditModal(bookName);
            return;
        }

        // 7. Click 3D tome spine on mahogany shelf
        const tomeSpine = closestBtn('.tome-spine-item');
        if (tomeSpine && !target.closest('button') && !target.closest('a')) {
            const bookName = tomeSpine.dataset.bookName;
            if (bookName) {
                openTomeModal(bookName);
                return;
            }
        }

        // 8. Click card or list row background to read
        const bookCard = closestBtn('.book-card');
        const bookListRow = closestBtn('.book-list-row');
        if ((bookCard || bookListRow) && !target.closest('button') && !target.closest('a') && !target.closest('input')) {
            const el = bookCard || bookListRow;
            const bookName = el.dataset.bookName;
            window.location.href = `/viewer?book=${encodeURIComponent(bookName)}`;
            return;
        }

        // 9. Modal save / close handlers (closest matching for icon/text click resilience)
        const clickedSaveBtn = target.closest('#tag-editor-save');
        if (clickedSaveBtn) {
            e.preventDefault();
            e.stopPropagation();
            handleSaveModal();
            return;
        }

        const clickedCancelBtn = target.closest('#tag-editor-cancel');
        const clickedCloseBtn = target.closest('#tag-editor-close');
        if (clickedCancelBtn || clickedCloseBtn) {
            e.preventDefault();
            e.stopPropagation();
            requestCloseModal();
            return;
        }

        if (target.closest('#tomeModalCloseBtn') || target === tomeModal) {
            closeTomeModal();
            return;
        }

        if (target.closest('#url-list-close') || target.closest('#url-list-close-bottom') || target === urlListModal) {
            closeUrlListModal();
            return;
        }
    });

    // Close modals on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (urlListModal && urlListModal.style.display !== 'none') {
                closeUrlListModal();
            } else if (tomeModal && tomeModal.style.display !== 'none') {
                closeTomeModal();
            }
        }
    });

    // --- View Mode Toggle Events (Grid / List / 3D Shelf) ---
    if (btnViewShelf) {
        btnViewShelf.addEventListener('click', () => setViewMode('shelf'));
    }
    if (btnViewGrid) {
        btnViewGrid.addEventListener('click', () => setViewMode('grid'));
    }
    if (btnViewList) {
        btnViewList.addEventListener('click', () => setViewMode('list'));
    }

    // --- Search & Sort Events ---
    if (bookSearchInput) {
        bookSearchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim();
            if (searchClearBtn) {
                searchClearBtn.style.display = searchQuery ? 'block' : 'none';
            }
            renderBooks();
        });
    }

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            bookSearchInput.value = '';
            searchQuery = '';
            searchClearBtn.style.display = 'none';
            renderBooks();
            bookSearchInput.focus();
        });
    }

    if (sortDropdown) {
        sortDropdown.addEventListener('change', (e) => {
            currentSort = e.target.value;
            renderBooks();
        });
    }

    // Other Form Listeners
    if (newTagForm) newTagForm.addEventListener('submit', handleAddNewTag);
    if (crawlSummaryBtn) crawlSummaryBtn.addEventListener('click', handleCrawlSummary);
    if (syncTocEditorBtn) syncTocEditorBtn.addEventListener('click', handleSyncTocFromEditor);
    if (importTocBtn) importTocBtn.addEventListener('click', handleImportToc);
    if (fetchMissingTitlesBtn) fetchMissingTitlesBtn.addEventListener('click', handleFetchMissingTitles);
    if (downloadAllBtn) downloadAllBtn.addEventListener('click', handleDownloadAllOffline);

    // Completion & Visibility Toggle Real-Time Sync & Status Badge Updates
    if (isCompletedToggle) {
        isCompletedToggle.addEventListener('change', () => {
            updateModalStatusBadges();
            const completedCb = tagCheckboxForm.querySelector('input[data-tag-name="완결"]');
            if (completedCb) {
                completedCb.checked = isCompletedToggle.checked;
            }
        });
    }

    if (isVisibleToggle) {
        isVisibleToggle.addEventListener('change', () => {
            updateModalStatusBadges();
        });
    }

    if (tagCheckboxForm) {
        tagCheckboxForm.addEventListener('change', (e) => {
            if (e.target && e.target.dataset && e.target.dataset.tagName === '완결') {
                if (isCompletedToggle) {
                    isCompletedToggle.checked = e.target.checked;
                    updateModalStatusBadges();
                }
            }
        });
    }

    // Modal Action Buttons Direct Click Listeners
    if (tagModalSaveBtn) {
        tagModalSaveBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleSaveModal();
        });
    }
    if (tagModalCancelBtn) {
        tagModalCancelBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            requestCloseModal();
        });
    }
    if (tagModalCloseBtn) {
        tagModalCloseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            requestCloseModal();
        });
    }

    // Initializations
    initTheme();
    setViewMode(currentViewMode);
    fetchBooks();
});