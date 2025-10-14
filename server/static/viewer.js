document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM Elements ---
    const bookTitleElement = document.getElementById('book-title');
    const contentArea = document.getElementById('content-area');
    const focusModeBtn = document.getElementById('focus-mode-btn');
    const nightModeBtn = document.getElementById('night-mode-btn');
    const viewerContainer = document.querySelector('.viewer-container');
    const bookContainer = document.getElementById('book-container');
    const navArrowLeft = document.getElementById('nav-arrow-left');
    const navArrowRight = document.getElementById('nav-arrow-right');
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

    // --- Initialization ---
    applyInitialTheme();
    bookTitleElement.textContent = bookName || '책을 찾을 수 없음';
    if (showOriginal) viewOriginalBtn.classList.add('active');

    // --- Event Listeners ---
    focusModeBtn.addEventListener('click', toggleFocusMode);
    nightModeBtn.addEventListener('click', toggleNightMode);
    document.addEventListener('keydown', handleKeyPress);
    bookContainer.addEventListener('click', handleBookClick);
    bookContainer.addEventListener('mousemove', handleBookMouseMove);
    bookContainer.addEventListener('mouseleave', handleBookMouseLeave);
    tocBtn.addEventListener('click', openSidebar);
    closeSidebarBtn.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);
    viewOriginalBtn.addEventListener('click', toggleOriginalView);

    // --- Main Execution ---
    await loadBook();

    // --- Core Functions ---

    async function loadBook() {
        if (!bookName) {
            contentArea.innerHTML = '<p>책 이름이 지정되지 않았습니다.</p>';
            return;
        }
        try {
            const chaptersResponse = await fetch(`/api/books/${encodeURIComponent(bookName)}/chapters`);
            if (!chaptersResponse.ok) throw new Error(`챕터 목록을 불러오지 못했습니다: ${chaptersResponse.status}`);
            
            chapterTitles = await chaptersResponse.json();

            if (chapterTitles.length === 0) {
                contentArea.innerHTML = '<p>표시할 챕터가 없습니다.</p>';
                return;
            }

            populateToc();
            
            // TODO: Restore last-read chapter functionality later
            await loadChapter(0, 'first');

        } catch (error) {
            console.error('Error loading book:', error);
            contentArea.innerHTML = `<p style="color: red;">책을 불러오는 데 실패했습니다: ${error.message}</p>`;
        }
    }

    async function loadChapter(chapterIndex, pagePosition = 'first') {
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
            if (pagePosition === 'last') {
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

    function toggleOriginalView() {
        showOriginal = !showOriginal;
        localStorage.setItem('showOriginalText', showOriginal);
        viewOriginalBtn.classList.toggle('active', showOriginal);
        if (pages.length > 0) {
            renderPage(currentPageInChapter, true); // Re-render current page instantly
        }
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
        let itemHtml = `<div class="translation-item" data-id="${item.id}" data-pid="${item.pid}">`;
        if (showOriginal) {
            itemHtml += `<p class="original-text">${escapeHtml(item.original)}</p>`;
        }
        itemHtml += `<p class="translated-text">${escapeHtml(item.translated)}</p></div>`;
        return itemHtml;
    }

    function saveLastReadPosition() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            const firstItemOnPage = pages[currentPageInChapter]?.[0];
            if (!firstItemOnPage || !bookName) return;

            const payload = {
                last_read_pid: firstItemOnPage.pid,
                last_read_timestamp: Math.floor(Date.now() / 1000)
            };

            fetch(`/api/books/${encodeURIComponent(bookName)}/activity`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(error => console.error('Failed to save last read position:', error));
        }, 1500);
    }

    function handleKeyPress(e) {
        if (e.key === 'ArrowLeft') showPrevPage();
        else if (e.key === 'ArrowRight') showNextPage();
    }

    function handleBookClick(e) {
        const rect = bookContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickArea = clickX / rect.width;
        if (clickArea < 0.3) showPrevPage();
        else if (clickArea > 0.7) showNextPage();
    }

    function handleBookMouseMove(e) {
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
        navArrowLeft.style.opacity = '0';
        navArrowRight.style.opacity = '0';
    }

    function toggleFocusMode() {
        viewerContainer.classList.toggle('focus-mode');
        focusModeBtn.textContent = viewerContainer.classList.contains('focus-mode') ? '집중 모드 종료' : '집중 모드';
    }

    function toggleNightMode() {
        const isNightMode = document.body.classList.toggle('dark-mode');
        localStorage.setItem('nightMode', isNightMode);
        nightModeBtn.textContent = isNightMode ? '주간 모드' : '야간 모드';
        nightModeBtn.classList.toggle('active', isNightMode);
    }

    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return text.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
    
    function applyInitialTheme() {
        const isNightMode = localStorage.getItem('nightMode') === 'true';
        if (isNightMode) {
            document.body.classList.add('dark-mode');
            nightModeBtn.textContent = '주간 모드';
            nightModeBtn.classList.add('active');
        }
    }
});