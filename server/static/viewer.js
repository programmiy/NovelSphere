document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM Elements ---
    const bookTitleElement = document.getElementById('book-title');
    const contentArea = document.getElementById('content-area');
    const focusModeBtn = document.getElementById('focus-mode-btn');
    const nightModeBtn = document.getElementById('night-mode-btn');
    const viewerContainer = document.querySelector('.viewer-container');
    const bookContainer = document.getElementById('book-container');
    const pageIndicator = document.getElementById('page-indicator'); // Re-using for chapter pages

    // Sidebar Elements
    const tocBtn = document.getElementById('toc-btn');
    const sidebar = document.getElementById('toc-sidebar');
    const closeSidebarBtn = document.getElementById('close-sidebar-btn');
    const tocList = document.getElementById('toc-list');
    const viewOriginalBtn = document.getElementById('view-original-btn');
    const overlay = document.getElementById('overlay');

    // --- State ---
    const urlParams = new URLSearchParams(window.location.search);
    const bookName = urlParams.get('book');
    
    let chapterTitles = [];
    let currentChapterIndex = -1;
    let currentChapterItems = [];
    let pages = [];
    let currentPageInChapter = 0;

    let showOriginal = localStorage.getItem('showOriginalText') === 'true';
    let saveTimeout;
    let touchStartX = 0;
    let touchStartY = 0;
    const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    let mobileNavMode = 'both'; // 'both', 'tap', 'swipe'

    const ICON_MAXIMIZE = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>';
    const ICON_MINIMIZE = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>';
    const ICON_SUN = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
    const ICON_MOON = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>';

    // --- Initialization ---
    applyInitialTheme();
    bookTitleElement.textContent = bookName || '책을 찾을 수 없음';
    if (showOriginal) viewOriginalBtn.classList.add('active');

    // --- Event Listeners ---
    contentArea.addEventListener('mouseup', handleTextSelection);
    focusModeBtn.addEventListener('click', toggleFocusMode);
    nightModeBtn.addEventListener('click', toggleNightMode);
    document.addEventListener('keydown', handleKeyPress);
    bookContainer.addEventListener('click', handleBookClick);
    bookContainer.addEventListener('mousemove', handleBookMouseMove);
    bookContainer.addEventListener('mouseleave', handleBookMouseLeave);
    bookContainer.addEventListener('touchstart', handleTouchStart, { passive: true });
    bookContainer.addEventListener('touchmove', handleTouchMove, { passive: false });
    bookContainer.addEventListener('touchend', handleTouchEnd, { passive: true });

    tocBtn.addEventListener('click', openSidebar);
    closeSidebarBtn.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);
    viewOriginalBtn.addEventListener('click', toggleOriginalView);

    function updateUIMode() {
        // 1. Remove existing arrows to ensure a clean state
        const existingLeft = document.getElementById('nav-arrow-left');
        const existingRight = document.getElementById('nav-arrow-right');
        if (existingLeft) existingLeft.remove();
        if (existingRight) existingRight.remove();

        // Determine if touch controls should be active
        const touchEnabled = !isMobile || mobileNavMode === 'tap' || mobileNavMode === 'both';

        if (touchEnabled) {
            // 2. Create and append new arrow elements
            const leftArrow = document.createElement('div');
            leftArrow.id = 'nav-arrow-left';
            leftArrow.className = 'nav-arrow left';
            leftArrow.innerHTML = '&lt;';

            const rightArrow = document.createElement('div');
            rightArrow.id = 'nav-arrow-right';
            rightArrow.className = 'nav-arrow right';
            rightArrow.innerHTML = '&gt;';

            bookContainer.appendChild(leftArrow);
            bookContainer.appendChild(rightArrow);
        }
    }

    const mobileNavSetting = document.getElementById('mobile-nav-setting');
    if (!isMobile) {
        mobileNavSetting.style.display = 'none';
        updateUIMode(); // Apply desktop mode
    } else {
        const savedNavMode = localStorage.getItem('mobileNavMode') || 'both';
        mobileNavMode = savedNavMode;
        const currentRadio = document.getElementById(`nav-${savedNavMode}`);
        if (currentRadio) {
            currentRadio.checked = true;
        }
        updateUIMode(); // Call on initial load

        mobileNavSetting.addEventListener('change', (e) => {
            if (e.target.name === 'mobile-nav') {
                mobileNavMode = e.target.value;
                localStorage.setItem('mobileNavMode', mobileNavMode);
                updateUIMode(); // Call on change
            }
        });
    }

    // --- Main Execution ---
    await loadBook();

    // --- Core Functions ---

    async function loadBook() {
        if (!bookName) {
            contentArea.innerHTML = '<p>책 이름이 지정되지 않았습니다.</p>';
            return;
        }
        try {
            // 1. Fetch activity data first to know where to start
            const activityResponse = await fetch(`/api/books/${encodeURIComponent(bookName)}/activity`);
            const activityData = activityResponse.ok ? await activityResponse.json() : {};

            // 2. Fetch the list of all chapters
            const chaptersResponse = await fetch(`/api/books/${encodeURIComponent(bookName)}/chapters`);
            if (!chaptersResponse.ok) throw new Error(`챕터 목록을 불러오지 못했습니다: ${chaptersResponse.status}`);
            
            chapterTitles = await chaptersResponse.json();

            if (chapterTitles.length === 0) {
                contentArea.innerHTML = '<p>표시할 챕터가 없습니다.</p>';
                return;
            }

            populateToc();
            
            // 3. Determine starting chapter and PID
            let startChapterIndex = 0;
            let startPid = null;

            if (activityData.last_read_chapter_title) {
                const foundIndex = chapterTitles.findIndex(title => title === activityData.last_read_chapter_title);
                if (foundIndex !== -1) {
                    startChapterIndex = foundIndex;
                    startPid = activityData.last_read_pid;
                }
            }
            
            // 4. Load the chapter, passing the specific PID to start on
            await loadChapter(startChapterIndex, 'first', startPid);

        } catch (error) {
            console.error('Error loading book:', error);
            contentArea.innerHTML = `<p style="color: red;">책을 불러오는 데 실패했습니다: ${error.message}</p>`;
        }
    }

    async function loadChapter(chapterIndex, pagePosition = 'first', startPid = null) {
        if (chapterIndex < 0 || chapterIndex >= chapterTitles.length) return;

        currentChapterIndex = chapterIndex;
        const chapterTitle = chapterTitles[currentChapterIndex];

        contentArea.innerHTML = `<p><em>'${chapterTitle}' 챕터를 불러오는 중...</em></p>`;
        updateActiveTocItem();

        try {
            const contentResponse = await fetch(`/api/books/${encodeURIComponent(bookName)}/chapter?title=${encodeURIComponent(chapterTitle)}`);
            if (!contentResponse.ok) throw new Error(`챕터 내용을 불러오지 못했습니다: ${contentResponse.status}`);
            
            currentChapterItems = await contentResponse.json();
            if (currentChapterItems.length === 0) {
                contentArea.innerHTML = '<p>이 챕터에 내용이 없습니다.</p>';
                return;
            }

            await paginate();

            let pageIndexToShow = 0;
            if (startPid) {
                const foundPage = pages.findIndex(page => page.some(item => item.pid === startPid));
                if (foundPage !== -1) {
                    pageIndexToShow = foundPage;
                }
            } else if (pagePosition === 'last') {
                pageIndexToShow = pages.length - 1;
            }

            renderPage(pageIndexToShow, true);

        } catch (error) {
            console.error(`Error loading chapter '${chapterTitle}':`, error);
            contentArea.innerHTML = `<p style="color: red;">챕터를 불러오는 데 실패했습니다: ${error.message}</p>`;
        }
    }

    async function paginate() {
        return new Promise(resolve => {
            // Ensure contentArea is visible and has dimensions
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
            document.body.appendChild(measurer);

            for (const item of currentChapterItems) {
                const itemHtml = createItemHtml(item);
                measurer.innerHTML += itemHtml;

                if (measurer.scrollHeight > maxPageHeight) {
                    if (currentPageItems.length > 0) {
                        pages.push(currentPageItems);
                    } else {
                        // If a single item is taller than the page, put it on its own page
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

        // Reset arrows on page turn, only if they exist
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

            saveLastReadPosition();
        };

        if (isInitialLoad) {
            updateContent();
        } else {
            contentArea.style.opacity = '0';
            setTimeout(updateContent, 200); // Match CSS transition
        }
    }

    // --- Navigation and UI ---

    function showPrevPage() {
        if (currentPageInChapter > 0) {
            renderPage(currentPageInChapter - 1);
        } else if (currentChapterIndex > 0) {
            // Load previous chapter, last page
            loadChapter(currentChapterIndex - 1, 'last');
        }
    }

    function showNextPage() {
        if (currentPageInChapter < pages.length - 1) {
            renderPage(currentPageInChapter + 1);
        } else if (currentChapterIndex < chapterTitles.length - 1) {
            // Load next chapter, first page
            loadChapter(currentChapterIndex + 1, 'first');
        }
    }

    function populateToc() {
        tocList.innerHTML = '';
        chapterTitles.forEach((title, index) => {
            const div = document.createElement('div');
            div.className = 'toc-item';
            div.dataset.index = index;
            div.textContent = title || `(제목 없음)`;
            div.title = title;
            div.addEventListener('click', () => {
                loadChapter(index, 'first');
                closeSidebar();
            });
            tocList.appendChild(div);
        });
    }

    function updateActiveTocItem() {
        document.querySelectorAll('.toc-item').forEach(el => {
            if (parseInt(el.dataset.index, 10) === currentChapterIndex) {
                el.classList.add('active');
                el.scrollIntoView({ block: 'nearest' });
            } else {
                el.classList.remove('active');
            }
        });
    }

    async function toggleOriginalView() {
        // 1. Toggle state
        showOriginal = !showOriginal;
        localStorage.setItem('showOriginalText', showOriginal);
        viewOriginalBtn.classList.toggle('active', showOriginal);

        // 2. Repaginate and render
        await repaginateAndRender();
    }

    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => repaginateAndRender(), 250);
    });

    async function repaginateAndRender() {
        const topItemPid = pages[currentPageInChapter]?.[0]?.pid;
        await paginate();
        let newPageIndex = 0;
        if (topItemPid) {
            const foundPage = pages.findIndex(page => page.some(item => item.pid === topItemPid));
            if (foundPage !== -1) {
                newPageIndex = foundPage;
            }
        }
        renderPage(newPageIndex, true);
    }

    function openSidebar() {
        sidebar.classList.add('open');
        overlay.classList.add('visible');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
    }

    // --- Helper Functions ---

    function createItemHtml(item) {
        let itemHtml = `<div class="translation-item" data-id="${item.id}" data-pid="${item.pid}" data-original="${escapeHtml(item.original)}">`;
        if (showOriginal) {
            itemHtml += `<p class="original-text">${escapeHtml(item.original)}</p>`;
        }
        itemHtml += `<p class="translated-text">${escapeHtml(item.translated)}</p></div>`;
        return itemHtml;
    }

    function saveLastReadPosition() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => commitPosition(false), 1500);
    }

    window.addEventListener('pagehide', () => commitPosition(true));

    function commitPosition(useKeepalive) {
        const firstItemOnPage = pages[currentPageInChapter]?.[0];
        if (!firstItemOnPage || !bookName) return;

        const payload = {
            last_read_pid: firstItemOnPage.pid,
            last_read_timestamp: Math.floor(Date.now() / 1000)
        };

        const headers = { type: 'application/json' };
        const blob = new Blob([JSON.stringify(payload)], headers);
        
        // Use sendBeacon for reliability on exit, but it only sends POST
        // The endpoint must accept POST. For now, we use fetch with keepalive.
        fetch(`/api/books/${encodeURIComponent(bookName)}/activity`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: useKeepalive
        }).catch(error => console.error('Failed to save last read position:', error));
    }

    function handleKeyPress(e) {
        // If the user is editing text, don't turn the page with arrow keys.
        if (e.target.isContentEditable) {
            return;
        }

        const currentUrl = currentChapterItems?.[0]?.url;
        if (currentUrl && currentUrl.includes('kakuyomu.jp')) {
            if (e.key === 'ArrowLeft') {
                showPrevPage();
            } else if (e.key === 'ArrowRight') {
                showNextPage();
            } else if (e.key === 'PageDown' || e.key === ' ') { // Page Down key or Spacebar
                // Check if scroll is at the end of the content area
                const { scrollTop, scrollHeight, clientHeight } = contentArea;
                if (scrollHeight - scrollTop <= clientHeight + 1) { // +1 for minor floating point discrepancies
                    showNextPage();
                    e.preventDefault(); // Prevent default browser scroll
                }
            }
        }
        // For other sites, the default key behavior will apply or other navigation methods will be used.
    }

    function handleBookClick(e) {
        // In swipe-only mode, tap navigation is disabled.
        if (isMobile && mobileNavMode === 'swipe') return;

        // If the user is editing or has selected text, don't turn the page.
        if (e.target.closest('.editing') || !window.getSelection().isCollapsed) {
            return;
        }

        const rect = bookContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickArea = clickX / rect.width;

        if (clickArea < 0.3) {
            showPrevPage();
        } else if (clickArea > 0.7) {
            showNextPage();
        }
    }

    function handleBookMouseMove(e) {
        const navArrowLeft = document.getElementById('nav-arrow-left');
        const navArrowRight = document.getElementById('nav-arrow-right');
        if (!navArrowLeft || !navArrowRight) return; // Arrows don't exist, do nothing.

        const rect = bookContainer.getBoundingClientRect();
        const hoverX = e.clientX - rect.left;
        const hoverArea = hoverX / rect.width;
        if (hoverArea < 0.3) {
            navArrowLeft.style.opacity = '1';
            navArrowRight.style.opacity = '0';
        } else if (hoverArea > 0.7) {
            navArrowLeft.style.opacity = '0';
            navArrowRight.style.opacity = '1';
        } else {
            navArrowLeft.style.opacity = '0';
            navArrowRight.style.opacity = '0';
        }
    }

    function handleBookMouseLeave() {
        const navArrowLeft = document.getElementById('nav-arrow-left');
        const navArrowRight = document.getElementById('nav-arrow-right');
        if (navArrowLeft) navArrowLeft.style.opacity = '0';
        if (navArrowRight) navArrowRight.style.opacity = '0';
    }

    function handleTouchStart(e) {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
    }

    function handleTouchMove(e) {
        // If swipe is not enabled, do nothing.
        if (mobileNavMode === 'tap') return;
        
        // If swipe is more horizontal than vertical, prevent vertical scroll
        if (Math.abs(e.touches[0].clientX - touchStartX) > Math.abs(e.touches[0].clientY - touchStartY)) {
            e.preventDefault();
        }
    }

    function handleTouchEnd(e) {
        // If swipe is not enabled, do nothing.
        if (mobileNavMode === 'tap') return;

        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const deltaX = touchEndX - touchStartX;
        const deltaY = touchEndY - touchStartY;
        const swipeThreshold = 50; // Minimum distance for a swipe

        // Check for a horizontal swipe and not a vertical scroll
        if (Math.abs(deltaX) > swipeThreshold && Math.abs(deltaY) < swipeThreshold) {
            if (deltaX > 0) { // Swiped right
                showPrevPage();
            } else { // Swiped left
                showNextPage();
            }
        }
    }

    function updateFocusModeButton() {
        if (viewerContainer.classList.contains('focus-mode')) {
            focusModeBtn.innerHTML = ICON_MINIMIZE;
            focusModeBtn.title = '집중 모드 종료';
        } else {
            focusModeBtn.innerHTML = ICON_MAXIMIZE;
            focusModeBtn.title = '집중 모드';
        }
    }

    function toggleFocusMode() {
        viewerContainer.classList.toggle('focus-mode');
        updateFocusModeButton();
    }

    function updateNightModeButton() {
        const isNightMode = document.body.classList.contains('dark-mode');
        if (isNightMode) {
            nightModeBtn.innerHTML = ICON_SUN;
            nightModeBtn.title = '주간 모드';
        } else {
            nightModeBtn.innerHTML = ICON_MOON;
            nightModeBtn.title = '야간 모드';
        }
        nightModeBtn.classList.toggle('active', isNightMode);
    }

    function toggleNightMode() {
        document.body.classList.toggle('dark-mode');
        localStorage.setItem('nightMode', document.body.classList.contains('dark-mode'));
        updateNightModeButton();
    }

    function applyInitialTheme() {
        const isNightMode = localStorage.getItem('nightMode') === 'true';
        if (isNightMode) {
            document.body.classList.add('dark-mode');
        }
        updateNightModeButton();
    }

    function handleTextSelection(e) {
        const selection = window.getSelection();
        if (!selection.isCollapsed && selection.toString().trim()) {
            const target = selection.anchorNode.parentElement;
            const translationItem = target.closest('.translation-item');
            if (translationItem) {
                enableEditing(translationItem);
            }
        }
    }

    function enableEditing(translationItem) {
        // Disable other editing items
        document.querySelectorAll('.editing').forEach(item => {
            if (item !== translationItem) disableEditing(item);
        });

        if (translationItem.classList.contains('editing')) return;

        translationItem.classList.add('editing');
        const translatedTextElement = translationItem.querySelector('.translated-text');
        translatedTextElement.contentEditable = 'true';
        translatedTextElement.focus();


        const saveBtn = document.createElement('button');
        saveBtn.textContent = '저장';
        saveBtn.className = 'btn btn-save';
        saveBtn.onclick = () => saveChanges(translationItem);

        translationItem.appendChild(saveBtn);
    }

    function disableEditing(translationItem) {
        translationItem.classList.remove('editing');
        const translatedTextElement = translationItem.querySelector('.translated-text');
        translatedTextElement.contentEditable = 'false';
        const saveBtn = translationItem.querySelector('.btn-save');
        if (saveBtn) saveBtn.remove();
    }

    async function saveChanges(translationItem) {
        const translatedTextElement = translationItem.querySelector('.translated-text');
        const newTranslatedText = translatedTextElement.textContent;

        const itemData = {
            url: currentChapterItems[0].url, // Assuming all items in a chapter share the same URL
            pid: translationItem.dataset.pid,
            original: translationItem.dataset.original,
            translated: newTranslatedText,
            timestamp: Math.floor(Date.now() / 1000),
            title: currentChapterItems[0].title
        };

        try {
            const response = await fetch('/translations/upsert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([itemData])
            });
            if (!response.ok) throw new Error('Failed to save changes.');

            disableEditing(translationItem);
            
            // Visually indicate success
            translatedTextElement.style.transition = 'background-color 0.5s';
            translatedTextElement.style.backgroundColor = '#e6ffed';
            setTimeout(() => {
                translatedTextElement.style.backgroundColor = '';
            }, 1500);
            
            // Update the item in the local state to prevent stale data
            const itemId = parseInt(translationItem.dataset.id);
            const sourceItem = currentChapterItems.find(i => i.id === itemId);
            if(sourceItem) sourceItem.translated = newTranslatedText;

        } catch (error) {
            console.error('Error saving changes:', error);
            alert('저장에 실패했습니다.');
        }
    }

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    // --- Connection Status ---
    (function() {
        function showConnectionStatus(isOnline) {
            let toast = document.getElementById('connection-toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.id = 'connection-toast';
                document.body.appendChild(toast);
            }

            if (isOnline) {
                toast.textContent = '온라인 상태입니다.';
                toast.className = 'online';
            } else {
                toast.textContent = '오프라인 상태입니다. 일부 기능이 제한될 수 있습니다.';
                toast.className = 'offline';
            }

            // Show the toast
            toast.classList.add('show');

            // Hide after 3 seconds
            setTimeout(() => {
                toast.classList.remove('show');
            }, 3000);
        }

        window.addEventListener('online', () => showConnectionStatus(true));
        window.addEventListener('offline', () => showConnectionStatus(false));
    })();
});
