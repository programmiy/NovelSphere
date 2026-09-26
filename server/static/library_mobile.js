// ==========================================================================
// LANOVEL Mobile Dedicated Script (library_mobile.js)
// v2.1 - Offline-First Local Caching & Auto-Sync Engine
// ==========================================================================

document.addEventListener('DOMContentLoaded', () => {
    // --- State ---
    let allBooks = [];
    let activeTagFilter = null;
    let activeStatusFilter = 'all'; // 'all', 'pinned', 'reading', 'unread', 'completed'
    let searchQuery = '';
    let currentSort = 'recent'; // 'recent', 'pinned', 'name_asc', 'chapters_desc'
    let currentViewMode = localStorage.getItem('lanovel_mobile_view_mode') || 'grid'; // 'grid' | 'list'
    let currentEditingBook = null;
    let allModalTags = [];
    let initialModalState = {};
    let modalUrls = [];

    const CACHE_KEY = 'lanovel_mobile_books_cache';

    // --- DOM Elements ---
    const offlineBanner = document.getElementById('offline-banner');
    const mBookShelf = document.getElementById('mBookShelf');
    const mHeroContinue = document.getElementById('mobile-hero-continue');
    const mTagFilterBar = document.getElementById('m-tag-filter-bar');
    const mBookSearchInput = document.getElementById('mBookSearchInput');
    const mSearchClearBtn = document.getElementById('mSearchClearBtn');
    const mSortDropdown = document.getElementById('mSortDropdown');
    const mBtnViewGrid = document.getElementById('mBtnViewGrid');
    const mBtnViewList = document.getElementById('mBtnViewList');
    const mDarkModeToggle = document.getElementById('mDarkModeToggle');
    const mMenuToggleBtn = document.getElementById('mMenuToggleBtn');
    const mActionSheet = document.getElementById('mActionSheet');
    const mActionSheetBackdrop = document.getElementById('mActionSheetBackdrop');
    const mActionSheetClose = document.getElementById('mActionSheetClose');

    // Stats Elements
    const statTotalBooks = document.getElementById('statTotalBooks');
    const statPinnedBooks = document.getElementById('statPinnedBooks');
    const statReadingBooks = document.getElementById('statReadingBooks');
    const statUnreadBooks = document.getElementById('statUnreadBooks');
    const statCompletedBooks = document.getElementById('statCompletedBooks');
    const statHiddenBooks = document.getElementById('statHiddenBooks');
    const mStatChips = document.querySelectorAll('.m-stat-chip');

    // Tag Editor Modal Elements
    const tagModal = document.getElementById('m-tag-editor-modal');
    const tagModalBookName = document.getElementById('m-tag-editor-book-name');
    const isVisibleToggle = document.getElementById('m-book-is-visible-toggle');
    const isCompletedToggle = document.getElementById('m-book-is-completed-toggle');
    const tagCheckboxForm = document.getElementById('m-tag-checkbox-form');
    const newTagForm = document.getElementById('m-new-tag-form');
    const newTagNameInput = document.getElementById('m-new-tag-name');
    const notesSummaryTextarea = document.getElementById('m-book-notes-summary');
    const tagModalCloseBtn = document.getElementById('m-tag-editor-close');
    const tagModalCancelBtn = document.getElementById('m-tag-editor-cancel');
    const tagModalSaveBtn = document.getElementById('m-tag-editor-save');

    // TOC Modal Elements
    const urlListModal = document.getElementById('m-url-list-modal');
    const urlListTitle = document.getElementById('m-url-list-title');
    const urlListBody = document.getElementById('m-urlListBody');
    const urlListStats = document.getElementById('m-urlListStats');
    const urlSearchInput = document.getElementById('m-urlSearchInput');
    const urlListCloseBtn = document.getElementById('m-url-list-close');
    const mImportTocBtn = document.getElementById('m-import-toc-btn');

    // Summary Crawl & TOC Sync in Edit Modal
    const mBookSummarySourceUrl = document.getElementById('m-book-summary-source-url');
    const mCrawlSummaryBtn = document.getElementById('m-crawl-summary-btn');
    const mBookTocSourceUrl = document.getElementById('m-book-toc-source-url');
    const mSyncTocBtn = document.getElementById('m-sync-toc-btn');

    // Menu Item Actions
    const mFetchMissingTitlesBtn = document.getElementById('m-fetch-missing-titles-btn');
    const mDownloadAllBtn = document.getElementById('m-download-all-btn');

    // --- Utilities ---
    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
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
        return `${date.getMonth() + 1}.${date.getDate()}`;
    }

    function showToast(message, duration = 2500) {
        const toast = document.getElementById('m-global-toast');
        if (!toast) return;
        toast.textContent = message;
        toast.style.display = 'block';
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => {
            toast.style.display = 'none';
        }, duration);
    }

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
        if (!mDarkModeToggle) return;
        const isDark = document.body.classList.contains('dark-mode');
        mDarkModeToggle.innerHTML = `<span class="material-icons">${isDark ? 'light_mode' : 'dark_mode'}</span>`;
    }

    if (mDarkModeToggle) {
        mDarkModeToggle.addEventListener('click', () => {
            const isDark = document.body.classList.toggle('dark-mode');
            localStorage.setItem('darkMode', isDark);
            updateThemeIcon();
            showToast(isDark ? '다크 모드 적용' : '라이트 모드 적용');
        });
    }

    // --- View Mode Management (2-Column Grid vs 1-Column List) ---
    function setViewMode(mode) {
        currentViewMode = mode;
        localStorage.setItem('lanovel_mobile_view_mode', mode);

        if (mBtnViewGrid) mBtnViewGrid.classList.toggle('active', mode === 'grid');
        if (mBtnViewList) mBtnViewList.classList.toggle('active', mode === 'list');

        if (mBookShelf) {
            mBookShelf.classList.toggle('grid-mode', mode === 'grid');
            mBookShelf.classList.toggle('list-mode', mode === 'list');
        }

        renderBooks();
    }

    if (mBtnViewGrid) mBtnViewGrid.addEventListener('click', () => setViewMode('grid'));
    if (mBtnViewList) mBtnViewList.addEventListener('click', () => setViewMode('list'));

    // --- Progress Calculation ---
    function calculateProgress(book) {
        const total = book.chapter_count || 0;
        const activity = book.activity;
        const isCompleted = activity && (activity.is_completed === 1 || activity.is_completed === true);
        const lastReadTitle = activity?.last_read_chapter_title || '';
        const lastReadPid = activity?.last_read_pid || '';
        const hasHistory = Boolean(lastReadTitle || lastReadPid);

        if (!hasHistory) {
            return {
                isUnread: true,
                isCompleted: false,
                percentage: 0,
                currentNum: 0,
                totalChapters: total,
                displayChapter: '미열람',
                rawTitle: ''
            };
        }

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
            displayChapter: lastReadTitle || (lastReadPid ? `위치: ${lastReadPid}` : '읽는 중'),
            rawTitle: lastReadTitle
        };
    }

    // --- Offline-First Caching & Auto-Sync Engine ---
    function loadCachedBooks() {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (raw) {
                allBooks = JSON.parse(raw);
                updateStatsBar();
                renderTagFilters();
                renderBooks();
                return true;
            }
        } catch (e) {
            console.warn('Failed to load local cached books:', e);
        }
        return false;
    }

    async function syncBooksFromServer() {
        try {
            const response = await fetch(`/api/books?include_hidden=true&_t=${Date.now()}`, {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache'
                }
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const freshBooks = await response.json();

            allBooks = freshBooks;
            localStorage.setItem(CACHE_KEY, JSON.stringify(freshBooks));
            if (offlineBanner) offlineBanner.style.display = 'none';

            updateStatsBar();
            renderTagFilters();
            renderBooks();
        } catch (error) {
            console.warn('Network sync failed. Fallback to local cache:', error);
            // 서버 연결 끊김 시 오류 화면 대신 오프라인 배너만 표시하고 로컬 데이터 유지!
            if (offlineBanner) offlineBanner.style.display = 'flex';
            if (allBooks.length === 0) {
                mBookShelf.innerHTML = `
                    <div class="m-empty-shelf">
                        <span class="material-icons" style="color: var(--warning-color);">cloud_off</span>
                        <p style="font-weight: 700; color: var(--text-color);">서버에 연결할 수 없습니다.</p>
                        <p style="font-size: 11px; margin-top: 4px; color: var(--text-muted);">저장된 캐시 데이터가 없습니다. 온라인 상태에서 한 번 접속해주세요.</p>
                    </div>
                `;
            }
        }
    }

    // --- Stats Bar Update ---
    function updateStatsBar() {
        const visibleBooks = allBooks.filter(b => b.is_visible !== 0);
        const hiddenCount = allBooks.filter(b => b.is_visible === 0).length;

        const total = visibleBooks.length;
        const pinned = visibleBooks.filter(b => b.pinned).length;
        const unread = visibleBooks.filter(b => !b.activity || (!b.activity.last_read_pid && !b.activity.last_read_chapter_title)).length;
        const completed = visibleBooks.filter(b => b.activity && (b.activity.is_completed === 1 || b.activity.is_completed === true)).length;
        const reading = visibleBooks.filter(b => b.activity && (b.activity.last_read_pid || b.activity.last_read_chapter_title) && !(b.activity.is_completed === 1 || b.activity.is_completed === true)).length;

        if (statTotalBooks) statTotalBooks.textContent = total;
        if (statPinnedBooks) statPinnedBooks.textContent = pinned;
        if (statReadingBooks) statReadingBooks.textContent = reading;
        if (statUnreadBooks) statUnreadBooks.textContent = unread;
        if (statCompletedBooks) statCompletedBooks.textContent = completed;
        if (statHiddenBooks) statHiddenBooks.textContent = hiddenCount;
    }

    // --- Tag Filters ---
    function renderTagFilters() {
        const allTags = new Map();
        allBooks.forEach(book => {
            (book.tags || []).forEach(tag => allTags.set(tag.name, tag));
        });
        const sortedTags = [...allTags.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));

        let filtersHtml = `
            <button class="m-tag-filter ${!activeTagFilter ? 'active' : ''}" data-tag="null">전체</button>
        `;

        filtersHtml += sortedTags.map(tag => `
            <button class="m-tag-filter ${activeTagFilter === tag.name ? 'active' : ''}" data-tag="${escapeHtml(tag.name)}">
                #${escapeHtml(tag.name)}
            </button>
        `).join('');

        mTagFilterBar.innerHTML = filtersHtml;
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
                list = list.filter(b => b.activity && (b.activity.last_read_pid || b.activity.last_read_chapter_title) && !(b.activity.is_completed === 1 || b.activity.is_completed === true));
            } else if (activeStatusFilter === 'unread') {
                list = list.filter(b => !b.activity || (!b.activity.last_read_pid && !b.activity.last_read_chapter_title));
            } else if (activeStatusFilter === 'completed') {
                list = list.filter(b => b.activity && (b.activity.is_completed === 1 || b.activity.is_completed === true));
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

    // --- Hero Continue Reading Section (높이 ~80px 콤팩트 카드) ---
    function renderHeroSection() {
        if (!mHeroContinue) return;

        const readBooks = allBooks.filter(b => b.activity && b.activity.last_read_timestamp && (b.activity.last_read_chapter_title || b.activity.last_read_pid));
        if (readBooks.length === 0) {
            mHeroContinue.style.display = 'none';
            mHeroContinue.innerHTML = '';
            return;
        }

        readBooks.sort((a, b) => (b.activity.last_read_timestamp || 0) - (a.activity.last_read_timestamp || 0));
        const heroBook = readBooks[0];
        const progress = calculateProgress(heroBook);
        const timeAgo = formatTimeAgo(heroBook.activity.last_read_timestamp);
        const isCompleted = heroBook.activity && (heroBook.activity.is_completed === 1 || heroBook.activity.is_completed === true);

        mHeroContinue.innerHTML = `
            <div class="m-hero-card">
                <div class="m-hero-left">
                    <div class="m-hero-thumb ${isCompleted ? 'completed' : ''}">
                        <span class="m-hero-thumb-badge">${isCompleted ? '완결' : '읽는중'}</span>
                        <span class="m-hero-thumb-title">${escapeHtml(heroBook.name)}</span>
                    </div>
                    <div class="m-hero-info">
                        <div class="m-hero-tag">
                            <span class="material-icons" style="font-size: 11px;">history_edu</span>
                            <span>최근 읽던 책 • ${escapeHtml(timeAgo)}</span>
                        </div>
                        <div class="m-hero-title" data-action="read" data-book-name="${escapeHtml(heroBook.name)}">
                            ${escapeHtml(heroBook.name)}
                        </div>
                        <div class="m-hero-chapter">
                            ${escapeHtml(progress.displayChapter)} (${progress.percentage}%)
                        </div>
                        <div class="m-hero-progress-track">
                            <div class="m-hero-progress-fill" style="width: ${progress.percentage}%;"></div>
                        </div>
                    </div>
                </div>

                <div class="m-hero-right">
                    <button class="m-hero-play-btn" data-action="read" data-book-name="${escapeHtml(heroBook.name)}" title="이어서 읽기">
                        <span class="material-icons">play_arrow</span>
                    </button>
                </div>
            </div>
        `;
        mHeroContinue.style.display = 'block';
    }

    // --- Book Shelf Rendering (2-Column Grid vs 1-Column List) ---
    function renderBooks() {
        renderHeroSection();

        const booksToRender = getFilteredAndSortedBooks();

        if (booksToRender.length === 0) {
            mBookShelf.innerHTML = `
                <div class="m-empty-shelf">
                    <span class="material-icons">menu_book</span>
                    <p style="font-size: 13px; font-weight: 700;">표시할 책이 없습니다.</p>
                    <p style="font-size: 11px; margin-top: 3px; color: var(--text-muted);">검색어 또는 선택한 필터를 확인해보세요.</p>
                </div>
            `;
            return;
        }

        if (currentViewMode === 'list') {
            mBookShelf.innerHTML = booksToRender.map(book => renderListRow(book)).join('');
        } else {
            mBookShelf.innerHTML = booksToRender.map(book => renderGridCard(book)).join('');
        }
    }

    // 2-Column Grid Card
    function renderGridCard(book) {
        const { name, pinned, activity = {}, chapter_count = 0 } = book;
        const progress = calculateProgress(book);
        const timeAgo = activity?.last_read_timestamp ? formatTimeAgo(activity.last_read_timestamp) : '';

        let badgeClass = 'reading';
        let badgeText = '연재중';
        if (progress.isCompleted) {
            badgeClass = 'completed';
            badgeText = '완결';
        } else if (progress.isUnread) {
            badgeClass = 'unread';
            badgeText = '미열람';
        }

        return `
        <div class="m-book-card" data-book-name="${escapeHtml(name)}">
            <div class="m-card-spine ${progress.isCompleted ? 'completed' : ''}"></div>
            <div class="m-card-top">
                <span class="m-badge ${badgeClass}">${badgeText}</span>
                <button class="m-pin-btn ${pinned ? 'pinned' : ''}" data-action="pin" data-book-name="${escapeHtml(name)}">
                    <span class="material-icons">${pinned ? 'star' : 'star_border'}</span>
                </button>
            </div>

            <div class="m-card-body">
                <div class="m-card-title" title="${escapeHtml(name)}" data-action="read" data-book-name="${escapeHtml(name)}">
                    ${escapeHtml(name)}
                </div>

                <div class="m-card-chapter" title="${escapeHtml(progress.displayChapter)}">
                    ${escapeHtml(progress.displayChapter)}
                </div>

                ${!progress.isUnread ? `
                <div class="m-card-progress-track">
                    <div class="m-card-progress-fill" style="width: ${progress.percentage}%;"></div>
                </div>
                <div class="m-card-meta">
                    <span>${progress.percentage}%</span>
                    <span>총 ${chapter_count}화</span>
                </div>
                ` : `
                <div class="m-card-meta" style="margin-top: 6px;">
                    <span>신규</span>
                    <span>총 ${chapter_count}화</span>
                </div>
                `}

                <div class="m-card-actions">
                    <button class="m-btn-read" data-action="read" data-book-name="${escapeHtml(name)}">
                        <span class="material-icons" style="font-size: 14px;">play_arrow</span> ${!progress.isUnread ? '이어보기' : '읽기'}
                    </button>
                    <button class="m-btn-icon-sub" data-action="toc" data-book-name="${escapeHtml(name)}" title="목차">
                        <span class="material-icons">list</span>
                    </button>
                    <button class="m-btn-icon-sub" data-action="edit" data-book-name="${escapeHtml(name)}" title="설정">
                        <span class="material-icons">settings</span>
                    </button>
                </div>
            </div>
        </div>
        `;
    }

    // 1-Column Compact List Row
    function renderListRow(book) {
        const { name, pinned, activity = {}, chapter_count = 0 } = book;
        const progress = calculateProgress(book);

        let badgeClass = 'reading';
        let badgeText = '연재중';
        if (progress.isCompleted) {
            badgeClass = 'completed';
            badgeText = '완결';
        } else if (progress.isUnread) {
            badgeClass = 'unread';
            badgeText = '미열람';
        }

        return `
        <div class="m-list-row" data-book-name="${escapeHtml(name)}">
            <button class="m-pin-btn ${pinned ? 'pinned' : ''}" data-action="pin" data-book-name="${escapeHtml(name)}">
                <span class="material-icons">${pinned ? 'star' : 'star_border'}</span>
            </button>

            <div class="m-list-info" data-action="read" data-book-name="${escapeHtml(name)}">
                <div class="m-list-title">${escapeHtml(name)}</div>
                <div class="m-list-sub">
                    <span class="m-badge ${badgeClass}">${badgeText}</span>
                    <span>${escapeHtml(progress.displayChapter)}</span>
                    ${!progress.isUnread ? `
                    <div class="m-list-progress-bar">
                        <div class="m-list-progress-fill" style="width: ${progress.percentage}%;"></div>
                    </div>
                    <span>${progress.percentage}%</span>
                    ` : ''}
                </div>
            </div>

            <div class="m-list-actions">
                <button class="m-btn-read" data-action="read" data-book-name="${escapeHtml(name)}" style="padding: 0 8px;">
                    <span class="material-icons" style="font-size: 14px;">play_arrow</span>
                </button>
                <button class="m-btn-icon-sub" data-action="toc" data-book-name="${escapeHtml(name)}">
                    <span class="material-icons">list</span>
                </button>
                <button class="m-btn-icon-sub" data-action="edit" data-book-name="${escapeHtml(name)}">
                    <span class="material-icons">settings</span>
                </button>
            </div>
        </div>
        `;
    }

    // --- Book Pin Action ---
    async function togglePin(folderName) {
        try {
            const response = await fetch('/api/books/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderName }),
            });
            if (!response.ok) throw new Error(`Server error`);
            const data = await response.json();
            showToast(data.message || '즐겨찾기 상태 변경 완료');
            
            // 로컬 상태 즉시 반전
            const target = allBooks.find(b => b.name === folderName);
            if (target) {
                target.pinned = !target.pinned;
                localStorage.setItem(CACHE_KEY, JSON.stringify(allBooks));
                updateStatsBar();
                renderBooks();
            }
            await syncBooksFromServer();
        } catch (error) {
            console.error('Pin toggle failed:', error);
            showToast(`오류: ${error.message}`);
        }
    }

    // --- Action Sheet (More Menu) ---
    function openActionSheet() {
        mActionSheetBackdrop.style.display = 'block';
        mActionSheet.style.display = 'flex';
    }

    function closeActionSheet() {
        mActionSheetBackdrop.style.display = 'none';
        mActionSheet.style.display = 'none';
    }

    if (mMenuToggleBtn) mMenuToggleBtn.addEventListener('click', openActionSheet);
    if (mActionSheetClose) mActionSheetClose.addEventListener('click', closeActionSheet);
    if (mActionSheetBackdrop) mActionSheetBackdrop.addEventListener('click', closeActionSheet);

    // --- Tag & Info Editor Modal (Bottom Sheet) ---
    async function openEditModal(bookName) {
        currentEditingBook = allBooks.find(b => b.name === bookName);
        if (!currentEditingBook) return;

        const { name, tags = [], activity = {} } = currentEditingBook;
        tagModalBookName.textContent = name;
        isCompletedToggle.checked = activity?.is_completed === 1 || activity?.is_completed === true;
        const isVisibleFlag = currentEditingBook.is_visible !== 0 && activity?.is_visible !== 0;
        if (isVisibleToggle) isVisibleToggle.checked = isVisibleFlag;
        notesSummaryTextarea.value = activity?.summary || activity?.notes || '';
        if (mBookSummarySourceUrl) mBookSummarySourceUrl.value = '';
        if (mBookTocSourceUrl) mBookTocSourceUrl.value = '';

        tagModal.style.display = 'block';

        try {
            const res = await fetch(`/api/tags?_t=${Date.now()}`);
            allModalTags = await res.json();
            const bookTagIds = new Set((tags || []).map(t => t.id));

            tagCheckboxForm.innerHTML = allModalTags.map(t => `
                <label class="m-tag-chip-label">
                    <input type="checkbox" name="tag" value="${t.id}" data-tag-name="${escapeHtml(t.name)}" ${bookTagIds.has(t.id) ? 'checked' : ''}>
                    <span>#${escapeHtml(t.name)}</span>
                </label>
            `).join('');

            initialModalState = {
                isCompleted: isCompletedToggle.checked,
                isVisible: isVisibleToggle ? isVisibleToggle.checked : true,
                summary: notesSummaryTextarea.value
            };
        } catch (e) {
            tagCheckboxForm.innerHTML = '<p style="color: var(--danger-color); font-size: 11px;">태그 로딩 실패</p>';
        }
    }

    function closeEditModal() {
        tagModal.style.display = 'none';
        currentEditingBook = null;
    }

    if (tagModalCloseBtn) tagModalCloseBtn.addEventListener('click', closeEditModal);
    if (tagModalCancelBtn) tagModalCancelBtn.addEventListener('click', closeEditModal);

    async function handleSaveModal() {
        if (!currentEditingBook) return;

        const is_completed = isCompletedToggle.checked;
        const is_visible = isVisibleToggle ? isVisibleToggle.checked : true;
        const selectedTagIds = [...tagCheckboxForm.querySelectorAll('input:checked')].map(cb => parseInt(cb.value));
        const summary = notesSummaryTextarea.value;

        tagModalSaveBtn.disabled = true;
        tagModalSaveBtn.textContent = '저장 중...';

        const tagsPromise = fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_ids: selectedTagIds })
        });

        const actPromise = fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/activity`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                summary,
                notes: summary,
                is_completed: is_completed,
                is_visible: is_visible
            })
        });

        try {
            const responses = await Promise.all([tagsPromise, actPromise]);
            for (const r of responses) {
                if (!r.ok) throw new Error(r.statusText);
            }

            // Optimistic UI Update & Cache Refresh
            if (!currentEditingBook.activity) currentEditingBook.activity = {};
            currentEditingBook.activity.is_completed = is_completed ? 1 : 0;
            currentEditingBook.activity.is_visible = is_visible ? 1 : 0;
            currentEditingBook.is_visible = is_visible ? 1 : 0;
            currentEditingBook.activity.summary = summary;
            currentEditingBook.activity.notes = summary;

            const selectedSet = new Set(selectedTagIds);
            currentEditingBook.tags = allModalTags.filter(t => selectedSet.has(t.id));

            const idx = allBooks.findIndex(b => b.name === currentEditingBook.name);
            if (idx !== -1) allBooks[idx] = { ...currentEditingBook };

            localStorage.setItem(CACHE_KEY, JSON.stringify(allBooks));
            updateStatsBar();
            renderBooks();

            showToast(`'${currentEditingBook.name}' 저장 완료`);
            closeEditModal();
            await syncBooksFromServer();
        } catch (err) {
            alert(`저장 실패: ${err.message}`);
        } finally {
            tagModalSaveBtn.disabled = false;
            tagModalSaveBtn.textContent = '저장하기';
        }
    }

    if (tagModalSaveBtn) tagModalSaveBtn.addEventListener('click', handleSaveModal);

    // --- TOC Modal (Bottom Sheet) ---
    async function openTocModal(bookName) {
        urlListTitle.textContent = `${bookName} 목차`;
        urlListBody.innerHTML = '<div style="text-align:center; padding: 30px; color: var(--text-muted);"><span class="material-icons" style="animation: spin 1s infinite;">sync</span><p style="margin-top:6px; font-size:12px;">목차 불러오는 중...</p></div>';
        urlListModal.style.display = 'block';

        try {
            const res = await fetch(`/api/books/${encodeURIComponent(bookName)}/urls`);
            if (!res.ok) throw new Error('목차 로드 실패');
            modalUrls = await res.json();
            renderTocList(modalUrls, bookName);
        } catch (err) {
            urlListBody.innerHTML = '<p style="text-align:center; color: var(--danger-color); padding: 20px; font-size:12px;">목차를 불러올 수 없습니다.</p>';
        }
    }

    function renderTocList(urls, bookName) {
        if (urlListStats) urlListStats.textContent = `총 ${urls.length}화`;
        if (urls.length === 0) {
            urlListBody.innerHTML = '<p style="text-align:center; padding: 20px; font-size:12px; color: var(--text-muted);">표시할 회차가 없습니다.</p>';
            return;
        }

        urlListBody.innerHTML = urls.map(u => `
            <a href="/viewer?book=${encodeURIComponent(bookName)}&title=${encodeURIComponent(u.title || u.url)}" class="m-toc-row">
                <span class="m-toc-row-title">${escapeHtml(u.title || u.url)}</span>
                <span class="m-toc-row-count">${u.count || 0} 단락</span>
            </a>
        `).join('');
    }

    if (urlListCloseBtn) urlListCloseBtn.addEventListener('click', () => { urlListModal.style.display = 'none'; });

    if (urlSearchInput) {
        urlSearchInput.addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            const filtered = modalUrls.filter(u => (u.title || u.url).toLowerCase().includes(q));
            renderTocList(filtered, urlListTitle.textContent.replace(' 목차', ''));
        });
    }

    // --- TOC Import & Order Synchronization ---
    async function executeTocSync(bookName, tocUrl) {
        if (!bookName) {
            alert('대상 책 이름을 확인할 수 없습니다.');
            return;
        }
        if (!tocUrl || !tocUrl.trim()) {
            alert('목차(TOC) URL을 입력해주세요.');
            return;
        }

        const cleanUrl = tocUrl.trim();
        showToast('TOC 목차 수집 및 동기화 중...', 6000);

        try {
            const tocResponse = await fetch('/api/import-toc', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ toc_url: cleanUrl }),
            });

            if (!tocResponse.ok) {
                const errData = await tocResponse.json();
                throw new Error(errData.detail || 'TOC를 가져오는 데 실패했습니다.');
            }

            const tocUrls = await tocResponse.json();
            const updateResponse = await fetch(`/api/books/${encodeURIComponent(bookName)}/urls`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: tocUrls }),
            });

            if (!updateResponse.ok) {
                const errData = await updateResponse.json();
                throw new Error(errData.detail || '순서 업데이트에 실패했습니다.');
            }

            const updateData = await updateResponse.json();
            showToast(updateData.message || '목차 순서 동기화 완료');

            // 목차 모달이 열려 있다면 즉시 새로고침
            if (urlListModal.style.display === 'block') {
                await openTocModal(bookName);
            }
            await syncBooksFromServer();
        } catch (error) {
            alert(`TOC 동기화 실패: ${error.message}`);
            showToast(`동기화 실패: ${error.message}`, 4000);
        }
    }

    // 목차 모달 헤더의 TOC 동기화 버튼 클릭
    if (mImportTocBtn) {
        mImportTocBtn.addEventListener('click', async () => {
            const bookName = urlListTitle.textContent.replace(' 목차', '').trim();
            if (!bookName) {
                alert('책 이름을 확인할 수 없습니다.');
                return;
            }
            const inputUrl = prompt('목차(TOC) 원본 URL을 입력하세요 (카쿠요무, 소설가가 되자, 노벨업+ 등):');
            if (inputUrl) {
                await executeTocSync(bookName, inputUrl);
            }
        });
    }

    // 소설 정보 모달 내의 TOC 동기화 버튼 클릭
    if (mSyncTocBtn) {
        mSyncTocBtn.addEventListener('click', async () => {
            if (!currentEditingBook) return;
            const inputUrl = mBookTocSourceUrl ? mBookTocSourceUrl.value.trim() : '';
            if (!inputUrl) {
                alert('TOC 목차 동기화 URL을 입력하세요.');
                return;
            }
            await executeTocSync(currentEditingBook.name, inputUrl);
        });
    }

    // 소설 정보 모달 내의 줄거리 소개 가져오기 버튼 클릭
    async function handleCrawlSummary() {
        if (!mBookSummarySourceUrl) return;
        const url = mBookSummarySourceUrl.value.trim();
        if (!url) {
            alert('소설 소개 페이지 URL을 입력하세요.');
            return;
        }

        mCrawlSummaryBtn.disabled = true;
        mCrawlSummaryBtn.textContent = '가져오는 중...';

        try {
            const res = await fetch('/api/crawl-summary', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: url })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.detail || '줄거리 가져오기 실패');
            }

            const data = await res.json();
            if (data.summary) {
                notesSummaryTextarea.value = data.summary;
                showToast('소개글을 성공적으로 가져왔습니다.');
            } else {
                alert('소개글 내용을 찾을 수 없습니다.');
            }
        } catch (e) {
            alert(`오류: ${e.message}`);
        } finally {
            mCrawlSummaryBtn.disabled = false;
            mCrawlSummaryBtn.textContent = '소개 가져오기';
        }
    }

    if (mCrawlSummaryBtn) {
        mCrawlSummaryBtn.addEventListener('click', handleCrawlSummary);
    }

    // --- Global Click Delegation ---
    document.addEventListener('click', (e) => {
        const target = e.target;
        const closestBtn = (sel) => target.closest(sel);

        // 1. Tag filter chip click
        const tagFilter = closestBtn('.m-tag-filter');
        if (tagFilter) {
            const tagVal = tagFilter.dataset.tag;
            activeTagFilter = tagVal === 'null' ? null : tagVal;
            document.querySelectorAll('.m-tag-filter').forEach(el => el.classList.toggle('active', el.dataset.tag === tagVal));
            renderBooks();
            return;
        }

        // 2. Stats chip click (원터치 상태 탭 전환)
        const statChip = closestBtn('.m-stat-chip');
        if (statChip) {
            activeStatusFilter = statChip.dataset.status;
            mStatChips.forEach(c => c.classList.toggle('active', c === statChip));
            renderBooks();
            return;
        }

        // 3. Pin button
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
            openTocModal(bookName);
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
    });

    // --- Search & Sort Events ---
    if (mBookSearchInput) {
        mBookSearchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value.trim();
            if (mSearchClearBtn) mSearchClearBtn.style.display = searchQuery ? 'block' : 'none';
            renderBooks();
        });
    }

    if (mSearchClearBtn) {
        mSearchClearBtn.addEventListener('click', () => {
            mBookSearchInput.value = '';
            searchQuery = '';
            mSearchClearBtn.style.display = 'none';
            renderBooks();
            mBookSearchInput.focus();
        });
    }

    if (mSortDropdown) {
        mSortDropdown.addEventListener('change', (e) => {
            currentSort = e.target.value;
            renderBooks();
        });
    }

    // --- Online / Offline Events ---
    window.addEventListener('online', () => {
        showToast('온라인 연결 복구: 최신 데이터 동기화 중...');
        syncBooksFromServer();
    });

    window.addEventListener('offline', () => {
        if (offlineBanner) offlineBanner.style.display = 'flex';
        showToast('오프라인 모드로 전환되었습니다.');
    });

    // --- Initial Boot Sequence (Offline-First) ---
    initTheme();
    setViewMode(currentViewMode);

    // 1. 로컬 캐시가 있으면 0ms 만에 화면 렌더링
    const hasCache = loadCachedBooks();

    // 2. 백그라운드로 서버 최신 데이터 동기화
    syncBooksFromServer();
});
