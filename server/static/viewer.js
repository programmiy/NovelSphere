document.addEventListener('DOMContentLoaded', async () => {
    const bookTitleElement = document.getElementById('book-title');
    const contentArea = document.getElementById('content-area');
    const focusModeBtn = document.getElementById('focus-mode-btn');
    const viewOriginalBtn = document.getElementById('view-original-btn');
    const viewerContainer = document.querySelector('.viewer-container');

    const urlParams = new URLSearchParams(window.location.search);
    const bookName = urlParams.get('book');
    bookTitleElement.textContent = bookName || '책을 찾을 수 없음';

    let showOriginal = localStorage.getItem('showOriginalText') === 'true';

    // Update button state on load
    if (showOriginal) {
        viewOriginalBtn.classList.add('active');
    }

    // Event Listeners
    focusModeBtn.addEventListener('click', () => {
        viewerContainer.classList.toggle('focus-mode');
        if (viewerContainer.classList.contains('focus-mode')) {
            focusModeBtn.textContent = '집중 모드 종료';
        } else {
            focusModeBtn.textContent = '집중 모드';
        }
    });

    viewOriginalBtn.addEventListener('click', () => {
        showOriginal = !showOriginal;
        localStorage.setItem('showOriginalText', showOriginal);
        window.location.reload();
    });

    contentArea.addEventListener('mouseup', (e) => {
        const selection = window.getSelection();
        if (!selection.isCollapsed) {
            const selectedText = selection.toString().trim();
            if (selectedText) {
                const target = selection.anchorNode.parentElement;
                const translationItem = target.closest('.translation-item');
                if (translationItem) {
                    enableEditing(translationItem);
                }
            }
        }
    });

    function enableEditing(translationItem) {
        // Disable editing on other items
        document.querySelectorAll('.editing').forEach(item => {
            if (item !== translationItem) {
                disableEditing(item);
            }
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
        if (saveBtn) {
            saveBtn.remove();
        }
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

            if (!response.ok) {
                throw new Error('Failed to save changes.');
            }

            // Visually indicate success and disable editing
            disableEditing(translationItem);
            translatedTextElement.style.transition = 'background-color 0.5s';
            translatedTextElement.style.backgroundColor = '#e6ffed';
            setTimeout(() => {
                translatedTextElement.style.backgroundColor = '';
            }, 1500);

        } catch (error) {
            console.error('Error saving changes:', error);
            alert('저장에 실패했습니다.');
        }
    }


    try {
        const response = await fetch(`/stream?book=${encodeURIComponent(bookName)}`);
        if (!response.ok) throw new Error(`Server error: ${response.status}`);
        
        const sseText = await response.text();
        const translationItems = sseText.split('\n\n')
            .filter(line => line.startsWith('data:'))
            .map(line => JSON.parse(line.substring(5)));

        if (translationItems.length === 0) {
            contentArea.innerHTML = '<p>표시할 내용이 없습니다.</p>';
            return;
        }

        const bookTitleFromData = translationItems[0]?.title || bookName;
        bookTitleElement.textContent = bookTitleFromData;

        let contentHtml = '';
        for (const item of translationItems) {
            contentHtml += `<div class="translation-item" 
                                 data-id="${item.id}" 
                                 data-url="${item.url}" 
                                 data-pid="${item.pid}" 
                                 data-original="${escapeHtml(item.original)}">
            `;
            if (showOriginal) {
                contentHtml += `<p class="original-text">${escapeHtml(item.original)}</p>`;
            }
            contentHtml += `<p class="translated-text">${escapeHtml(item.translated)}</p>`;
            contentHtml += '</div>';
        }
        contentArea.innerHTML = contentHtml;

        // Add escapeHtml function
        function escapeHtml(text) {
            if (text === null || text === undefined) return '';
            return text.toString().replace(/[&<>"'/]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;','/':'&#x2F;'})[s]);
        }

    } catch (error) {
        console.error('Error loading book:', error);
        contentArea.innerHTML = `<p style="color: red;">콘텐츠를 불러오는 데 실패했습니다: ${error.message}</p>`;
    }
});