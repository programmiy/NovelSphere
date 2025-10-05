document.addEventListener('DOMContentLoaded', () => {
    const contentArea = document.getElementById('content-area');
    const bookTitle = document.getElementById('book-title');
    const metadataToggle = document.getElementById('toggle-metadata');
    const focusModeBtn = document.getElementById('focus-mode-btn');

    const urlParams = new URLSearchParams(window.location.search);
    const bookName = urlParams.get('book');

    // --- State ---
    let lastKnownPid = null;
    let updateTimeout = null;
    let observer = null;

    if (bookName) {
        const decodedBookName = decodeURIComponent(bookName);
        bookTitle.textContent = decodedBookName;
        document.title = decodedBookName;
    } else {
        bookTitle.textContent = '책이 선택되지 않았습니다.';
        return;
    }

    contentArea.innerHTML = '';

    // --- Feature Logic ---
    function setMetadataVisibility(visible) {
        document.body.classList.toggle('show-metadata', visible);
        metadataToggle.checked = visible;
        try { localStorage.setItem('showMetadata', visible); } catch (e) { console.warn('localStorage is not available.', e); }
    }

    function toggleFocusMode(force) {
        const isFocus = typeof force === 'boolean' ? force : !document.body.classList.contains('focus-mode-active');
        document.body.classList.toggle('focus-mode-active', isFocus);
    }

    function scheduleActivityUpdate(pid, timestamp) {
        if (pid === lastKnownPid) return;
        lastKnownPid = pid;
        clearTimeout(updateTimeout);
        updateTimeout = setTimeout(() => {
            console.log(`Updating last read position: ${pid}`);
            fetch(`/api/books/${bookName}/activity`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ last_read_pid: pid, last_read_timestamp: timestamp }),
            }).catch(error => console.error('Failed to update activity:', error));
        }, 3000);
    }

    function handleIntersection(entries) {
        const visibleEntries = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visibleEntries.length > 0) {
            const topElement = visibleEntries[0].target;
            const pid = topElement.dataset.pid;
            const timestamp = parseInt(topElement.dataset.timestamp, 10);
            if (pid && timestamp) {
                scheduleActivityUpdate(pid, timestamp);
            }
        }
    }

    // --- Event Listeners ---
    metadataToggle.addEventListener('change', () => setMetadataVisibility(metadataToggle.checked));
    focusModeBtn.addEventListener('click', () => toggleFocusMode());
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.body.classList.contains('focus-mode-active')) {
            toggleFocusMode(false);
        }
    });

    // --- Initial Setup ---
    try {
        const savedMetadataPref = localStorage.getItem('showMetadata') === 'true';
        setMetadataVisibility(savedMetadataPref);
    } catch (e) { console.warn('localStorage is not available.', e); }

    observer = new IntersectionObserver(handleIntersection, { root: null, rootMargin: '0px', threshold: 0.1 });

    // --- SSE Streaming ---
    const streamUrl = `/stream?book=${bookName}`;
    const eventSource = new EventSource(streamUrl);

    eventSource.onmessage = function(event) {
        const translation = JSON.parse(event.data);
        const item = document.createElement('div');
        item.className = 'translation-item';
        item.dataset.pid = translation.pid;
        item.dataset.timestamp = translation.timestamp;
        
        const metadata = document.createElement('div');
        metadata.className = 'metadata-info';
        metadata.innerHTML = `<strong>URL:</strong> ${translation.url}<br><strong>PID:</strong> ${translation.pid}`;
        item.appendChild(metadata);

        const originalText = document.createElement('p');
        originalText.className = 'original-text';
        originalText.textContent = translation.original;
        
        const translatedText = document.createElement('p');
        translatedText.className = 'translated-text';
        translatedText.textContent = translation.translated;
        
        item.appendChild(originalText);
        item.appendChild(translatedText);
        
        contentArea.appendChild(item);
        observer.observe(item);
    };

    eventSource.onerror = function(err) {
        console.error("EventSource failed:", err);
        contentArea.innerHTML += '<p style="color: red;">스트리밍 연결에 오류가 발생했습니다. 서버를 확인해주세요.</p>';
        eventSource.close();
    };

    console.log(`Connecting to stream: '${streamUrl}'`);
});
