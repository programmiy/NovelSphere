
document.addEventListener('DOMContentLoaded', async () => {
    // --- DOM Elements ---
    const bookTitleElement = document.getElementById('book-title');
    const contentArea = document.getElementById('content-area');
    const focusModeBtn = document.getElementById('focus-mode-btn');
    const viewOriginalBtn = document.getElementById('view-original-btn');
    const viewerContainer = document.querySelector('.viewer-container');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const pageIndicator = document.getElementById('page-indicator');

    // --- State ---
    let translationItems = [];
    let pages = [];
    let currentPage = 0;
    let showOriginal = localStorage.getItem('showOriginalText') === 'true';

    // --- Initialization ---
    const urlParams = new URLSearchParams(window.location.search);
    const bookName = urlParams.get('book');
    bookTitleElement.textContent = bookName || '책을 찾을 수 없음';

    if (showOriginal) {
        viewOriginalBtn.classList.add('active');
    }

    // --- Event Listeners ---
    focusModeBtn.addEventListener('click', toggleFocusMode);
    viewOriginalBtn.addEventListener('click', toggleOriginalView);
    prevPageBtn.addEventListener('click', showPrevPage);
    nextPageBtn.addEventListener('click', showNextPage);
    document.addEventListener('keydown', handleKeyPress);
    contentArea.addEventListener('mouseup', handleTextSelection);

    // --- Main Execution ---
    await loadBook();

    // --- Functions ---

    async function loadBook() {
        try {
            const response = await fetch(`/stream?book=${encodeURIComponent(bookName)}`);
            if (!response.ok) throw new Error(`Server error: ${response.status}`);
            
            const sseText = await response.text();
            translationItems = sseText.split('\n\n')
                .filter(line => line.startsWith('data:'))
                .map(line => JSON.parse(line.substring(5)));

            if (translationItems.length === 0) {
                contentArea.innerHTML = '<p>표시할 내용이 없습니다.</p>';
                return;
            }

            const bookTitleFromData = translationItems[0]?.title || bookName;
            bookTitleElement.textContent = bookTitleFromData;

            // Wait for the browser to render everything before paginating
            await paginate();
            renderPage(currentPage);

        } catch (error) {
            console.error('Error loading book:', error);
            contentArea.innerHTML = `<p style="color: red;">콘텐츠를 불러오는 데 실패했습니다: ${error.message}</p>`;
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
            let currentPageHtml = '';
            const maxPageHeight = contentArea.clientHeight;

            // Create a hidden measurer div with the same styles as the content area
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
                    pages.push(currentPageHtml); // Save the page before it overflowed
                    currentPageHtml = itemHtml; // Start new page with the current item
                    measurer.innerHTML = itemHtml;
                } else {
                    currentPageHtml += itemHtml;
                }
            }

            // Add the last page
            if (currentPageHtml) {
                pages.push(currentPageHtml);
            }

            document.body.removeChild(measurer);
            resolve();
        });
    }

    function renderPage(pageIndex) {
        if (pageIndex < 0 || pageIndex >= pages.length) return;

        currentPage = pageIndex;
        contentArea.innerHTML = pages[currentPage];

        // Update UI
        pageIndicator.textContent = `${currentPage + 1} / ${pages.length}`;
        prevPageBtn.disabled = currentPage === 0;
        nextPageBtn.disabled = currentPage === pages.length - 1;
    }

    function createItemHtml(item) {
        let itemHtml = `<div class="translation-item" 
                             data-id="${item.id}" 
                             data-url="${item.url}" 
                             data-pid="${item.pid}" 
                             data-original="${escapeHtml(item.original)}">
`;
        if (showOriginal) {
            itemHtml += `<p class="original-text">${escapeHtml(item.original)}</p>`;
        }
        itemHtml += `<p class="translated-text">${escapeHtml(item.translated)}</p></div>`;
        return itemHtml;
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

    function toggleFocusMode() {
        viewerContainer.classList.toggle('focus-mode');
        focusModeBtn.textContent = viewerContainer.classList.contains('focus-mode') ? '집중 모드 종료' : '집중 모드';
    }

    function toggleOriginalView() {
        showOriginal = !showOriginal;
        localStorage.setItem('showOriginalText', showOriginal);
        window.location.reload(); // Simple reload to re-paginate
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
            
            // Update the item in the source array to persist change across pagination
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
        return text.toString().replace(/[&<>'"\/]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;','\'':'&#039;','/':'&#x2F;'})[s]);
    }
});
