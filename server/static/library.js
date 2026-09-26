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
    const btnViewGrid = document.getElementById('btnViewGrid');
    const btnViewList = document.getElementById('btnViewList');
    const statusTabBtns = document.querySelectorAll('.status-tab-btn');
    const darkModeToggle = document.getElementById('darkModeToggle');

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

    // URL List Modal Elements
    const urlListModal = document.getElementById('url-list-modal');
    const urlListTitle = document.getElementById('url-list-title');
    const urlListBody = document.getElementById('url-list-body');
    const urlListStats = document.getElementById('urlListStats');
    const urlSearchInput = document.getElementById('urlSearchInput');
    const importTocBtn = document.getElementById('import-toc-btn');
    const urlListCloseBtn = document.getElementById('url-list-close');
    const urlListCloseBottomBtn = document.getElementById('url-list-close-bottom');

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

        if (countAll) countAll.textContent = total;
        if (countPinned) countPinned.textContent = pinned;
        if (countReading) countReading.textContent = reading;
        if (countUnread) countUnread.textContent = unread;
        if (countCompleted) countCompleted.textContent = completed;
        if (countHidden) countHidden.textContent = hiddenCount;
    }

    // --- Progress & Reading State Calculation (5번 기능) ---
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
                displayChapter: '아직 읽지 않음',
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

    // --- Hero Continue Reading Section (1번 기능) ---
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

        const readUrl = `/viewer?book=${encodeURIComponent(heroBook.name)}${progress.rawTitle ? `&title=${encodeURIComponent(progress.rawTitle)}` : ''}`;

        heroContinueReading.innerHTML = `
            <div class="hero-card">
                <!-- Left Cover Thumbnail -->
                <div class="hero-left">
                    <div class="hero-book-cover ${isCompleted ? 'completed' : ''}">
                        <div class="hero-book-cover-badge">${isCompleted ? '완결' : '읽는중'}</div>
                        <div class="hero-book-cover-title" title="${escapeHtml(heroBook.name)}">${escapeHtml(heroBook.name)}</div>
                    </div>
                </div>

                <!-- Center Info & Progress -->
                <div class="hero-center">
                    <div class="hero-badge-row">
                        <span class="hero-tag-badge">
                            <span class="material-icons" style="font-size: 13px;">history_edu</span> 최근 읽던 소설
                        </span>
                        <span class="hero-relative-time">${escapeHtml(timeAgo)} 읽음</span>
                    </div>

                    <div class="hero-book-title" data-action="read" data-book-name="${escapeHtml(heroBook.name)}" title="${escapeHtml(heroBook.name)}">
                        ${escapeHtml(heroBook.name)}
                    </div>

                    <div class="hero-chapter-info">
                        <span class="material-icons">bookmark</span>
                        <span>${escapeHtml(progress.displayChapter)}</span>
                    </div>

                    <div class="hero-progress-track">
                        <div class="hero-progress-fill" style="width: ${progress.percentage}%;"></div>
                    </div>

                    <div class="hero-progress-meta">
                        <span>진행률 <strong class="hero-progress-pct">${progress.percentage}%</strong></span>
                        <span>•</span>
                        <span>${progress.currentNum > 0 ? `제 ${progress.currentNum}화 / 총 ${progress.totalChapters}화` : `총 ${progress.totalChapters}화`}</span>
                    </div>
                </div>

                <!-- Right Action Buttons -->
                <div class="hero-right">
                    <button class="hero-continue-btn" data-action="read" data-book-name="${escapeHtml(heroBook.name)}">
                        <span class="material-icons">play_arrow</span> 이어서 읽기
                    </button>
                    <button class="hero-toc-btn" data-action="toc" data-book-name="${escapeHtml(heroBook.name)}" title="목차 보기">
                        <span class="material-icons">format_list_bulleted</span> 목차
                    </button>
                </div>
            </div>
        `;
        heroContinueReading.style.display = 'block';
    }

    // --- View Mode Management (4번 기능) ---
    function setViewMode(mode) {
        currentViewMode = mode;
        localStorage.setItem('library_view_mode', mode);

        if (btnViewGrid) btnViewGrid.classList.toggle('active', mode === 'grid');
        if (btnViewList) btnViewList.classList.toggle('active', mode === 'list');
        if (bookShelf) bookShelf.classList.toggle('list-view', mode === 'list');

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

    // --- Book Shelf Rendering (Dual: Grid vs Compact List) ---
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

        if (currentViewMode === 'list') {
            bookShelf.classList.add('list-view');
            bookShelf.innerHTML = booksToRender.map(book => renderListRow(book)).join('');
        } else {
            bookShelf.classList.remove('list-view');
            bookShelf.innerHTML = booksToRender.map(book => renderGridCard(book)).join('');
        }
    }

    // Grid Card HTML (기존 카드 + 5번 표지 오버레이 진도율)
    function renderGridCard(book) {
        const { name, pinned, tags = [], activity = {}, chapter_count = 0 } = book;
        const progress = calculateProgress(book);
        const timeAgo = activity?.last_read_timestamp ? formatTimeAgo(activity.last_read_timestamp) : '';
        const tagsHtml = tags.map(t => `<span class="tag-mini">#${escapeHtml(t.name)}</span>`).join('');

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
        <div class="book-card" data-book-name="${escapeHtml(name)}">
            <!-- Top Cover Spine Accent -->
            <div class="card-cover-spine ${progress.isCompleted ? 'completed' : ''}"></div>

            <!-- Card Top Bar: Badges & Pin -->
            <div class="card-top-bar">
                <div class="badge-group">
                    <span class="status-badge ${badgeClass}">${badgeText}</span>
                    <span class="chapter-count-badge">총 ${chapter_count}화</span>
                </div>
                <button class="pin-btn ${pinned ? 'pinned' : ''}" data-action="pin" data-book-name="${escapeHtml(name)}" title="${pinned ? '즐겨찾기 해제' : '즐겨찾기 추가'}">
                    <span class="material-icons">${pinned ? 'star' : 'star_border'}</span>
                </button>
            </div>

            <!-- Card Main Body -->
            <div class="card-main">
                <h2 class="book-card-title" title="${escapeHtml(name)}">${escapeHtml(name)}</h2>

                <!-- Last Read Indicator Box -->
                <div class="last-read-box">
                    <span class="material-icons last-read-icon">
                        ${!progress.isUnread ? 'bookmark' : 'menu_book'}
                    </span>
                    <div class="last-read-content">
                        <div class="last-read-title" title="${escapeHtml(progress.displayChapter)}">
                            ${escapeHtml(progress.displayChapter)}
                        </div>
                        ${timeAgo ? `<div class="last-read-time">${escapeHtml(timeAgo)} 읽음</div>` : ''}
                    </div>
                </div>

                <!-- Card Reading Progress Bar (5번 기능) -->
                ${!progress.isUnread ? `
                <div class="card-progress-wrap">
                    <div class="card-progress-track">
                        <div class="card-progress-fill" style="width: ${progress.percentage}%;"></div>
                    </div>
                    <div class="card-progress-labels">
                        <span>진행률 <strong class="card-progress-pct">${progress.percentage}%</strong></span>
                        <span>${progress.currentNum > 0 ? `${progress.currentNum}/${progress.totalChapters}화` : ''}</span>
                    </div>
                </div>
                ` : ''}

                <!-- Mini Tags -->
                <div class="tags-container">${tagsHtml}</div>
            </div>

            <!-- Card Bottom Actions -->
            <div class="card-actions">
                <button class="btn btn-primary btn-read" data-action="read" data-book-name="${escapeHtml(name)}">
                    <span class="material-icons">play_arrow</span> ${!progress.isUnread ? '이어보기' : '첫화 읽기'}
                </button>
                <button class="btn btn-outline btn-toc" data-action="toc" data-book-name="${escapeHtml(name)}">
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

    // --- Tag & Info Editor Modal ---
    async function openEditModal(bookName) {
        currentEditingBook = allBooks.find(b => b.name === bookName);
        if (!currentEditingBook) return;

        const { name, tags = [], activity = {} } = currentEditingBook;

        tagModalBookName.textContent = name;
        tagModalSaveBtn.disabled = false;
        tagModalSaveBtn.textContent = '저장하기';

        // 완결 플래그 또는 '완결' 태그 존재 여부 확인
        const hasCompletedTag = (tags || []).some(t => t.name === '완결');
        const isCompletedFlag = activity?.is_completed === 1 || activity?.is_completed === true;
        isCompletedToggle.checked = isCompletedFlag || hasCompletedTag;

        const isVisibleFlag = currentEditingBook.is_visible !== 0 && activity?.is_visible !== 0;
        if (isVisibleToggle) isVisibleToggle.checked = isVisibleFlag;

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
        tagModalSaveBtn.textContent = '저장하기';
    }

    function requestCloseModal() {
        const currentTags = new Set([...tagCheckboxForm.querySelectorAll('input:checked')].map(cb => parseInt(cb.value)));
        const summaryChanged = initialModalState.summary !== notesSummaryTextarea.value;
        const sourceUrlChanged = initialModalState.sourceUrl !== summarySourceUrlInput.value;
        const completedChanged = initialModalState.isCompleted !== isCompletedToggle.checked;
        const visibleChanged = isVisibleToggle && (initialModalState.isVisible !== isVisibleToggle.checked);
        const tagsChanged = initialModalState.tags && (
            initialModalState.tags.size !== currentTags.size ||
            [...initialModalState.tags].some(id => !currentTags.has(id))
        );

        if (tagsChanged || summaryChanged || sourceUrlChanged || completedChanged || visibleChanged) {
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
        const is_visible = isVisibleToggle ? isVisibleToggle.checked : true;
        const selectedCheckboxes = [...tagCheckboxForm.querySelectorAll('input[type="checkbox"]:checked')];
        let selectedTagIds = selectedCheckboxes.map(cb => parseInt(cb.value));

        // '완결' 태그와 완결 지정 토글 상태 동기화 보장
        const completedTagObj = allModalTags.find(t => t.name === '완결');
        if (completedTagObj) {
            if (is_completed && !selectedTagIds.includes(completedTagObj.id)) {
                selectedTagIds.push(completedTagObj.id);
            } else if (!is_completed && selectedTagIds.includes(completedTagObj.id)) {
                selectedTagIds = selectedTagIds.filter(id => id !== completedTagObj.id);
            }
        }

        const summary = notesSummaryTextarea.value;
        const summary_source_url = summarySourceUrlInput.value;

        tagModalSaveBtn.disabled = true;
        tagModalSaveBtn.textContent = '저장 중...';

        const tagsUpdatePromise = fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_ids: selectedTagIds }),
        });

        const activityUpdatePromise = fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/activity`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                summary,
                summary_source_url,
                notes: summary,
                is_completed: is_completed,
                is_visible: is_visible
            }),
        });

        try {
            const responses = await Promise.all([tagsUpdatePromise, activityUpdatePromise]);
            for (const res of responses) {
                if (!res.ok) throw new Error(`서버 오류: ${res.statusText}`);
            }

            // 1. Optimistic Update: 즉시 메모리 및 UI 갱신 (0ms 반응)
            if (!currentEditingBook.activity) {
                currentEditingBook.activity = { folderName: currentEditingBook.name };
            }
            currentEditingBook.activity.is_completed = is_completed ? 1 : 0;
            currentEditingBook.activity.is_visible = is_visible ? 1 : 0;
            currentEditingBook.is_visible = is_visible ? 1 : 0;
            currentEditingBook.activity.is_completed = is_completed ? 1 : 0;
            currentEditingBook.activity.summary = summary;
            currentEditingBook.activity.notes = summary;
            currentEditingBook.activity.summary_source_url = summary_source_url;

            // 태그 목록 즉시 반영
            const selectedSet = new Set(selectedTagIds);
            currentEditingBook.tags = allModalTags.filter(t => selectedSet.has(t.id));

            // allBooks 내 해당 도서 참조 갱신
            const bookIdx = allBooks.findIndex(b => b.name === currentEditingBook.name);
            if (bookIdx !== -1) {
                allBooks[bookIdx] = { ...currentEditingBook };
            }

            // 서재 UI 즉시 다시 그리기
            updateStatsBar();
            renderTagFilters();
            renderBooks();

            showToast(`'${currentEditingBook.name}' 정보가 저장되었습니다.`);
            closeEditModal();

            // 2. 서버 최신 상태 백그라운드 동기화
            await fetchBooks();
        } catch (error) {
            console.error('책 정보 저장 실패:', error);
            tagModalSaveBtn.disabled = false;
            tagModalSaveBtn.textContent = '저장하기';
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

    // --- URL List (TOC) Modal ---
    async function openUrlListModal(bookName) {
        urlListTitle.textContent = `${bookName} - 회차 목차`;
        urlListBody.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-muted);"><span class="material-icons" style="animation: spin 1s linear infinite;">sync</span><p style="margin-top: 8px;">회차 목록 로딩 중...</p></div>';
        if (urlSearchInput) urlSearchInput.value = '';
        urlListModal.style.display = 'flex';

        try {
            const response = await fetch(`/api/books/${encodeURIComponent(bookName)}/urls`);
            if (!response.ok) throw new Error(`Server error`);
            modalUrls = await response.json();
            renderModalUrls(modalUrls, bookName);
        } catch (e) {
            urlListBody.innerHTML = '<p style="color: var(--danger-color); padding: 20px; text-align: center;">URL 목록을 불러오는 데 실패했습니다.</p>';
        }
    }

    function renderModalUrls(urls, bookName) {
        if (urlListStats) {
            urlListStats.textContent = `총 ${urls.length}개 회차`;
        }

        if (urls.length === 0) {
            urlListBody.innerHTML = '<p style="color: var(--text-muted); padding: 20px; text-align: center;">표시할 회차가 없습니다.</p>';
            return;
        }

        urlListBody.innerHTML = `
            <ul class="url-list-items">
                ${urls.map((item, idx) => `
                    <li>
                        <a href="/viewer?book=${encodeURIComponent(bookName)}&title=${encodeURIComponent(item.title || item.url)}" class="url-item">
                            <span class="url-item-title">${escapeHtml(item.title || item.url)}</span>
                            <span class="url-item-badge">${item.count || 0} 단락</span>
                        </a>
                    </li>
                `).join('')}
            </ul>
        `;
    }

    if (urlSearchInput) {
        urlSearchInput.addEventListener('input', (e) => {
            const q = e.target.value.toLowerCase().trim();
            const bookName = urlListTitle.textContent.split(' - ')[0];
            const filtered = modalUrls.filter(item => {
                const titleMatch = (item.title || '').toLowerCase().includes(q);
                const urlMatch = (item.url || '').toLowerCase().includes(q);
                return titleMatch || urlMatch;
            });
            renderModalUrls(filtered, bookName);
        });
    }

    async function handleImportToc() {
        const bookName = urlListTitle.textContent.split(' - ')[0];
        if (!bookName) {
            alert('책 이름을 확인할 수 없습니다.');
            return;
        }

        const tocUrl = prompt('목차(TOC) 원본 URL을 입력하세요 (카쿠요무, 소설가가 되자 등):');
        if (!tocUrl) return;

        urlListBody.innerHTML = '<div style="text-align: center; padding: 30px; color: var(--text-muted);"><span class="material-icons">sync</span><p style="margin-top: 8px;">목차를 수집하고 정렬을 적용하는 중...</p></div>';

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
            urlListBody.innerHTML = `<p style="color: var(--danger-color); padding: 20px;">오류: ${escapeHtml(error.message)}</p>`;
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

    // --- Global Click Event Delegation ---
    document.addEventListener('click', (e) => {
        const target = e.target;
        const closestBtn = (selector) => target.closest(selector);

        // 1. Tag filter click
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

        // 2. Status filter tab click
        const statusBtn = closestBtn('.status-tab-btn');
        if (statusBtn) {
            activeStatusFilter = statusBtn.dataset.status;
            statusTabBtns.forEach(b => b.classList.toggle('active', b === statusBtn));
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

        // 7. Click card background to read
        // 7. Click card or list row background to read
        const bookCard = closestBtn('.book-card');
        const bookListRow = closestBtn('.book-list-row');
        if ((bookCard || bookListRow) && !target.closest('button') && !target.closest('a') && !target.closest('input')) {
            const el = bookCard || bookListRow;
            const bookName = el.dataset.bookName;
            window.location.href = `/viewer?book=${encodeURIComponent(bookName)}`;
            return;
        }

        // 8. Modal close handlers
        if (target === tagModalCloseBtn || target === tagModalCancelBtn) {
            requestCloseModal();
        } else if (target === tagModalSaveBtn) {
            handleSaveModal();
        } else if (target === urlListCloseBtn || target === urlListCloseBottomBtn) {
            urlListModal.style.display = 'none';
        }
    });

    // --- View Mode Toggle Events (4번 기능) ---
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

    // Completion Toggle & '#완결' Tag Auto-Sync
    if (isCompletedToggle) {
        isCompletedToggle.addEventListener('change', () => {
            const completedCb = tagCheckboxForm.querySelector('input[data-tag-name="완결"]');
            if (completedCb) {
                completedCb.checked = isCompletedToggle.checked;
            }
        });
    }

    if (tagCheckboxForm) {
        tagCheckboxForm.addEventListener('change', (e) => {
            if (e.target && e.target.dataset && e.target.dataset.tagName === '완결') {
                if (isCompletedToggle) {
                    isCompletedToggle.checked = e.target.checked;
                }
            }
        });
    }

    // Initializations
    initTheme();
    setViewMode(currentViewMode);
    fetchBooks();
});