document.addEventListener('DOMContentLoaded', () => {
    // State
    let allBooks = [];
    let activeTagFilter = null;
    let currentEditingBook = null;
    let hoverTimeout = null;
    let activePreview = null;
    let initialModalState = {};

    // DOM Elements
    const bookShelf = document.getElementById('book-shelf');
    const tagFilterBar = document.getElementById('tag-filter-bar');
    const modal = document.getElementById('tag-editor-modal');
    const modalBookName = document.getElementById('tag-editor-book-name');
    const tagCheckboxForm = document.getElementById('tag-checkbox-form');
    const newTagForm = document.getElementById('new-tag-form');
    const newTagNameInput = document.getElementById('new-tag-name');
    const notesSummaryTextarea = document.getElementById('book-notes-summary');
    const summarySourceUrlInput = document.getElementById('book-summary-source-url');
    const crawlSummaryBtn = document.getElementById('crawl-summary-btn');
    const urlListModal = document.getElementById('url-list-modal');
    const urlListBody = document.getElementById('url-list-body');
    const urlListTitle = document.getElementById('url-list-title');
    const urlListCloseBtn = document.getElementById('url-list-close');

    // --- Core Functions ---
    async function fetchBooks() {
        try {
            const response = await fetch('/api/books');
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            allBooks = await response.json();
            displayContent();
        } catch (error) {
            bookShelf.innerHTML = `<p style="color: red;">책 목록을 불러오는 데 실패했습니다: ${error.message}</p>`;
        }
    }

    function displayContent() {
        renderTagFilters();
        renderBooks();
    }

    function renderTagFilters() {
        const allTags = new Map();
        allBooks.forEach(book => book.tags.forEach(tag => allTags.set(tag.name, tag)));
        const sortedTags = [...allTags.values()].sort((a, b) => a.name.localeCompare(b.name));

        let filtersHtml = `<button class="tag-filter ${!activeTagFilter ? 'active' : ''}" data-tag-name="null">전체</button>`;
        filtersHtml += sortedTags.map(tag =>
            `<button class="tag-filter ${activeTagFilter === tag.name ? 'active' : ''}" data-tag-name="${tag.name}">${tag.name}</button>`
        ).join('');
        tagFilterBar.innerHTML = filtersHtml;
    }

    function renderBooks() {
        const booksToRender = activeTagFilter
            ? allBooks.filter(book => book.tags.some(tag => tag.name === activeTagFilter))
            : allBooks;

        if (booksToRender.length === 0) {
            bookShelf.innerHTML = '<p>표시할 책이 없습니다.</p>';
            return;
        }

        bookShelf.innerHTML = booksToRender.map(book => {
            const { name, pinned, tags, activity } = book;
            const isBookmarked = activity?.is_bookmarked || false;

            const tagsHtml = tags.map(tag => `<span class="tag">${tag.name}</span>`).join('');
            const bookmarkHtml = `
                <div class="bookmark-icon" 
                     data-book-name-bookmark="${name}" 
                     title="${isBookmarked ? '책갈피 해제' : '책갈피 설정'}" 
                     style="opacity: ${isBookmarked ? 1 : 0.2}">
                    🔖
                </div>`;
            const lastReadHtml = activity?.last_read_pid
                ? `<p class="last-read-indicator">최근 읽은 위치: ${activity.last_read_pid}</p>`
                : '';

            return `
            <div class="book-card" data-book-name="${encodeURIComponent(name)}">
                ${bookmarkHtml}
                                <div class="card-header">
                                    <span class="pin-btn ${pinned ? 'pinned' : ''}" data-book-name-pin="${name}" title="책 고정/해제">★</span>
                                    <h2>${name}</h2>
                                </div>
                                <div class="card-body">
                                    <div class="tags-container">${tagsHtml}</div>
                                    ${lastReadHtml}
                                </div>
                                <div class="card-actions">
                                    <button class="url-menu-btn" data-book-name-menu="${name}">⋮</button>
                                    <button class="edit-tags-btn btn-secondary" data-book-name-edit="${name}">정보 편집</button>
                                </div>            </div>
            `;
        }).join('');
    }

    // --- API Functions ---
    async function togglePin(folderName) {
        try {
            const response = await fetch('/api/books/pin', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ folderName }),
            });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            await fetchBooks();
        } catch (error) {
            console.error('핀 상태 변경 실패:', error);
            alert(`핀 상태 변경 실패: ${error.message}`);
        }
    }

    async function toggleBookmark(bookName) {
        const book = allBooks.find(b => b.name === bookName);
        const currentStatus = book?.activity?.is_bookmarked || false;

        try {
            const response = await fetch(`/api/books/${encodeURIComponent(bookName)}/activity`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ is_bookmarked: !currentStatus }),
            });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            await fetchBooks();
        } catch (error) {
            console.error('책갈피 변경 실패:', error);
            alert(`책갈피 변경 실패: ${error.message}`);
        }
    }

    // --- Modal Functions ---
    async function openEditModal(bookName) {
        currentEditingBook = allBooks.find(b => b.name === bookName);
        if (!currentEditingBook) return;

        const { name, tags, activity } = currentEditingBook;

        modalBookName.textContent = name;
        const currentSummary = activity?.summary || activity?.notes || '';
        const currentSourceUrl = activity?.summary_source_url || '';
        notesSummaryTextarea.value = currentSummary;
        summarySourceUrlInput.value = currentSourceUrl;
        
        modal.style.display = 'flex';

        try {
            const response = await fetch('/api/tags');
            const allTags = await response.json();
            const bookTagIds = new Set(tags.map(t => t.id));

            tagCheckboxForm.innerHTML = allTags.map(tag => `
                <label>
                    <input type="checkbox" name="tag" value="${tag.id}" ${bookTagIds.has(tag.id) ? 'checked' : ''}>
                    ${tag.name}
                </label>
            `).join('');
            
            initialModalState = {
                tags: new Set([...tagCheckboxForm.querySelectorAll('input:checked')].map(cb => parseInt(cb.value))),
                summary: currentSummary,
                sourceUrl: currentSourceUrl,
            };

        } catch (error) {
            tagCheckboxForm.innerHTML = '<p style="color: red">태그 목록 로딩 실패</p>';
        }
    }

    function closeEditModal() {
        modal.style.display = 'none';
        currentEditingBook = null;
        initialModalState = {};
        tagCheckboxForm.innerHTML = '';
        newTagNameInput.value = '';
        notesSummaryTextarea.value = '';
        summarySourceUrlInput.value = '';
    }

    function requestCloseModal() {
        const currentTags = new Set([...tagCheckboxForm.querySelectorAll('input:checked')].map(cb => parseInt(cb.value)));
        const summaryChanged = initialModalState.summary !== notesSummaryTextarea.value;
        const sourceUrlChanged = initialModalState.sourceUrl !== summarySourceUrlInput.value;
        const tagsChanged = initialModalState.tags.size !== currentTags.size || [...initialModalState.tags].some(id => !currentTags.has(id));

        if (tagsChanged || summaryChanged || sourceUrlChanged) {
            if (confirm("저장하지 않은 변경사항이 있습니다. 정말로 닫으시겠습니까?")) {
                closeEditModal();
            }
        } else {
            closeEditModal();
        }
    }

    async function handleSaveModal() {
        if (!currentEditingBook) return;

        const selectedTagIds = [...tagCheckboxForm.querySelectorAll('input[type="checkbox"]:checked')].map(cb => parseInt(cb.value));
        const summary = notesSummaryTextarea.value;
        const summary_source_url = summarySourceUrlInput.value;

        const tagsUpdatePromise = fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/tags`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tag_ids: selectedTagIds }),
        });

        const activityUpdatePromise = fetch(`/api/books/${encodeURIComponent(currentEditingBook.name)}/activity`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ summary, summary_source_url, notes: summary }),
        });

        try {
            const responses = await Promise.all([tagsUpdatePromise, activityUpdatePromise]);
            for (const response of responses) {
                if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            }
            closeEditModal();
            await fetchBooks();
        } catch (error) {
            console.error('책 정보 저장 실패:', error);
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
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            newTagNameInput.value = '';
            await openEditModal(currentEditingBook.name); // Refresh modal content
        } catch (error) {
            console.error('새 태그 추가 실패:', error);
            alert(`새 태그 추가 실패: ${error.message}`);
        }
    }

    async function handleCrawlSummary() {
        if (!currentEditingBook) return;
        const sourceUrl = summarySourceUrlInput.value.trim();
        if (!sourceUrl) {
            alert("출처 URL을 먼저 입력해주세요.");
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

            alert("줄거리 가져오기를 시작했습니다. 잠시 후, 이 창을 다시 열어 결과를 확인하세요.");

        } catch (error) {
            console.error("Crawl process failed:", error);
            alert(`오류: ${error.message}`);
        }
    }

    async function openUrlListModal(bookName) {
        urlListTitle.textContent = `${bookName} - URL 목록`;
        urlListBody.innerHTML = '<p>로딩 중...</p>';
        urlListModal.style.display = 'flex';

        try {
            const response = await fetch(`/api/books/${encodeURIComponent(bookName)}/urls`);
            if (!response.ok) throw new Error(`Server error`);
            const urls = await response.json();

            urls.sort(naturalSort);

            if (urls.length > 0) {
                urlListBody.innerHTML = `
                    <ul>
                        ${urls.map(urlInfo => `
                            <li>
                                <a href="/viewer?book=${encodeURIComponent(bookName)}&url=${encodeURIComponent(urlInfo.url)}">
                                    ${escapeHtml(urlInfo.title || urlInfo.url)} (${urlInfo.count})
                                </a>
                            </li>
                        `).join('')}
                    </ul>
                `;
            } else {
                urlListBody.innerHTML = '<p>이 책에는 URL이 없습니다.</p>';
            }
        } catch (e) {
            urlListBody.innerHTML = '<p style="color: red;">URL 목록을 불러오는데 실패했습니다.</p>';
        }
    }

    // --- Hover Preview Functions ---
    function showPreview(cardElement) {
        hidePreview();
        const bookName = cardElement.dataset.bookName;
        const book = allBooks.find(b => b.name === decodeURIComponent(bookName));
        const summary = book?.activity?.summary || book?.activity?.notes;

        if (!summary) return;

        activePreview = document.createElement('div');
        activePreview.className = 'book-card-preview';
        activePreview.textContent = summary;
        document.body.appendChild(activePreview);

        const cardRect = cardElement.getBoundingClientRect();
        const previewRect = activePreview.getBoundingClientRect();

        let top = cardRect.top - (previewRect.height - cardRect.height) / 2;
        let left = cardRect.right + 15;

        if (left + previewRect.width > window.innerWidth) {
            left = cardRect.left - previewRect.width - 15;
        }
        if (top < 0) {
            top = 5;
        }
        if (top + previewRect.height > window.innerHeight) {
            top = window.innerHeight - previewRect.height - 5;
        }

        activePreview.style.top = `${top}px`;
        activePreview.style.left = `${left}px`;
        
        setTimeout(() => {
            if (activePreview) {
                activePreview.style.opacity = '1';
                activePreview.style.transform = 'scale(1)';
            }
        }, 10);
    }

    function hidePreview() {
        if (activePreview) {
            activePreview.remove();
            activePreview = null;
        }
    }

    // --- Utility Functions ---
    function escapeHtml(text) {
        if (!text) return '';
        const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return text.replace(/[&<>"'']/g, m => map[m]);
    }

    function naturalSort(a, b) {
        const re = /(\d+)/g;
        const aParts = a.url.split(re);
        const bParts = b.url.split(re);
        for (let i = 0; i < Math.min(aParts.length, bParts.length); i++) {
            const aPart = aParts[i];
            const bPart = bParts[i];
            if (i % 2) { // It's a number
                const aNum = parseInt(aPart, 10);
                const bNum = parseInt(bPart, 10);
                if (aNum !== bNum) return aNum - bNum;
            } else { // It's a string
                if (aPart !== bPart) return aPart.localeCompare(bPart);
            }
        }
        return a.url.length - b.url.length;
    }

    // --- Event Listeners ---
    bookShelf.addEventListener('mouseover', (e) => {
        const card = e.target.closest('.book-card');
        if (card) {
            clearTimeout(hoverTimeout);
            hoverTimeout = setTimeout(() => showPreview(card), 400);
        }
    });

    bookShelf.addEventListener('mouseout', (e) => {
        clearTimeout(hoverTimeout);
        hidePreview();
    });

    document.body.addEventListener('click', (e) => {
        const target = e.target;
        const closest = (selector) => target.closest(selector);

        if (closest('.tag-filter')) {
            const tagName = closest('.tag-filter').dataset.tagName;
            activeTagFilter = tagName === 'null' ? null : tagName;
            displayContent();
        } else if (closest('.bookmark-icon')) {
            e.stopPropagation();
            const bookName = closest('.bookmark-icon').dataset.bookNameBookmark;
            if (bookName) toggleBookmark(bookName);
        } else if (closest('.pin-btn')) {
            e.stopPropagation();
            const bookName = closest('.pin-btn').dataset.bookNamePin;
            if (bookName) togglePin(bookName);
        } else if (closest('.edit-tags-btn')) {
            e.stopPropagation();
            const bookName = closest('.edit-tags-btn').dataset.bookNameEdit;
            if (bookName) openEditModal(bookName);
        } else if (closest('.url-menu-btn')) {
            e.stopPropagation();
            const bookName = closest('.url-menu-btn').dataset.bookNameMenu;
            openUrlListModal(bookName);
        } else if (closest('.book-card')) {
            const bookName = closest('.book-card').dataset.bookName;
            window.location.href = `/viewer?book=${bookName}`;
        } else if (target.id === 'tag-editor-close' || target.id === 'tag-editor-cancel') {
            requestCloseModal();
        } else if (target.id === 'url-list-close') {
            urlListModal.style.display = 'none';
        } else if (target.id === 'tag-editor-save') {
            handleSaveModal();
        }
    });

    newTagForm.addEventListener('submit', handleAddNewTag);
    crawlSummaryBtn.addEventListener('click', handleCrawlSummary);

    // Initial Load
    fetchBooks();
});

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