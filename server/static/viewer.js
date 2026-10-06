document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM Elements ---
    const bookTitleElement = document.getElementById('book-title');
    const chapterTitleElement = document.getElementById('chapter-title');
    const contentArea = document.getElementById('content-area');
    const bookContainer = document.getElementById('book-container');
    const viewerContainer = document.querySelector('.viewer-container');
    const pageIndicator = document.getElementById('page-indicator');
    const readingProgressBar = document.getElementById('reading-progress-bar');

    // Header buttons
    const tocBtn = document.getElementById('toc-btn');
    const readerSettingsBtn = document.getElementById('reader-settings-btn');
    const focusModeBtn = document.getElementById('focus-mode-btn');
    const nightModeBtn = document.getElementById('night-mode-btn');
    const shortcutHelpBtn = document.getElementById('shortcut-help-btn');

    // Navigation buttons
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');

    // Sidebar Elements (TOC)
    const sidebar = document.getElementById('toc-sidebar');
    const closeSidebarBtn = document.getElementById('close-sidebar-btn');
    const tocList = document.getElementById('toc-list');
    const viewOriginalBtn = document.getElementById('view-original-btn');
    const tocSearchInput = document.getElementById('toc-search-input');
    const tocJumpInput = document.getElementById('toc-jump-input');
    const tocJumpBtn = document.getElementById('toc-jump-btn');
    const tocPrevChapterBtn = document.getElementById('toc-prev-chapter-btn');
    const tocNextChapterBtn = document.getElementById('toc-next-chapter-btn');
    const tocCurrentIndexLabel = document.getElementById('toc-current-index-label');

    // Settings Drawer Elements
    const settingsDrawer = document.getElementById('reader-settings-panel');
    const closeSettingsBtn = document.getElementById('close-settings-btn');
    const fontSizeSlider = document.getElementById('font-size-slider');
    const fontSizeVal = document.getElementById('font-size-val');
    const fontDecreaseBtn = document.getElementById('font-decrease-btn');
    const fontIncreaseBtn = document.getElementById('font-increase-btn');
    const toggleOriginalSwitch = document.getElementById('toggle-original-switch');

    // Shortcut Help Modal
    const shortcutModal = document.getElementById('shortcut-help-modal');
    const closeShortcutModalBtn = document.getElementById('close-shortcut-modal-btn');
    const closeShortcutBottomBtn = document.getElementById('close-shortcut-bottom-btn');

    // Dictionary & Corpus Study Drawer Elements
    const dictStudyBtn = document.getElementById('dict-study-btn');
    const dictSidebar = document.getElementById('dict-sidebar');
    const closeDictSidebarBtn = document.getElementById('close-dict-sidebar-btn');
    const dictSearchInput = document.getElementById('dict-search-input');
    const dictClearBtn = document.getElementById('dict-clear-btn');
    const dictSearchBtn = document.getElementById('dict-search-btn');
    const dictLinkNaver = document.getElementById('dict-link-naver');
    const dictLinkWeblio = document.getElementById('dict-link-weblio');
    const dictLinkJisho = document.getElementById('dict-link-jisho');
    const dictStatsContainer = document.getElementById('dict-stats-container');
    const dictStatsText = document.getElementById('dict-stats-text');
    const dictCandidatesWrap = document.getElementById('dict-candidates-wrap');
    const dictExamplesList = document.getElementById('dict-examples-list');
    const dictSelectionPill = document.getElementById('dict-selection-pill');

    // Overlay & Mobile Nav
    const overlay = document.getElementById('overlay');
    const mobileNavSetting = document.getElementById('mobile-nav-setting');

    // --- State ---
    const urlParams = new URLSearchParams(window.location.search);
    const bookName = urlParams.get('book');
    const paramTitle = urlParams.get('title') || urlParams.get('url');

    let chapterTitles = [];
    let currentChapterIndex = -1;
    let currentChapterItems = [];
    let pages = [];
    let currentPageInChapter = 0;
    let saveTimeout = null;

    // Dictionary & Editing State
    let activeEditingItem = null;
    let currentDictKeyword = '';

    // Preferences State
    let prefs = {
        theme: 'paper', // 'paper', 'white', 'sepia', 'dark', 'oled'
        font: 'batang',  // 'batang', 'myeongjo', 'pretendard', 'sans'
        fontSize: 18,
        lineHeight: 1.8,
        width: 840,
        mode: 'paging',  // 'paging', 'scroll'
        showOriginal: false
    };

    // Touch State
    let touchStartX = 0;
    let touchStartY = 0;
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    let mobileNavMode = 'both'; // 'both', 'tap', 'swipe'

    // --- Toast Function ---
    function showToast(message, duration = 2000) {
        let toast = document.getElementById('viewer-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'viewer-toast';
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

    // --- Utilities ---
    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.toString().replace(/[&<>"']/g, m => map[m]);
    }

    // --- Ruby & Bouten Parser (Publisher Style) ---
    function renderNovelRubyHtml(text) {
        if (!text) return '';
        if (!text.includes('・') && !text.includes('《')) {
            return escapeHtml(text);
        }

        const combinedRegex = /((?:[^\s(（]\s*[（(]・[）)]\s*)+)|(?:([|｜]?[가-힣a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+)《([^》]+)》)/g;
        const boutenCharRegex = /([^\s(（])\s*[（(]・[）)](\s*)/g;

        let result = '';
        let lastIndex = 0;
        let match;

        while ((match = combinedRegex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                result += escapeHtml(text.substring(lastIndex, match.index));
            }

            if (match[1]) {
                const boutenBlock = match[1];
                let bMatch;
                boutenCharRegex.lastIndex = 0;
                while ((bMatch = boutenCharRegex.exec(boutenBlock)) !== null) {
                    const char = bMatch[1];
                    const trailingSpace = bMatch[2] || '';
                    result += `<span class="novel-bouten">${escapeHtml(char)}</span>${escapeHtml(trailingSpace)}`;
                }
            } else if (match[2] && match[3]) {
                let base = match[2];
                if (base.startsWith('|') || base.startsWith('｜')) {
                    base = base.substring(1);
                }
                const ruby = match[3];
                result += `<ruby class="novel-ruby">${escapeHtml(base)}<rt>${escapeHtml(ruby)}</rt></ruby>`;
            }

            lastIndex = combinedRegex.lastIndex;
        }

        if (lastIndex < text.length) {
            result += escapeHtml(text.substring(lastIndex));
        }

        return result;
    }

    // --- Preferences System ---
    function loadPreferences() {
        try {
            const saved = localStorage.getItem('lanovel_reader_prefs');
            if (saved) {
                const parsed = JSON.parse(saved);
                prefs = { ...prefs, ...parsed };
            }
            // Backward compatibility checks
            if (localStorage.getItem('nightMode') === 'true') {
                prefs.theme = 'dark';
            }
            if (localStorage.getItem('showOriginalText') === 'true') {
                prefs.showOriginal = true;
            }
            const savedMobileNav = localStorage.getItem('mobileNavMode');
            if (savedMobileNav) {
                mobileNavMode = savedMobileNav;
                const radio = document.querySelector(`input[name="mobile-nav"][value="${savedMobileNav}"]`);
                if (radio) radio.checked = true;
            }
        } catch (e) {
            console.warn('Failed to load reader preferences:', e);
        }
        applyPreferences();
    }

    function savePreferences() {
        try {
            localStorage.setItem('lanovel_reader_prefs', JSON.stringify(prefs));
            localStorage.setItem('showOriginalText', prefs.showOriginal);
            localStorage.setItem('nightMode', prefs.theme === 'dark' || prefs.theme === 'oled');
        } catch (e) {
            console.warn('Failed to save reader preferences:', e);
        }
    }

    function applyPreferences() {
        // 1. Theme Class
        document.body.classList.remove('theme-paper', 'theme-white', 'theme-sepia', 'theme-dark', 'theme-oled', 'dark-mode');
        document.body.classList.add(`theme-${prefs.theme}`);
        if (prefs.theme === 'dark' || prefs.theme === 'oled') {
            document.body.classList.add('dark-mode');
        }

        // Active Theme Chip
        document.querySelectorAll('.theme-chip').forEach(chip => {
            chip.classList.toggle('active', chip.dataset.theme === prefs.theme);
        });

        // 2. Font Family
        let fontValue = "var(--font-batang)";
        if (prefs.font === 'myeongjo') fontValue = "var(--font-myeongjo)";
        else if (prefs.font === 'pretendard') fontValue = "var(--font-pretendard)";
        else if (prefs.font === 'sans') fontValue = "var(--font-sans)";
        document.documentElement.style.setProperty('--reader-font', fontValue);

        document.querySelectorAll('.font-selector .segment-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.font === prefs.font);
        });

        // 3. Font Size
        document.documentElement.style.setProperty('--reader-font-size', `${prefs.fontSize}px`);
        if (fontSizeSlider) fontSizeSlider.value = prefs.fontSize;
        if (fontSizeVal) fontSizeVal.textContent = `${prefs.fontSize}px`;

        // 4. Line Height
        document.documentElement.style.setProperty('--reader-line-height', prefs.lineHeight);
        document.querySelectorAll('.line-height-selector .segment-btn').forEach(btn => {
            btn.classList.toggle('active', parseFloat(btn.dataset.lh) === prefs.lineHeight);
        });

        // 5. Container Max Width
        document.documentElement.style.setProperty('--viewer-max-width', `${prefs.width}px`);
        document.querySelectorAll('.width-selector .segment-btn').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.width, 10) === prefs.width);
        });

        // 6. Reading Mode
        document.body.classList.toggle('scroll-mode', prefs.mode === 'scroll');
        document.querySelectorAll('.view-mode-selector .segment-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === prefs.mode);
        });

        // 7. Original Text Toggle
        if (toggleOriginalSwitch) toggleOriginalSwitch.checked = prefs.showOriginal;
        if (viewOriginalBtn) viewOriginalBtn.classList.toggle('active', prefs.showOriginal);

        updateHeaderIcons();
    }

    function updateHeaderIcons() {
        const isDark = prefs.theme === 'dark' || prefs.theme === 'oled';
        if (nightModeBtn) {
            nightModeBtn.innerHTML = `<span class="material-icons">${isDark ? 'light_mode' : 'dark_mode'}</span>`;
            nightModeBtn.classList.toggle('active', isDark);
        }
        if (focusModeBtn) {
            const isFocus = viewerContainer.classList.contains('focus-mode');
            focusModeBtn.innerHTML = `<span class="material-icons">${isFocus ? 'fullscreen_exit' : 'fullscreen'}</span>`;
            focusModeBtn.classList.toggle('active', isFocus);
        }
    }

    // --- Book Loading & Pagination ---
    async function loadBook() {
        if (!bookName) {
            contentArea.innerHTML = `
                <div style="text-align: center; padding: 40px;">
                    <span class="material-icons" style="font-size: 40px; color: var(--text-muted);">help_outline</span>
                    <p style="margin-top: 10px; font-weight: 600;">책 이름이 지정되지 않았습니다.</p>
                </div>
            `;
            bookTitleElement.textContent = '책을 찾을 수 없음';
            return;
        }

        bookTitleElement.textContent = bookName;

        try {
            // 1. Fetch user activity history
            const activityRes = await fetch(`/api/books/${encodeURIComponent(bookName)}/activity`);
            const activityData = activityRes.ok ? await activityRes.json() : {};

            // 2. Fetch chapter titles
            const chaptersRes = await fetch(`/api/books/${encodeURIComponent(bookName)}/chapters?_t=${Date.now()}`, { cache: 'no-store' });
            if (!chaptersRes.ok) throw new Error(`챕터 목록 로딩 실패: ${chaptersRes.status}`);
            chapterTitles = await chaptersRes.json();

            if (chapterTitles.length === 0) {
                contentArea.innerHTML = '<p style="text-align: center; padding: 40px;">표시할 챕터가 없습니다.</p>';
                return;
            }

            renderTocList();

            // 3. Determine start chapter index and PID
            let startChapterIndex = 0;
            let startPid = null;

            if (paramTitle) {
                const foundParamIndex = chapterTitles.findIndex(t => t === paramTitle);
                if (foundParamIndex !== -1) {
                    startChapterIndex = foundParamIndex;
                    if (activityData.last_read_chapter_title === paramTitle && activityData.last_read_pid) {
                        startPid = activityData.last_read_pid;
                    }
                }
            } else if (activityData.last_read_chapter_title) {
                const foundActIndex = chapterTitles.findIndex(t => t === activityData.last_read_chapter_title);
                if (foundActIndex !== -1) {
                    startChapterIndex = foundActIndex;
                    startPid = activityData.last_read_pid;
                }
            } else if (activityData.last_read_pid) {
                startPid = activityData.last_read_pid;
            }

            await loadChapter(startChapterIndex, 'first', startPid);

        } catch (error) {
            console.error('Error loading book:', error);
            contentArea.innerHTML = `<p style="color: red; text-align: center; padding: 40px;">책을 불러오지 못했습니다: ${escapeHtml(error.message)}</p>`;
        }
    }

    async function loadChapter(chapterIndex, pagePosition = 'first', startPid = null) {
        if (chapterIndex < 0 || chapterIndex >= chapterTitles.length) return;

        currentChapterIndex = chapterIndex;
        const chapterTitle = chapterTitles[currentChapterIndex];

        chapterTitleElement.textContent = chapterTitle || `제 ${currentChapterIndex + 1}화`;
        if (tocCurrentIndexLabel) {
            tocCurrentIndexLabel.textContent = `${currentChapterIndex + 1} / ${chapterTitles.length} 화`;
        }

        contentArea.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; color: var(--text-muted);">
                <span class="material-icons" style="font-size: 32px; animation: spin 1s linear infinite;">sync</span>
                <p style="margin-top: 12px; font-size: 15px;">'${escapeHtml(chapterTitle)}' 불러오는 중...</p>
            </div>
        `;

        updateActiveTocItem();

        try {
            const contentRes = await fetch(`/api/books/${encodeURIComponent(bookName)}/chapter?title=${encodeURIComponent(chapterTitle)}&_t=${Date.now()}`, { cache: 'no-store' });
            if (!contentRes.ok) throw new Error(`챕터 내용을 불러오지 못했습니다: ${contentRes.status}`);

            currentChapterItems = await contentRes.json();
            if (currentChapterItems.length === 0) {
                contentArea.innerHTML = '<p style="text-align: center; padding: 40px;">이 챕터에 번역된 내용이 없습니다.</p>';
                return;
            }

            if (prefs.mode === 'scroll') {
                renderScrollMode(startPid);
            } else {
                await paginate();

                let pageIndexToShow = 0;
                if (startPid) {
                    const foundPage = pages.findIndex(page => page.some(item => item.pid === startPid));
                    if (foundPage !== -1) pageIndexToShow = foundPage;
                } else if (pagePosition === 'last') {
                    pageIndexToShow = pages.length - 1;
                }

                renderPage(pageIndexToShow, true);
            }

            updateProgress();

        } catch (error) {
            console.error(`Error loading chapter '${chapterTitle}':`, error);
            contentArea.innerHTML = `<p style="color: red; text-align: center; padding: 40px;">챕터 로딩 실패: ${escapeHtml(error.message)}</p>`;
        }
    }

    // --- Continuous Scroll Mode Rendering ---
    function renderScrollMode(targetPid = null) {
        contentArea.innerHTML = currentChapterItems.map(createItemHtml).join('');
        pageIndicator.textContent = `연속 스크롤 (총 ${currentChapterItems.length} 단락)`;
        contentArea.style.opacity = '1';
        
        if (targetPid) {
            requestAnimationFrame(() => {
                const targetEl = contentArea.querySelector(`[data-pid="${targetPid}"]`);
                if (targetEl) {
                    targetEl.scrollIntoView({ behavior: 'instant', block: 'start' });
                } else {
                    window.scrollTo({ top: 0, behavior: 'instant' });
                }
            });
        } else {
            window.scrollTo({ top: 0, behavior: 'instant' });
        }
        saveLastReadPosition();
    }

    // --- Paged Mode Pagination ---
    async function paginate() {
        return new Promise(resolve => {
            if (contentArea.offsetHeight === 0) {
                setTimeout(() => paginate().then(resolve), 100);
                return;
            }

            pages = [];
            let currentPageItems = [];
            const maxPageHeight = contentArea.clientHeight;

            const measurer = document.createElement('div');
            measurer.style.position = 'absolute';
            measurer.style.visibility = 'hidden';
            measurer.style.width = contentArea.clientWidth + 'px';
            measurer.style.padding = getComputedStyle(contentArea).padding;
            measurer.style.lineHeight = getComputedStyle(contentArea).lineHeight;
            measurer.style.fontSize = getComputedStyle(contentArea).fontSize;
            measurer.style.fontFamily = getComputedStyle(contentArea).fontFamily;
            document.body.appendChild(measurer);

            for (const item of currentChapterItems) {
                const itemHtml = createItemHtml(item);
                measurer.innerHTML += itemHtml;

                if (measurer.scrollHeight > maxPageHeight) {
                    if (currentPageItems.length > 0) {
                        pages.push(currentPageItems);
                    } else {
                        pages.push([item]);
                        measurer.innerHTML = '';
                        continue;
                    }
                    currentPageItems = [item];
                    measurer.innerHTML = createItemHtml(item);
                } else {
                    currentPageItems.push(item);
                }
            }

            if (currentPageItems.length > 0) {
                pages.push(currentPageItems);
            }

            document.body.removeChild(measurer);
            resolve();
        });
    }

    function renderPage(pageIndex, isInitialLoad = false) {
        if (pageIndex < 0 || pageIndex >= pages.length) return;

        const navArrowLeft = document.getElementById('nav-arrow-left');
        const navArrowRight = document.getElementById('nav-arrow-right');
        if (navArrowLeft) navArrowLeft.style.opacity = '0';
        if (navArrowRight) navArrowRight.style.opacity = '0';

        const updateContent = () => {
            currentPageInChapter = pageIndex;
            const pageItems = pages[currentPageInChapter];
            if (!pageItems) return;

            contentArea.innerHTML = pageItems.map(createItemHtml).join('');
            pageIndicator.textContent = `${currentPageInChapter + 1} / ${pages.length}`;
            contentArea.style.opacity = '1';

            updateProgress();
            saveLastReadPosition();
        };

        if (isInitialLoad) {
            updateContent();
        } else {
            contentArea.style.opacity = '0';
            setTimeout(updateContent, 180);
        }
    }

    function createItemHtml(item) {
        const hasOriginal = Boolean(item.original);
        let itemHtml = `<div class="translation-item" data-id="${item.id}" data-pid="${item.pid}" data-original="${escapeHtml(item.original)}" data-raw-translated="${escapeHtml(item.translated)}">`;

        // Edit trigger button (PC hover)
        itemHtml += `<button class="paragraph-edit-btn" title="단락 번역문 수정 (PC: 더블클릭 / 모바일: 길게 누르기)"><span class="material-icons" style="font-size: 16px;">edit</span></button>`;

        if (prefs.showOriginal && hasOriginal) {
            itemHtml += `<p class="original-text">${escapeHtml(item.original)}</p>`;
        }
        itemHtml += `<p class="translated-text">${renderNovelRubyHtml(item.translated)}</p></div>`;
        return itemHtml;
    }

    function updateProgress() {
        if (!readingProgressBar) return;
        if (prefs.mode === 'scroll') {
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            const docHeight = document.documentElement.scrollHeight - window.innerHeight;
            const scrollPercent = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
            readingProgressBar.style.width = `${Math.min(100, Math.max(0, scrollPercent))}%`;
        } else {
            if (pages.length > 0) {
                const pagePct = ((currentPageInChapter + 1) / pages.length) * 100;
                readingProgressBar.style.width = `${pagePct}%`;
            }
        }
    }

    window.addEventListener('scroll', () => {
        if (prefs.mode === 'scroll') {
            updateProgress();
            saveLastReadPosition();
        }
    });

    // --- Navigation ---
    function showPrevPage() {
        if (prefs.mode === 'scroll') {
            if (currentChapterIndex > 0) {
                loadChapter(currentChapterIndex - 1, 'first');
            } else {
                showToast('첫 번째 챕터입니다.');
            }
            return;
        }

        if (currentPageInChapter > 0) {
            renderPage(currentPageInChapter - 1);
        } else if (currentChapterIndex > 0) {
            loadChapter(currentChapterIndex - 1, 'last');
        } else {
            showToast('책의 첫 페이지입니다.');
        }
    }

    function showNextPage() {
        if (prefs.mode === 'scroll') {
            if (currentChapterIndex < chapterTitles.length - 1) {
                loadChapter(currentChapterIndex + 1, 'first');
            } else {
                showToast('마지막 챕터입니다.');
            }
            return;
        }

        if (currentPageInChapter < pages.length - 1) {
            renderPage(currentPageInChapter + 1);
        } else if (currentChapterIndex < chapterTitles.length - 1) {
            loadChapter(currentChapterIndex + 1, 'first');
        } else {
            showToast('책의 마지막 페이지입니다.');
        }
    }

    // --- Last Read Position Persistence ---
    function saveLastReadPosition() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => commitPosition(false), 1200);
    }

    window.addEventListener('pagehide', () => commitPosition(true));

    function commitPosition(useKeepalive) {
        if (!bookName) return;

        let firstPid = null;
        if (prefs.mode === 'scroll') {
            const items = contentArea.querySelectorAll('.translation-item');
            for (const item of items) {
                const rect = item.getBoundingClientRect();
                if (rect.bottom >= 80) { // 80px 헤더 여백 고려 상단에 걸친 첫 단락
                    firstPid = item.dataset.pid || null;
                    break;
                }
            }
            if (!firstPid && currentChapterItems.length > 0) {
                firstPid = currentChapterItems[0]?.pid || null;
            }
        } else {
            firstPid = pages[currentPageInChapter]?.[0]?.pid || null;
        }

        const payload = {
            last_read_chapter_title: chapterTitles[currentChapterIndex] || null,
            last_read_pid: firstPid,
            last_read_timestamp: Math.floor(Date.now() / 1000)
        };

        fetch(`/api/books/${encodeURIComponent(bookName)}/activity`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: useKeepalive
        }).catch(error => console.warn('Failed to save last read position:', error));
    }

    // --- TOC Sidebar Management ---
    function renderTocList(filterQuery = '') {
        tocList.innerHTML = '';
        const q = filterQuery.toLowerCase().trim();

        chapterTitles.forEach((title, index) => {
            if (q && !title.toLowerCase().includes(q)) return;

            const div = document.createElement('div');
            div.className = `toc-item ${index === currentChapterIndex ? 'active' : ''}`;
            div.dataset.index = index;
            div.textContent = `${index + 1}. ${title || '(제목 없음)'}`;
            div.title = title;

            div.addEventListener('click', () => {
                loadChapter(index, 'first');
                closeSidebar();
            });
            tocList.appendChild(div);
        });

        updateActiveTocItem();
    }

    function updateActiveTocItem() {
        document.querySelectorAll('.toc-item').forEach(el => {
            const isCurr = parseInt(el.dataset.index, 10) === currentChapterIndex;
            el.classList.toggle('active', isCurr);
            if (isCurr && sidebar.classList.contains('open')) {
                el.scrollIntoView({ block: 'center', behavior: 'smooth' });
            }
        });
    }

    if (tocSearchInput) {
        tocSearchInput.addEventListener('input', (e) => {
            renderTocList(e.target.value);
        });
    }

    if (tocJumpBtn && tocJumpInput) {
        const executeJump = () => {
            const num = parseInt(tocJumpInput.value, 10);
            if (!isNaN(num) && num >= 1 && num <= chapterTitles.length) {
                loadChapter(num - 1, 'first');
                closeSidebar();
                tocJumpInput.value = '';
            } else {
                showToast(`1부터 ${chapterTitles.length} 사이의 회차 번호를 입력하세요.`);
            }
        };
        tocJumpBtn.addEventListener('click', executeJump);
        tocJumpInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') executeJump();
        });
    }

    if (tocPrevChapterBtn) {
        tocPrevChapterBtn.addEventListener('click', () => {
            if (currentChapterIndex > 0) {
                loadChapter(currentChapterIndex - 1, 'first');
            } else {
                showToast('첫 번째 챕터입니다.');
            }
        });
    }

    if (tocNextChapterBtn) {
        tocNextChapterBtn.addEventListener('click', () => {
            if (currentChapterIndex < chapterTitles.length - 1) {
                loadChapter(currentChapterIndex + 1, 'first');
            } else {
                showToast('마지막 챕터입니다.');
            }
        });
    }

    // --- Sidebar & Drawer Open/Close ---
    function openSidebar() {
        closeSettingsDrawer();
        closeDictDrawer();
        sidebar.classList.add('open');
        overlay.classList.add('visible');
        if (tocSearchInput) {
            tocSearchInput.value = '';
            renderTocList();
        }
        setTimeout(() => updateActiveTocItem(), 100);
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        if (!settingsDrawer.classList.contains('open') && !(dictSidebar && dictSidebar.classList.contains('open')) && !shortcutModal.style.display.includes('flex')) {
            overlay.classList.remove('visible');
        }
    }

    function openSettingsDrawer() {
        closeSidebar();
        closeDictDrawer();
        settingsDrawer.classList.add('open');
        overlay.classList.add('visible');
    }

    function closeSettingsDrawer() {
        settingsDrawer.classList.remove('open');
        if (!sidebar.classList.contains('open') && !(dictSidebar && dictSidebar.classList.contains('open')) && !shortcutModal.style.display.includes('flex')) {
            overlay.classList.remove('visible');
        }
    }

    function toggleFocusMode() {
        const isFocus = viewerContainer.classList.toggle('focus-mode');
        updateHeaderIcons();
        if (isFocus) {
            showToast('집중 모드 활성화 (F 키로 해제)');
        } else {
            showToast('집중 모드 해제');
        }
    }

    function openShortcutModal() {
        shortcutModal.style.display = 'flex';
        overlay.classList.add('visible');
    }

    function closeShortcutModal() {
        shortcutModal.style.display = 'none';
        if (!sidebar.classList.contains('open') && !settingsDrawer.classList.contains('open') && !(dictSidebar && dictSidebar.classList.contains('open'))) {
            overlay.classList.remove('visible');
        }
    }

    // --- Dictionary & Corpus Study Drawer ---
    function openDictDrawer(initialKeyword = '') {
        closeSidebar();
        closeSettingsDrawer();
        closeShortcutModal();
        hideSelectionPill();

        if (dictSidebar) dictSidebar.classList.add('open');
        overlay.classList.add('visible');

        const kw = (initialKeyword || '').trim();
        if (kw) {
            if (dictSearchInput) {
                dictSearchInput.value = kw;
                if (dictClearBtn) dictClearBtn.style.display = 'block';
            }
            executeDictSearch(kw);
        } else {
            setTimeout(() => {
                if (dictSearchInput) dictSearchInput.focus();
            }, 150);
        }
    }

    function closeDictDrawer() {
        if (dictSidebar) dictSidebar.classList.remove('open');
        if (!sidebar.classList.contains('open') && !settingsDrawer.classList.contains('open') && !shortcutModal.style.display.includes('flex')) {
            overlay.classList.remove('visible');
        }
    }

    function toggleDictDrawer() {
        if (dictSidebar && dictSidebar.classList.contains('open')) {
            closeDictDrawer();
        } else {
            const sel = window.getSelection().toString().trim();
            openDictDrawer(sel);
        }
    }

    function hideSelectionPill() {
        if (dictSelectionPill) {
            dictSelectionPill.style.display = 'none';
        }
    }

    function highlightKeyword(text, keyword) {
        if (!text || !keyword) return escapeHtml(text || '');
        const escapedText = escapeHtml(text);
        const escapedKw = escapeHtml(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        try {
            const regex = new RegExp(`(${escapedKw})`, 'gi');
            return escapedText.replace(regex, '<mark class="dict-highlight">$1</mark>');
        } catch {
            return escapedText;
        }
    }

    async function executeDictSearch(keyword) {
        const kw = (keyword || '').trim();
        currentDictKeyword = kw;

        if (!kw) {
            if (dictClearBtn) dictClearBtn.style.display = 'none';
            if (dictStatsContainer) dictStatsContainer.style.display = 'none';
            if (dictExamplesList) {
                dictExamplesList.innerHTML = `
                    <div class="dict-empty-guide">
                        <span class="material-icons" style="font-size: 40px; opacity: 0.35;">auto_stories</span>
                        <p>원문이나 번역문 단어를 드래그하거나<br>상단에 단어를 입력하여 검색하세요.</p>
                        <span class="sub-guide">34만 개 이상의 누적 번역 데이터에서 실제 소설 용례를 대조하고 네이버/Weblio/Jisho 사전과 연동할 수 있습니다.</span>
                    </div>
                `;
            }
            if (dictLinkNaver) dictLinkNaver.href = 'https://ja.dict.naver.com/';
            if (dictLinkWeblio) dictLinkWeblio.href = 'https://www.weblio.jp/';
            if (dictLinkJisho) dictLinkJisho.href = 'https://jisho.org/';
            return;
        }

        if (dictClearBtn) dictClearBtn.style.display = 'block';

        // Update direct dictionary links
        const encodedKw = encodeURIComponent(kw);
        if (dictLinkNaver) dictLinkNaver.href = `https://ja.dict.naver.com/#/search?range=all&q=${encodedKw}`;
        if (dictLinkWeblio) dictLinkWeblio.href = `https://www.weblio.jp/content/${encodedKw}`;
        if (dictLinkJisho) dictLinkJisho.href = `https://jisho.org/search/${encodedKw}`;

        // Show loading in list
        if (dictExamplesList) {
            dictExamplesList.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <div style="display: inline-block; width: 24px; height: 24px; border: 3px solid var(--border-color); border-top-color: var(--primary-color); border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                    <p style="margin-top: 12px; font-size: 13px;">누적 번역 DB 및 사전 연동 데이터 조회 중...</p>
                </div>
            `;
        }

        try {
            const url = `/api/dictionary/lookup?keyword=${encodedKw}&folder=${encodeURIComponent(bookName || '')}&limit=30`;
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('사전 및 용례 조회 실패');
            const data = await resp.json();

            // Stats badge
            if (dictStatsContainer) {
                dictStatsContainer.style.display = 'flex';
                if (dictStatsText) {
                    dictStatsText.textContent = `누적 소설 DB ${data.total_occurrences}건 발견 (${data.frequency_level})`;
                }
                if (dictCandidatesWrap) {
                    dictCandidatesWrap.innerHTML = '';
                    if (data.candidate_terms && data.candidate_terms.length > 0) {
                        const label = document.createElement('span');
                        label.className = 'dict-candidate-label';
                        label.textContent = '주요 대응어:';
                        dictCandidatesWrap.appendChild(label);

                        data.candidate_terms.forEach(term => {
                            const chip = document.createElement('button');
                            chip.className = 'dict-candidate-chip';
                            chip.textContent = term;
                            chip.title = `'${term}' 키워드로 연쇄 탐색`;
                            chip.onclick = () => {
                                if (dictSearchInput) dictSearchInput.value = term;
                                executeDictSearch(term);
                            };
                            dictCandidatesWrap.appendChild(chip);
                        });
                    }
                }
            }

            // Render Examples
            if (!dictExamplesList) return;
            const examples = data.examples || [];
            if (examples.length === 0) {
                dictExamplesList.innerHTML = `
                    <div class="dict-empty-guide">
                        <span class="material-icons" style="font-size: 36px; opacity: 0.4;">search_off</span>
                        <p>'${escapeHtml(kw)}'에 대한 누적 소설 용례가 없습니다.</p>
                        <span class="sub-guide">상단 네이버/Weblio/Jisho 사전 버튼을 클릭하면 온라인 사전 전문 검색으로 바로 연결됩니다.</span>
                    </div>
                `;
                return;
            }

            dictExamplesList.innerHTML = '';
            examples.forEach(item => {
                const card = document.createElement('div');
                card.className = 'dict-example-card';

                const sourceTitle = item.folderName ? `${item.folderName} • ${item.title || ''}` : (item.title || '');
                const origHtml = highlightKeyword(item.original, kw);
                const transHtml = highlightKeyword(item.translated, kw);

                let actionsHtml = `<div class="dict-example-actions">`;
                if (activeEditingItem) {
                    actionsHtml += `<button class="dict-apply-btn" title="현재 수정 중인 단락에 이 번역 표현 삽입/반영">이 표현 반영</button>`;
                }
                actionsHtml += `<button class="dict-copy-btn" title="번역문 복사">복사</button></div>`;

                card.innerHTML = `
                    <div class="dict-example-meta">
                        <span class="dict-example-source" title="${escapeHtml(sourceTitle)}">
                            <span class="material-icons" style="font-size: 13px;">bookmark_border</span>
                            ${escapeHtml(sourceTitle)}
                        </span>
                    </div>
                    <div class="dict-example-orig">${origHtml}</div>
                    <div class="dict-example-trans">${transHtml}</div>
                    ${actionsHtml}
                `;

                // Apply button handler
                const applyBtn = card.querySelector('.dict-apply-btn');
                if (applyBtn) {
                    applyBtn.onclick = (e) => {
                        e.stopPropagation();
                        applyTranslationToActiveEditor(item.translated);
                    };
                }

                // Copy button handler
                const copyBtn = card.querySelector('.dict-copy-btn');
                if (copyBtn) {
                    copyBtn.onclick = (e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(item.translated);
                        showToast('번역문이 클립보드에 복사되었습니다.');
                    };
                }

                dictExamplesList.appendChild(card);
            });

        } catch (err) {
            console.error('Dictionary search error:', err);
            if (dictExamplesList) {
                dictExamplesList.innerHTML = `
                    <div style="text-align: center; padding: 40px; color: #ef4444;">
                        <p style="font-size: 13px;">용례 검색 중 오류가 발생했습니다: ${escapeHtml(err.message)}</p>
                    </div>
                `;
            }
        }
    }

    function applyTranslationToActiveEditor(translatedText) {
        if (!activeEditingItem) {
            showToast('현재 수정 중인 단락이 없습니다.');
            return;
        }
        const translatedTextElement = activeEditingItem.querySelector('.translated-text');
        if (translatedTextElement) {
            translatedTextElement.textContent = translatedText;
            showToast('번역 표현이 수정창에 적용되었습니다.');
        }
    }

    function openDictDrawerForEditing(translationItem) {
        activeEditingItem = translationItem;
        const orig = translationItem.dataset.original || '';

        // Extract candidate keyword from selection or original
        let kw = window.getSelection().toString().trim();
        if (!kw && orig) {
            const kanjiMatch = orig.match(/[\u4e00-\u9faf]{2,}/);
            const katakanaMatch = orig.match(/[\u30a0-\u30ff]{2,}/);
            if (kanjiMatch) kw = kanjiMatch[0];
            else if (katakanaMatch) kw = katakanaMatch[0];
            else kw = orig.substring(0, Math.min(8, orig.length));
        }

        openDictDrawer(kw);
    }

    // --- Paragraph Inline Editing ---
    function enableEditing(translationItem) {
        // Disable other editing items
        document.querySelectorAll('.editing').forEach(item => {
            if (item !== translationItem) disableEditing(item);
        });

        if (translationItem.classList.contains('editing')) return;

        translationItem.classList.add('editing');
        activeEditingItem = translationItem;
        const translatedTextElement = translationItem.querySelector('.translated-text');
        
        // Find raw unparsed text from currentChapterItems or dataset so tags like 《...》 or (・) can be edited
        const itemId = parseInt(translationItem.dataset.id, 10);
        const sourceItem = currentChapterItems.find(i => i.id === itemId || i.pid === translationItem.dataset.pid);
        const originalRawText = sourceItem ? sourceItem.translated : (translationItem.dataset.rawTranslated || translatedTextElement.textContent);
        translationItem._originalRawText = originalRawText;

        translatedTextElement.textContent = originalRawText;
        translatedTextElement.contentEditable = 'true';
        translatedTextElement.focus();

        setTimeout(() => {
            translationItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);

        let actionBox = translationItem.querySelector('.inline-edit-actions');
        if (!actionBox) {
            actionBox = document.createElement('div');
            actionBox.className = 'inline-edit-actions';
            const isTouchUI = isMobile || window.innerWidth <= 768;
            actionBox.innerHTML = `
                <button class="btn btn-sm btn-outline dict-lookup-btn" title="사전 및 누적 용례 대조">📖 사전·용례</button>
                <button class="btn btn-sm btn-outline cancel-edit-btn">${isTouchUI ? '취소' : '취소 (Esc)'}</button>
                <button class="btn btn-sm btn-primary save-edit-btn">${isTouchUI ? '저장' : '저장 (Ctrl+Enter)'}</button>
            `;
            translationItem.appendChild(actionBox);

            actionBox.querySelector('.dict-lookup-btn').onclick = (e) => {
                e.stopPropagation();
                openDictDrawerForEditing(translationItem);
            };
            actionBox.querySelector('.save-edit-btn').onclick = (e) => {
                e.stopPropagation();
                saveParagraphChanges(translationItem);
            };
            actionBox.querySelector('.cancel-edit-btn').onclick = (e) => {
                e.stopPropagation();
                disableEditing(translationItem, true);
            };
        }

        translatedTextElement.onkeydown = (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveParagraphChanges(translationItem);
            } else if (e.key === 'Escape') {
                disableEditing(translationItem, true);
            }
        };
    }

    function disableEditing(translationItem, revert = false) {
        translationItem.classList.remove('editing');
        if (activeEditingItem === translationItem) {
            activeEditingItem = null;
        }
        const translatedTextElement = translationItem.querySelector('.translated-text');
        if (translatedTextElement) {
            translatedTextElement.contentEditable = 'false';
            translatedTextElement.onkeydown = null;
            if (revert && translationItem._originalRawText !== undefined) {
                translatedTextElement.innerHTML = renderNovelRubyHtml(translationItem._originalRawText);
            }
        }
        const actionBox = translationItem.querySelector('.inline-edit-actions');
        if (actionBox) actionBox.remove();
        delete translationItem._originalRawText;
    }

    async function saveParagraphChanges(translationItem) {
        const translatedTextElement = translationItem.querySelector('.translated-text');
        const newTranslatedText = translatedTextElement.textContent.trim();

        const itemData = {
            url: currentChapterItems[0]?.url || '',
            pid: translationItem.dataset.pid,
            original: translationItem.dataset.original,
            translated: newTranslatedText,
            timestamp: Math.floor(Date.now() / 1000),
            title: chapterTitles[currentChapterIndex] || ''
        };

        try {
            const response = await fetch('/translations/upsert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([itemData])
            });
            if (!response.ok) throw new Error('저장에 실패했습니다.');

            // Update local state before re-rendering
            const itemId = parseInt(translationItem.dataset.id, 10);
            const sourceItem = currentChapterItems.find(i => i.id === itemId || i.pid === itemData.pid);
            if (sourceItem) sourceItem.translated = newTranslatedText;
            translationItem.dataset.rawTranslated = newTranslatedText;

            disableEditing(translationItem);
            translatedTextElement.innerHTML = renderNovelRubyHtml(newTranslatedText);
            showToast('번역문이 수정되었습니다.');

        } catch (error) {
            console.error('Error saving changes:', error);
            alert('저장에 실패했습니다.');
        }
    }

    // --- Keyboard Navigation (Universal - Kakuyomu restriction removed!) ---
    function handleKeyPress(e) {
        // Ignore shortcuts when editing text or typing in inputs
        if (e.target.isContentEditable || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
            return;
        }

        const key = e.key;

        // Navigation Keys
        if (key === 'ArrowLeft' || key === 'h' || key === 'H' || key === '[') {
            e.preventDefault();
            showPrevPage();
        } else if (key === 'ArrowRight' || key === 'l' || key === 'L' || key === ']') {
            e.preventDefault();
            showNextPage();
        } else if (key === 'PageDown' || (key === ' ' && !e.shiftKey)) {
            e.preventDefault();
            showNextPage();
        } else if (key === 'PageUp' || (key === ' ' && e.shiftKey)) {
            e.preventDefault();
            showPrevPage();
        } else if (key === 'o' || key === 'O' || key === 't' || key === 'T') {
            e.preventDefault();
            if (sidebar.classList.contains('open')) closeSidebar();
            else openSidebar();
        } else if (key === 's' || key === 'S') {
            e.preventDefault();
            if (settingsDrawer.classList.contains('open')) closeSettingsDrawer();
            else openSettingsDrawer();
        } else if (key === 'f' || key === 'F') {
            e.preventDefault();
            toggleFocusMode();
        } else if ((e.shiftKey && (key === 'd' || key === 'D')) || key === 'w' || key === 'W') {
            e.preventDefault();
            toggleDictDrawer();
        } else if (key === 'd' || key === 'D') {
            e.preventDefault();
            // Fast toggle between light (paper) and dark (dark)
            prefs.theme = (prefs.theme === 'dark' || prefs.theme === 'oled') ? 'paper' : 'dark';
            applyPreferences();
            savePreferences();
            showToast(prefs.theme === 'dark' ? '다크 테마 적용' : '페이퍼 테마 적용');
        } else if (key === '+' || key === '=') {
            e.preventDefault();
            if (prefs.fontSize < 28) {
                prefs.fontSize += 1;
                applyPreferences();
                savePreferences();
                repaginateAndRender();
            }
        } else if (key === '-' || key === '_') {
            e.preventDefault();
            if (prefs.fontSize > 14) {
                prefs.fontSize -= 1;
                applyPreferences();
                savePreferences();
                repaginateAndRender();
            }
        } else if (key === '?') {
            e.preventDefault();
            openShortcutModal();
        } else if (key === 'Escape') {
            closeSidebar();
            closeSettingsDrawer();
            closeShortcutModal();
            closeDictDrawer();
            if (viewerContainer.classList.contains('focus-mode')) {
                toggleFocusMode();
            }
        }
    }

    async function repaginateAndRender() {
        if (prefs.mode === 'scroll') return;
        const topItemPid = pages[currentPageInChapter]?.[0]?.pid;
        await paginate();
        let newPageIndex = 0;
        if (topItemPid) {
            const foundPage = pages.findIndex(page => page.some(item => item.pid === topItemPid));
            if (foundPage !== -1) newPageIndex = foundPage;
        }
        renderPage(newPageIndex, true);
    }

    // --- Touch & Click Handlers ---
    let longPressTimer = null;
    let isLongPressTriggered = false;
    let suppressNextClick = false;

    // Capture-phase click interceptor to suppress phantom clicks right after long-press or swipe
    document.addEventListener('click', (e) => {
        if (suppressNextClick) {
            e.stopPropagation();
            e.preventDefault();
        }
    }, true);

    function handleBookClick(e) {
        if (suppressNextClick) {
            suppressNextClick = false;
            return;
        }
        // Block page turning if an edit session is currently active
        if (document.querySelector('.translation-item.editing')) {
            return;
        }
        if (isMobile && mobileNavMode === 'swipe') return;
        if (!window.getSelection().isCollapsed || e.target.closest('.paragraph-edit-btn')) {
            return;
        }

        const rect = bookContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickArea = clickX / rect.width;

        if (clickArea < 0.28) {
            showPrevPage();
        } else if (clickArea > 0.72) {
            showNextPage();
        }
    }

    // Touch Swipe & Mobile Long-Press (0.5s) to Edit
    bookContainer.addEventListener('touchstart', (e) => {
        if (e.touches.length !== 1) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
            return;
        }

        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
        isLongPressTriggered = false;

        // Long press detection for translation items on mobile/touch
        const item = e.target.closest('.translation-item');
        if (item && !item.classList.contains('editing') && !e.target.closest('.inline-edit-actions')) {
            longPressTimer = setTimeout(() => {
                isLongPressTriggered = true;
                if (navigator.vibrate) {
                    try { navigator.vibrate(50); } catch (_) {}
                }
                enableEditing(item);
                showToast('단락 번역문 수정 모드가 열렸습니다.');
            }, 500);
        } else {
            longPressTimer = null;
        }
    }, { passive: true });

    bookContainer.addEventListener('touchmove', (e) => {
        const currentX = e.touches[0].clientX;
        const currentY = e.touches[0].clientY;
        const deltaX = currentX - touchStartX;
        const deltaY = currentY - touchStartY;

        // Cancel long press if finger moved noticeably (scrolling or swiping)
        if (Math.abs(deltaX) > 8 || Math.abs(deltaY) > 8) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }

        if (mobileNavMode === 'tap') return;
        if (Math.abs(deltaX) > Math.abs(deltaY)) {
            if (prefs.mode !== 'scroll') e.preventDefault();
        }
    }, { passive: false });

    bookContainer.addEventListener('touchend', (e) => {
        clearTimeout(longPressTimer);
        longPressTimer = null;

        if (isLongPressTriggered) {
            isLongPressTriggered = false;
            suppressNextClick = true;
            setTimeout(() => {
                suppressNextClick = false;
            }, 400);
            return;
        }

        if (mobileNavMode === 'tap') return;
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;

        if (Math.abs(deltaX) > 50 && Math.abs(deltaY) < 60) {
            suppressNextClick = true;
            setTimeout(() => { suppressNextClick = false; }, 350);
            if (deltaX > 0) showPrevPage();
            else showNextPage();
        }
    }, { passive: true });

    bookContainer.addEventListener('touchcancel', () => {
        clearTimeout(longPressTimer);
        longPressTimer = null;
        isLongPressTriggered = false;
    }, { passive: true });

    // Prevent default context menu on long press or when editing
    bookContainer.addEventListener('contextmenu', (e) => {
        if (isLongPressTriggered || suppressNextClick) {
            e.preventDefault();
        }
    });

    // --- Event Listeners Setup ---
    document.addEventListener('keydown', handleKeyPress);
    bookContainer.addEventListener('click', handleBookClick);

    // Double click to edit paragraph (PC only: prevent accidental edits on mobile rapid taps)
    contentArea.addEventListener('dblclick', (e) => {
        if (isMobile || window.innerWidth <= 768) return;
        const item = e.target.closest('.translation-item');
        if (item) enableEditing(item);
    });

    // Hover edit button click (PC only: hidden on mobile)
    contentArea.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.paragraph-edit-btn');
        if (editBtn) {
            if (isMobile || window.innerWidth <= 768) return;
            e.stopPropagation();
            const item = editBtn.closest('.translation-item');
            if (item) enableEditing(item);
        }
    });

    // Top Header Buttons
    tocBtn.addEventListener('click', openSidebar);
    readerSettingsBtn.addEventListener('click', openSettingsDrawer);
    if (dictStudyBtn) dictStudyBtn.addEventListener('click', toggleDictDrawer);
    focusModeBtn.addEventListener('click', toggleFocusMode);
    nightModeBtn.addEventListener('click', () => {
        prefs.theme = (prefs.theme === 'dark' || prefs.theme === 'oled') ? 'paper' : 'dark';
        applyPreferences();
        savePreferences();
    });
    shortcutHelpBtn.addEventListener('click', openShortcutModal);

    // Dictionary Drawer Events
    if (closeDictSidebarBtn) closeDictSidebarBtn.addEventListener('click', closeDictDrawer);
    if (dictSearchBtn) {
        dictSearchBtn.addEventListener('click', () => {
            if (dictSearchInput) executeDictSearch(dictSearchInput.value);
        });
    }
    if (dictSearchInput) {
        dictSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                executeDictSearch(dictSearchInput.value);
            }
        });
        dictSearchInput.addEventListener('input', () => {
            if (dictClearBtn) {
                dictClearBtn.style.display = dictSearchInput.value ? 'block' : 'none';
            }
        });
    }
    if (dictClearBtn) {
        dictClearBtn.addEventListener('click', () => {
            if (dictSearchInput) dictSearchInput.value = '';
            executeDictSearch('');
            if (dictSearchInput) dictSearchInput.focus();
        });
    }

    // Selection Pill Listener for Reading & Study
    document.addEventListener('mouseup', handleTextSelection);
    document.addEventListener('touchend', () => {
        setTimeout(handleTextSelection, 100);
    });

    function handleTextSelection(e) {
        if (e && e.target && e.target.closest('#dict-selection-pill')) return;

        const selection = window.getSelection();
        const selectedText = selection ? selection.toString().trim() : '';

        if (selectedText.length > 0 && selectedText.length <= 40) {
            const anchorNode = selection.anchorNode;
            const parentEl = anchorNode ? (anchorNode.nodeType === Node.ELEMENT_NODE ? anchorNode : anchorNode.parentElement) : null;
            const isInsideReader = parentEl && (
                parentEl.closest('#content-area') ||
                parentEl.closest('#dict-sidebar')
            );

            if (isInsideReader && dictSelectionPill) {
                try {
                    const range = selection.getRangeAt(0);
                    const rect = range.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0) {
                        const top = Math.max(12, rect.top - 46);
                        const left = Math.max(10, Math.min(window.innerWidth - 150, rect.left + (rect.width / 2) - 50));

                        dictSelectionPill.style.top = `${top}px`;
                        dictSelectionPill.style.left = `${left}px`;
                        dictSelectionPill.style.display = 'flex';
                        dictSelectionPill.dataset.kw = selectedText;
                        const pillLabel = dictSelectionPill.querySelector('.pill-label');
                        if (pillLabel) {
                            const displayKw = selectedText.length > 8 ? selectedText.substring(0, 8) + '…' : selectedText;
                            pillLabel.textContent = `사전·용례 ('${displayKw}')`;
                        }
                        return;
                    }
                } catch {
                    // Ignore range get error
                }
            }
        }

        hideSelectionPill();
    }

    if (dictSelectionPill) {
        dictSelectionPill.addEventListener('click', (e) => {
            e.stopPropagation();
            const kw = dictSelectionPill.dataset.kw || '';
            hideSelectionPill();
            openDictDrawer(kw);
        });
    }

    // Paging Arrows & Buttons
    const navArrowLeft = document.getElementById('nav-arrow-left');
    const navArrowRight = document.getElementById('nav-arrow-right');
    if (navArrowLeft) navArrowLeft.addEventListener('click', showPrevPage);
    if (navArrowRight) navArrowRight.addEventListener('click', showNextPage);
    if (prevPageBtn) prevPageBtn.addEventListener('click', showPrevPage);
    if (nextPageBtn) nextPageBtn.addEventListener('click', showNextPage);

    // Sidebar and Modal Closes
    closeSidebarBtn.addEventListener('click', closeSidebar);
    closeSettingsBtn.addEventListener('click', closeSettingsDrawer);
    overlay.addEventListener('click', () => {
        closeSidebar();
        closeSettingsDrawer();
        closeShortcutModal();
        closeDictDrawer();
    });
    closeShortcutModalBtn.addEventListener('click', closeShortcutModal);
    closeShortcutBottomBtn.addEventListener('click', closeShortcutModal);

    // Reader Preferences Drawer Controls
    // 1. Theme Chips
    document.querySelectorAll('.theme-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            prefs.theme = chip.dataset.theme;
            applyPreferences();
            savePreferences();
        });
    });

    // 2. Font Selector
    document.querySelectorAll('.font-selector .segment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            prefs.font = btn.dataset.font;
            applyPreferences();
            savePreferences();
            repaginateAndRender();
        });
    });

    // 3. Font Size Slider & Stepper
    if (fontSizeSlider) {
        fontSizeSlider.addEventListener('input', (e) => {
            prefs.fontSize = parseInt(e.target.value, 10);
            applyPreferences();
            savePreferences();
            repaginateAndRender();
        });
    }
    if (fontDecreaseBtn) {
        fontDecreaseBtn.addEventListener('click', () => {
            if (prefs.fontSize > 14) {
                prefs.fontSize -= 1;
                applyPreferences();
                savePreferences();
                repaginateAndRender();
            }
        });
    }
    if (fontIncreaseBtn) {
        fontIncreaseBtn.addEventListener('click', () => {
            if (prefs.fontSize < 28) {
                prefs.fontSize += 1;
                applyPreferences();
                savePreferences();
                repaginateAndRender();
            }
        });
    }

    // 4. Line Height
    document.querySelectorAll('.line-height-selector .segment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            prefs.lineHeight = parseFloat(btn.dataset.lh);
            applyPreferences();
            savePreferences();
            repaginateAndRender();
        });
    });

    // 5. Width
    document.querySelectorAll('.width-selector .segment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            prefs.width = parseInt(btn.dataset.width, 10);
            applyPreferences();
            savePreferences();
            repaginateAndRender();
        });
    });

    // 6. View Mode (Paging vs Scroll)
    document.querySelectorAll('.view-mode-selector .segment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            prefs.mode = btn.dataset.mode;
            applyPreferences();
            savePreferences();
            if (prefs.mode === 'scroll') {
                renderScrollMode();
            } else {
                repaginateAndRender();
            }
        });
    });

    // 7. Toggle Original View
    if (toggleOriginalSwitch) {
        toggleOriginalSwitch.addEventListener('change', async (e) => {
            prefs.showOriginal = e.target.checked;
            applyPreferences();
            savePreferences();
            if (prefs.mode === 'scroll') {
                renderScrollMode();
            } else {
                await repaginateAndRender();
            }
        });
    }

    if (viewOriginalBtn) {
        viewOriginalBtn.addEventListener('click', async () => {
            prefs.showOriginal = !prefs.showOriginal;
            applyPreferences();
            savePreferences();
            if (prefs.mode === 'scroll') {
                renderScrollMode();
            } else {
                await repaginateAndRender();
            }
        });
    }

    // Mobile Nav Setting
    if (mobileNavSetting) {
        mobileNavSetting.addEventListener('change', (e) => {
            if (e.target.name === 'mobile-nav') {
                mobileNavMode = e.target.value;
                localStorage.setItem('mobileNavMode', mobileNavMode);
            }
        });
    }

    // Window Resize Handling
    let resizeTimer;
    let lastWindowWidth = window.innerWidth;
    window.addEventListener('resize', () => {
        // 1. Never repaginate while an editing session is in progress (keyboard appearance triggers resize!)
        if (document.querySelector('.translation-item.editing')) {
            return;
        }

        // 2. On mobile devices, virtual keyboard or address bar toggle changes height only.
        // We only want to repaginate if viewport width actually changed (e.g. screen orientation change).
        if (window.innerWidth === lastWindowWidth) {
            return;
        }
        lastWindowWidth = window.innerWidth;

        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            if (prefs.mode === 'paging') repaginateAndRender();
        }, 250);
    });

    // --- Start ---
    loadPreferences();
    await loadBook();
});
