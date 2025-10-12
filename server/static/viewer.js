document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM Elements ---
    const bookTitleElement = document.getElementById('book-title');
    const contentArea = document.getElementById('content-area');
    const focusModeBtn = document.getElementById('focus-mode-btn');
    const viewOriginalBtn = document.getElementById('view-original-btn');
    const nightModeBtn = document.getElementById('night-mode-btn');
    const viewerContainer = document.querySelector('.viewer-container');
    const bookContainer = document.getElementById('book-container');
    const pageIndicator = document.getElementById('page-indicator');
    const navArrowLeft = document.getElementById('nav-arrow-left');
    const navArrowRight = document.getElementById('nav-arrow-right');

    // --- State ---
    let translationItems = [];
    let pages = [];
    let currentPage = 0;
    let showOriginal = localStorage.getItem('showOriginalText') === 'true';
    let saveTimeout;

    // --- Initialization ---
    applyInitialTheme();
    const urlParams = new URLSearchParams(window.location.search);
    const bookName = urlParams.get('book');
    bookTitleElement.textContent = bookName || '책을 찾을 수 없음';

    if (showOriginal) {
        viewOriginalBtn.classList.add('active');
    }

    // --- Event Listeners ---
    focusModeBtn.addEventListener('click', toggleFocusMode);
    viewOriginalBtn.addEventListener('click', toggleOriginalView);
    nightModeBtn.addEventListener('click', toggleNightMode);
    document.addEventListener('keydown', handleKeyPress);
    contentArea.addEventListener('mouseup', handleTextSelection);
    
    bookContainer.addEventListener('click', handleBookClick);
    bookContainer.addEventListener('mousemove', handleBookMouseMove);
    bookContainer.addEventListener('mouseleave', handleBookMouseLeave);

    // --- Main Execution ---
    await loadBook();

    // --- Functions ---

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

    async function loadBook() {
        try {
            const [contentResponse, activityResponse] = await Promise.all([
                fetch(`/stream?book=${encodeURIComponent(bookName)}`),
                fetch(`/api/books/${encodeURIComponent(bookName)}/activity`)
            ]);

            if (!contentResponse.ok) throw new Error(`Server error (content): ${contentResponse.status}`);
            
            const sseText = await contentResponse.text();
            translationItems = sseText.split('\n\n')
                .filter(line => line.startsWith('data:'))
                .map(line => JSON.parse(line.substring(5)));

            if (translationItems.length === 0) {
                contentArea.innerHTML = '<p>표시할 내용이 없습니다.</p>';
                return;
            }

            const bookTitleFromData = translationItems[0]?.title || bookName;
            bookTitleElement.textContent = bookTitleFromData;

            await paginate();

            let startingPage = 0;
            if (activityResponse.ok) {
                const activityData = await activityResponse.json();
                if (activityData.last_read_pid) {
                    const pageIndex = pages.findIndex(pageItems => 
                        pageItems.some(item => item.pid === activityData.last_read_pid)
                    );
                    if (pageIndex !== -1) {
                        startingPage = pageIndex;
                    }
                }
            }

            renderPage(startingPage, true); // Pass true for initial load

        } catch (error) {
            console.error('Error loading book:', error);
            contentArea.innerHTML = `<p style="color: red;">콘텐츠를 불러오는 데 실패했습니다: ${error.message}</p>`;
        }
    }

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
            measurer.style.left = '-9999px';
            measurer.style.width = contentArea.clientWidth + 'px';
            measurer.style.padding = getComputedStyle(contentArea).padding;
            measurer.style.lineHeight = getComputedStyle(contentArea).lineHeight;
            measurer.style.fontSize = getComputedStyle(contentArea).fontSize;
            document.body.appendChild(measurer);

            for (const item of translationItems) {
                const itemHtml = createItemHtml(item);
                measurer.innerHTML += itemHtml;

                if (measurer.scrollHeight > maxPageHeight) {
                    pages.push(currentPageItems);
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
            currentPage = pageIndex;
            const pageItems = pages[currentPage];
            
            if (!pageItems) return;

            contentArea.innerHTML = pageItems.map(createItemHtml).join('');
            pageIndicator.textContent = `${currentPage + 1} / ${pages.length}`;
            contentArea.style.opacity = '1';

            saveLastReadPosition();
        };

        if (isInitialLoad) {
            updateContent();
        } else {
            contentArea.style.opacity = '0';
            setTimeout(updateContent, 200); // Match CSS transition duration
        }
    }

    function createItemHtml(item) {
        let itemHtml = `<div class="translation-item" 
                             data-id="${item.id}" 
                             data-url="${item.url}" 
                             data-pid="${item.pid}" 
                             data-original="${escapeHtml(item.original)}">`;
        if (showOriginal) {
            itemHtml += `<p class="original-text">${escapeHtml(item.original)}</p>`;
        }
        itemHtml += `<p class="translated-text">${escapeHtml(item.translated)}</p></div>`;
        return itemHtml;
    }

    function saveLastReadPosition() {
        clearTimeout(saveTimeout);
        saveTimeout = setTimeout(() => {
            const firstItemOnPage = pages[currentPage]?.[0];
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

    function showPrevPage() {
        if (currentPage > 0) {
            renderPage(currentPage - 1);
        }
    }

    function showNextPage() {
        if (currentPage < pages.length - 1) {
            renderPage(currentPage + 1);
        }
    }

    function handleKeyPress(e) {
        if (e.key === 'ArrowLeft') {
            showPrevPage();
        } else if (e.key === 'ArrowRight') {
            showNextPage();
        }
    }

    function handleBookClick(e) {
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
        const rect = bookContainer.getBoundingClientRect();
        const hoverX = e.clientX - rect.left;
        const hoverArea = hoverX / rect.width;

        if (hoverArea < 0.3) {
            navArrowLeft.style.opacity = '1';
            navArrowRight.style.opacity = '0';
            bookContainer.classList.add('hover-left');
            bookContainer.classList.remove('hover-right');
        } else if (hoverArea > 0.7) {
            navArrowLeft.style.opacity = '0';
            navArrowRight.style.opacity = '1';
            bookContainer.classList.remove('hover-left');
            bookContainer.classList.add('hover-right');
        } else {
            navArrowLeft.style.opacity = '0';
            navArrowRight.style.opacity = '0';
            bookContainer.classList.remove('hover-left', 'hover-right');
        }
    }

    function handleBookMouseLeave() {
        navArrowLeft.style.opacity = '0';
        navArrowRight.style.opacity = '0';
        bookContainer.classList.remove('hover-left', 'hover-right');
    }

    function toggleFocusMode() {
        viewerContainer.classList.toggle('focus-mode');
        focusModeBtn.textContent = viewerContainer.classList.contains('focus-mode') ? '집중 모드 종료' : '집중 모드';
    }

    function toggleOriginalView() {
        showOriginal = !showOriginal;
        localStorage.setItem('showOriginalText', showOriginal);
        window.location.reload();
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
            url: translationItem.dataset.url,
            pid: translationItem.dataset.pid,
            original: translationItem.dataset.original,
            translated: newTranslatedText,
            timestamp: Math.floor(Date.now() / 1000)
        };

        try {
            const response = await fetch('/translations/upsert', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([itemData])
            });
            if (!response.ok) throw new Error('Failed to save changes.');

            disableEditing(translationItem);
            translatedTextElement.style.transition = 'background-color 0.5s';
            translatedTextElement.style.backgroundColor = '#e6ffed';
            setTimeout(() => {
                translatedTextElement.style.backgroundColor = '';
            }, 1500);
            
            const itemId = parseInt(translationItem.dataset.id);
            const sourceItem = translationItems.find(i => i.id === itemId);
            if(sourceItem) sourceItem.translated = newTranslatedText;

        } catch (error) {
            console.error('Error saving changes:', error);
            alert('저장에 실패했습니다.');
        }
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