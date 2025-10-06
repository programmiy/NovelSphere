document.addEventListener('DOMContentLoaded', async () => {
    const bookTitleElement = document.getElementById('book-title');
    const contentArea = document.getElementById('content-area');

    const urlParams = new URLSearchParams(window.location.search);
    const bookName = urlParams.get('book');
    bookTitleElement.textContent = bookName || '책을 찾을 수 없음';

    const showOriginal = localStorage.getItem('showOriginalText') === 'true';

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
            contentHtml += '<div class="translation-item">';
            if (showOriginal) {
                contentHtml += `<p class="original-text">${item.original}</p>`;
            }
            contentHtml += `<p class="translated-text">${item.translated}</p>`;
            contentHtml += '</div>';
        }
        contentArea.innerHTML = contentHtml;

    } catch (error) {
        console.error('Error loading book:', error);
        contentArea.innerHTML = `<p style="color: red;">콘텐츠를 불러오는 데 실패했습니다: ${error.message}</p>`;
    }
});