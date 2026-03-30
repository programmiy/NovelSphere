document.addEventListener('DOMContentLoaded', () => {
    const translationList = document.getElementById('translation-list');
    const paginationUl = document.getElementById('pagination');
    const perPage = 20; // Or any other number you prefer

    async function fetchData(page = 1) {
        try {
            const response = await fetch(`/paged_translations?page=${page}&per_page=${perPage}`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            renderTranslations(data.translations);
            renderPagination(data.total_count, page, perPage);
        } catch (error) {
            translationList.innerHTML = `<p style="text-align: center; color: red;">데이터를 불러오는 데 실패했습니다: ${error.message}</p>`;
        }
    }

    function renderTranslations(translations) {
        if (!translations || translations.length === 0) {
            translationList.innerHTML = '<p style="text-align: center;">번역 기록이 없습니다.</p>';
            return;
        }

        translationList.innerHTML = translations.map(t => `
            <div class="translation-item">
                <p class="original-text">${escapeHtml(t.original)}</p>
                <p class="translated-text">${escapeHtml(t.translated)}</p>
            </div>
        `).join('');
    }

    function renderPagination(totalCount, currentPage, perPage) {
        paginationUl.innerHTML = '';
        const totalPages = Math.ceil(totalCount / perPage);
        if (totalPages <= 1) return;

        // Previous button
        const prevLi = document.createElement('li');
        if (currentPage === 1) {
            prevLi.classList.add('disabled');
            prevLi.innerHTML = `<span>&laquo;</span>`;
        } else {
            prevLi.innerHTML = `<a href="#" data-page="${currentPage - 1}">&laquo;</a>`;
        }
        paginationUl.appendChild(prevLi);

        // Page numbers
        // Simple pagination logic: show first, last, current, and pages around current
        const pagesToShow = new Set([1, totalPages, currentPage, currentPage - 1, currentPage + 1]);
        let lastPage = 0;

        for (let i = 1; i <= totalPages; i++) {
            if (pagesToShow.has(i)) {
                if (lastPage > 0 && i - lastPage > 1) {
                     const li = document.createElement('li');
                     li.classList.add('disabled');
                     li.innerHTML = `<span>...</span>`;
                     paginationUl.appendChild(li);
                }
                const li = document.createElement('li');
                if (i === currentPage) {
                    li.classList.add('active');
                    li.innerHTML = `<span>${i}</span>`;
                } else {
                    li.innerHTML = `<a href="#" data-page="${i}">${i}</a>`;
                }
                paginationUl.appendChild(li);
                lastPage = i;
            }
        }

        // Next button
        const nextLi = document.createElement('li');
        if (currentPage === totalPages) {
            nextLi.classList.add('disabled');
            nextLi.innerHTML = `<span>&raquo;</span>`;
        } else {
            nextLi.innerHTML = `<a href="#" data-page="${currentPage + 1}">&raquo;</a>`;
        }
        paginationUl.appendChild(nextLi);
    }

    paginationUl.addEventListener('click', (e) => {
        e.preventDefault();
        if (e.target.tagName === 'A' && e.target.dataset.page) {
            const page = parseInt(e.target.dataset.page, 10);
            fetchData(page);
        }
    });

    function escapeHtml(text) {
        if (text === null || typeof text === 'undefined') return '';
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Initial fetch
    fetchData(1);
});
