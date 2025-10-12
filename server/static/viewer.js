
document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM Elements ---
    const bookTitleElement = document.getElementById('book-title');
    const contentArea = document.getElementById('content-area');
    const focusModeBtn = document.getElementById('focus-mode-btn');
    const viewerContainer = document.querySelector('.viewer-container');
    const bookContainer = document.getElementById('book-container');
    const navArrowLeft = document.getElementById('nav-arrow-left');
    const navArrowRight = document.getElementById('nav-arrow-right');
    
    // Sidebar and TOC Elements
    const tocBtn = document.getElementById('toc-btn');
    const sidebar = document.getElementById('sidebar-toc');
    const sidebarContent = document.getElementById('sidebar-content');
    const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
    const sidebarOverlay = document.getElementById('sidebar-overlay');

    // Buttons moved to sidebar
    const viewOriginalBtn = document.getElementById('view-original-btn');
    const nightModeBtn = document.getElementById('night-mode-btn');

    // --- State ---
    let tocItems = [];
    let currentItem = null;
    let showOriginal = localStorage.getItem('showOriginalText') === 'true';
    let saveTimeout;

    // --- Initialization ---
    const urlParams = new URLSearchParams(window.location.search);
    const bookName = urlParams.get('book');
    bookTitleElement.textContent = bookName || '책을 찾을 수 없음';
    applyInitialTheme();

    // --- Event Listeners ---
    focusModeBtn.addEventListener('click', () => viewerContainer.classList.toggle('focus-mode'));
    document.addEventListener('keydown', handleKeyPress);
    bookContainer.addEventListener('click', handleBookClick);
    bookContainer.addEventListener('mousemove', handleBookMouseMove);
    bookContainer.addEventListener('mouseleave', handleBookMouseLeave);

    // Sidebar listeners
    tocBtn.addEventListener('click', openSidebar);
    sidebarCloseBtn.addEventListener('click', closeSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);

    // Moved buttons listeners
    viewOriginalBtn.addEventListener('click', toggleOriginalView);
    nightModeBtn.addEventListener('click', toggleNightMode);

    // --- Main Execution ---
    await loadInitialData();

    // --- Functions ---

    async function loadInitialData() {
        if (!bookName) return;
        try {
            const [tocResponse, activityResponse] = await Promise.all([
                fetch(`/api/books/${encodeURIComponent(bookName)}/toc`),
                fetch(`/api/books/${encodeURIComponent(bookName)}/activity`)
            ]);

            if (!tocResponse.ok) throw new Error('Failed to load Table of Contents');
            tocItems = await tocResponse.json();

            if (tocItems.length === 0) {
                contentArea.innerHTML = '<p>표시할 내용이 없습니다.</p>';
                return;
            }

            renderToc();

            let initialItemId = tocItems[0].id;
            if (activityResponse.ok) {
                const activityData = await activityResponse.json();
                const lastReadItem = tocItems.find(item => item.pid === activityData.last_read_pid);
                if (lastReadItem) {
                    initialItemId = lastReadItem.id;
                }
            }
            
            await navigateToItem(initialItemId);

        } catch (error) {
            console.error('Error loading initial data:', error);
            contentArea.innerHTML = `<p style="color: red;">콘텐츠를 불러오는 데 실패했습니다: ${error.message}</p>`;
        }
    }

    async function navigateToItem(itemId) {
        try {
            contentArea.innerHTML = '<p>로딩 중...</p>';
            const response = await fetch(`/api/items/${itemId}`);
            if (!response.ok) throw new Error('Failed to load item');
            
            currentItem = await response.json();
            renderItem(currentItem);
            updateActiveTocItem(currentItem.id);
            saveLastReadPosition(currentItem.pid);

        } catch (error) {
            console.error('Failed to navigate to item:', error);
            contentArea.innerHTML = '<p style="color: red;">항목을 불러오는 데 실패했습니다.</p>';
        }
    }

    function renderItem(item) {
        bookTitleElement.textContent = item.title || bookName;
        let html = '<div class="translation-item">';
        if (showOriginal) {
            html += `<p class="original-text">${escapeHtml(item.original)}</p>`;
        }
        html += `<p class="translated-text">${escapeHtml(item.translated)}</p></div>`;
        contentArea.innerHTML = html;
    }

    function renderToc() {
        sidebarContent.innerHTML = tocItems.map(item => 
            `<a href="#" class="toc-item" data-id="${item.id}">${item.title || item.pid || '항목'}</a>`
        ).join('');
        
        // Add event listeners to newly created TOC items
        document.querySelectorAll('.toc-item').forEach(el => {
            el.addEventListener('click', (e) => {
                e.preventDefault();
                const itemId = parseInt(e.target.dataset.id, 10);
                navigateToItem(itemId);
                closeSidebar();
            });
        });
    }

    function updateActiveTocItem(activeId) {
        document.querySelectorAll('.toc-item').forEach(el => {
            el.classList.toggle('active', parseInt(el.dataset.id, 10) === activeId);
        });
    }

    async function showNextItem() {
        if (!currentItem) return;
        try {
            const response = await fetch(`/api/items/${currentItem.id}/next`);
            if (!response.ok) { /* No more items */ return; }
            const nextItem = await response.json();
            await navigateToItem(nextItem.id);
        } catch (error) {
            console.error('Failed to get next item:', error);
        }
    }

    async function showPrevItem() {
        if (!currentItem) return;
        try {
            const response = await fetch(`/api/items/${currentItem.id}/prev`);
            if (!response.ok) { /* No more items */ return; }
            const prevItem = await response.json();
            await navigateToItem(prevItem.id);
        } catch (error) {
            console.error('Failed to get previous item:', error);
        }
    }

    function saveLastReadPosition(pid) {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            if (!pid || !bookName) return;
            const payload = { last_read_pid: pid, last_read_timestamp: Math.floor(Date.now() / 1000) };
            fetch(`/api/books/${encodeURIComponent(bookName)}/activity`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).catch(error => console.error('Failed to save last read position:', error));
        }, 1500);
    }

    // --- UI Handlers ---
    function openSidebar() {
        sidebar.classList.add('open');
        sidebarOverlay.classList.add('open');
    }

    function closeSidebar() {
        sidebar.classList.remove('open');
        sidebarOverlay.classList.remove('open');
    }

    function handleKeyPress(e) {
        if (e.key === 'ArrowLeft') showPrevItem();
        else if (e.key === 'ArrowRight') showNextItem();
    }

    function handleBookClick(e) {
        const rect = bookContainer.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const clickArea = clickX / rect.width;
        if (clickArea < 0.3) showPrevItem();
        else if (clickArea > 0.7) showNextItem();
    }

    function handleBookMouseMove(e) {
        const rect = bookContainer.getBoundingClientRect();
        const hoverX = e.clientX - rect.left;
        const hoverArea = hoverX / rect.width;
        if (hoverArea < 0.3) {
            navArrowLeft.style.opacity = '1';
        } else if (hoverArea > 0.7) {
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

    function toggleOriginalView() {
        showOriginal = !showOriginal;
        localStorage.setItem('showOriginalText', showOriginal);
        if(currentItem) renderItem(currentItem); // Re-render current item
        viewOriginalBtn.classList.toggle('active', showOriginal);
    }

    function applyInitialTheme() {
        const isNightMode = localStorage.getItem('nightMode') === 'true';
        if (isNightMode) {
            document.body.classList.add('dark-mode');
            nightModeBtn.textContent = '주간 모드';
            nightModeBtn.classList.add('active');
        }
    }

    function toggleNightMode() {
        const isNightMode = document.body.classList.toggle('dark-mode');
        localStorage.setItem('nightMode', isNightMode);
        nightModeBtn.textContent = isNightMode ? '주간 모드' : '야간 모드';
        nightModeBtn.classList.toggle('active', isNightMode);
    }
    
    function escapeHtml(text) {
        if (text === null || text === undefined) return '';
        return text.toString()
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});
