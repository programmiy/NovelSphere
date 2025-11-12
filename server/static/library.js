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
    const importTocBtn = document.getElementById('import-toc-btn');
    const fetchMissingTitlesBtn = document.getElementById('fetch-missing-titles-btn');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    let taskPollInterval = null;

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

    async function handleDownloadOffline(bookName, buttonElement) {
        const statusSpan = document.getElementById(`download-status-${encodeURIComponent(bookName)}`);
        buttonElement.disabled = true;
        statusSpan.textContent = '다운로드 중...';
        statusSpan.style.color = 'orange';

        try {
            // 1. Fetch all URLs for the book
            const urlsResponse = await fetch(`/api/books/${encodeURIComponent(bookName)}/urls`);
            if (!urlsResponse.ok) throw new Error(`URL 목록 가져오기 실패: ${urlsResponse.statusText}`);
            const urls = await urlsResponse.json();

            if (urls.length === 0) {
                statusSpan.textContent = '다운로드할 콘텐츠 없음';
                statusSpan.style.color = 'gray';
                buttonElement.disabled = false;
                return;
            }

            let downloadedCount = 0;
            const totalUrls = urls.length;

            // 2. For each URL, fetch its chapter content to trigger service worker caching
            for (const urlInfo of urls) {
                const chapterResponse = await fetch(`/api/books/${encodeURIComponent(bookName)}/chapter?title=${encodeURIComponent(urlInfo.title || urlInfo.url)}`);
                if (!chapterResponse.ok) {
                    console.warn(`챕터 다운로드 실패: ${urlInfo.title || urlInfo.url} - ${chapterResponse.statusText}`);
                    // Continue to next, but don't increment downloadedCount for failed ones
                } else {
                    downloadedCount++;
                }
                statusSpan.textContent = `다운로드 중... (${downloadedCount}/${totalUrls})`;
            }

            statusSpan.textContent = `다운로드 완료 (${downloadedCount}/${totalUrls})`;
            statusSpan.style.color = 'green';
        } catch (error) {
            console.error('오프라인 다운로드 실패:', error);
            statusSpan.textContent = `다운로드 실패: ${error.message}`;
            statusSpan.style.color = 'red';
        } finally {
            buttonElement.disabled = false;
        }
    }

    async function handleDownloadAllOffline() {
        const globalStatusSpan = document.getElementById('global-download-status');
        const downloadAllBtn = document.getElementById('download-all-offline-btn');

        downloadAllBtn.disabled = true;
        globalStatusSpan.textContent = '모든 책 다운로드 중...';
        globalStatusSpan.style.color = 'orange';

        try {
            const response = await fetch('/api/books');
            if (!response.ok) throw new Error(`책 목록 가져오기 실패: ${response.statusText}`);
            const books = await response.json();

            let overallDownloadedCount = 0;
            let overallTotalCount = 0;

            for (const book of books) {
                const bookName = book.name;
                const bookStatusSpan = document.getElementById(`download-status-${encodeURIComponent(bookName)}`);
                const bookDownloadBtn = document.querySelector(`[data-book-name-download="${bookName}"]`);

                if (bookStatusSpan) {
                    bookStatusSpan.textContent = '다운로드 중...';
                    bookStatusSpan.style.color = 'orange';
                }
                if (bookDownloadBtn) {
                    bookDownloadBtn.disabled = true;
                }

                try {
                    const urlsResponse = await fetch(`/api/books/${encodeURIComponent(bookName)}/urls`);
                    if (!urlsResponse.ok) throw new Error(`URL 목록 가져오기 실패: ${urlsResponse.statusText}`);
                    const urls = await urlsResponse.json();

                    overallTotalCount += urls.length;

                    for (const urlInfo of urls) {
                        const chapterResponse = await fetch(`/api/books/${encodeURIComponent(bookName)}/chapter?title=${encodeURIComponent(urlInfo.title || urlInfo.url)}`);
                        if (!chapterResponse.ok) {
                            console.warn(`챕터 다운로드 실패: ${urlInfo.title || urlInfo.url} - ${chapterResponse.statusText}`);
                        } else {
                            overallDownloadedCount++;
                        }
                        globalStatusSpan.textContent = `모든 책 다운로드 중... (${overallDownloadedCount}/${overallTotalCount})`;
                    }
                    if (bookStatusSpan) {
                        bookStatusSpan.textContent = '다운로드 완료';
                        bookStatusSpan.style.color = 'green';
                    }
                } catch (bookError) {
                    console.error(`책 '${bookName}' 다운로드 실패:`, bookError);
                    if (bookStatusSpan) {
                        bookStatusSpan.textContent = `다운로드 실패: ${bookError.message}`;
                        bookStatusSpan.style.color = 'red';
                    }
                } finally {
                    if (bookDownloadBtn) {
                        bookDownloadBtn.disabled = false;
                    }
                }
            }

            globalStatusSpan.textContent = `모든 책 다운로드 완료 (${overallDownloadedCount}/${overallTotalCount})`;
            globalStatusSpan.style.color = 'green';

        } catch (error) {
            console.error('모든 책 오프라인 다운로드 실패:', error);
            globalStatusSpan.textContent = `다운로드 실패: ${error.message}`;
            globalStatusSpan.style.color = 'red';
        } finally {
            downloadAllBtn.disabled = false;
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
        return text.replace(/[&<>\"\']/g, m => map[m]);
    }

    // --- Task Progress Functions ---
    function pollTaskStatus(taskId) {
        if (taskPollInterval) {
            clearInterval(taskPollInterval);
        }

        taskPollInterval = setInterval(async () => {
            try {
                const response = await fetch(`/task_status/${taskId}`);
                if (!response.ok) {
                    throw new Error(`Server error: ${response.statusText}`);
                }
                const data = await response.json();

                progressContainer.style.display = 'flex';

                if (data.state === 'PROGRESS') {
                    const percentage = data.meta.percentage || 0;
                    progressBar.style.width = `${percentage}%`;
                    progressBar.textContent = `${percentage}%`;
                    progressText.textContent = `Processing: ${data.meta.current} / ${data.meta.total}`;
                } else if (data.state === 'SUCCESS' || data.state === 'Completed') {
                    clearInterval(taskPollInterval);
                    taskPollInterval = null;
                    progressBar.style.width = '100%';
                    progressBar.textContent = '100%';
                    progressText.textContent = 'Task completed successfully!';
                    setTimeout(() => {
                        progressContainer.style.display = 'none';
                        fetchBooks(); // Refresh book list
                    }, 3000);
                } else if (data.state === 'FAILURE') {
                    clearInterval(taskPollInterval);
                    taskPollInterval = null;
                    progressText.textContent = `Error: ${data.status}`;
                    progressBar.style.backgroundColor = 'red';
                } else if (data.state === 'PENDING') {
                    progressText.textContent = 'Task is pending...';
                }

            } catch (error) {
                console.error('Failed to get task status:', error);
                progressText.textContent = 'Error fetching status.';
                clearInterval(taskPollInterval);
                taskPollInterval = null;
            }
        }, 2000);
    }

    async function handleFetchMissingTitles() {
        fetchMissingTitlesBtn.disabled = true;
        progressText.textContent = 'Starting task...';
        progressContainer.style.display = 'flex';
        progressBar.style.width = '0%';
        progressBar.textContent = '';
        progressBar.style.backgroundColor = '#007bff';


        try {
            const response = await fetch('/fetch_missing_titles', { method: 'POST' });
            if (!response.ok) {
                throw new Error(`Server error: ${response.statusText}`);
            }
            const data = await response.json();

            if (data.task_id) {
                pollTaskStatus(data.task_id);
            } else {
                progressText.textContent = data.message || 'No task started.';
                 setTimeout(() => {
                        progressContainer.style.display = 'none';
                    }, 3000);
            }

        } catch (error) {
            console.error('Failed to start fetch titles task:', error);
            progressText.textContent = `Error: ${error.message}`;
        } finally {
            fetchMissingTitlesBtn.disabled = false;
        }
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
    importTocBtn.addEventListener('click', handleImportToc);
    fetchMissingTitlesBtn.addEventListener('click', handleFetchMissingTitles);

    const downloadAllBtn = document.getElementById('download-all-offline-btn');
    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', handleDownloadAllOffline);
    }

    // Initial Load
    fetchBooks();

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

    async function handleImportToc() {
        const bookName = urlListTitle.textContent.split(' - ')[0];
        if (!bookName) {
            alert('책 이름을 확인할 수 없습니다.');
            return;
        }

        const tocUrl = prompt('목차(TOC) URL을 입력하세요:');
        if (!tocUrl) return;

        urlListBody.innerHTML = '<p>목차를 가져와 순서를 적용하는 중...</p>';

        try {
            // 1. Fetch the sorted list of chapters from the TOC URL
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

            // 2. Send this list to the backend to update the sort order in the database
            const updateResponse = await fetch(`/api/books/${encodeURIComponent(bookName)}/urls`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ urls: tocUrls }),
            });

            if (!updateResponse.ok) {
                const errorData = await updateResponse.json();
                throw new Error(errorData.detail || '순서 업데이트에 실패했습니다.');
            }

            // 3. Refresh the modal to show the newly sorted list
            await openUrlListModal(bookName);

        } catch (error) {
            urlListBody.innerHTML = `<p style="color: red;">오류가 발생했습니다: ${error.message}</p>`;
        }
    }
});