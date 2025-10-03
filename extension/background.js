
// =================================================================================
// One-time migration script for quote style
// =================================================================================
async function migrateQuotes() {
    const migrationStatus = await chrome.storage.local.get('quote_migration_v2');
    if (migrationStatus.quote_migration_v2) {
        // Migration has already been performed.
        return;
    }

    const allData = await chrome.storage.local.get(null);
    let updatedCount = 0;
    let urlsUpdated = new Set();

    for (const key in allData) {
        // Skip non-translation data
        if (key.startsWith('status-') || key === 'apiKey' || key === 'error_log' || key === 'excluded_sentences' || key.startsWith('quote_migration_')) {
            continue;
        }

        const translations = allData[key];
        if (Array.isArray(translations)) {
            let wasUpdated = false;
            const updatedTranslations = translations.map(t => {
                if (t.original && t.translated && t.translated.startsWith('"') && t.translated.endsWith('"')) {
                    const innerText = t.translated.substring(1, t.translated.length - 1);
                    if (t.original.includes('「') && t.original.includes('」')) {
                        t.translated = `「${innerText}」`;
                        updatedCount++;
                        wasUpdated = true;
                    } else if (t.original.includes('『') && t.original.includes('』')) {
                        t.translated = `『${innerText}』`;
                        updatedCount++;
                        wasUpdated = true;
                    }
                }
                return t;
            });

            if (wasUpdated) {
                await chrome.storage.local.set({ [key]: updatedTranslations });
                urlsUpdated.add(key);
            }
        }
    }

    if (updatedCount > 0) {
        console.log(`Quote migration v2 complete. Updated ${updatedCount} translations across ${urlsUpdated.size} URLs.`);
    } else {
        console.log("No translations found that required quote migration v2.");
    }

    // Set flag to prevent running the migration again
    await chrome.storage.local.set({ 'quote_migration_v2': true });
}

// Run the migration script when the extension starts
migrateQuotes();
// ==================================================================================
// DEBUG: Check for granted permissions
chrome.permissions.getAll(permissions => {
  console.log("Permissions granted to the extension:", permissions);
});

// 확장 프로그램 설치/업데이트 시 초기 설정
chrome.runtime.onInstalled.addListener((details) => {
    if (chrome.contextMenus) {
        chrome.contextMenus.create({
            id: 'translateJapanese',
            title: '일본어 번역하기',
            contexts: ['selection']
        });
        chrome.contextMenus.create({
            id: 'openTranslationHistory',
            title: '번역 기록 보기',
            contexts: ['page']
        });
    } else {
        console.warn("Context Menus API is not available.");
    }
});

// 컨텍스트 메뉴 클릭 처리
if (chrome.contextMenus) {
    chrome.contextMenus.onClicked.addListener(async (info, tab) => {
        switch (info.menuItemId) {
            case 'translateJapanese':
                break;
            case 'openTranslationHistory':
                chrome.tabs.create({ url: chrome.runtime.getURL('history.html') });
                break;
        }
    });
}

// 메시지 처리 (콘텐츠 스크립트에서 오는 요청들)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    const channelClosedMessage = "The message channel closed before a response was received.";

    if (request.action === 'batchTranslate') {
        (async () => {
            try {
                const translations = await handleBatchTranslate(request.items, sender.tab?.url);
                try {
                    sendResponse({ translations });
                } catch (e) {
                    if (e.message.includes(channelClosedMessage)) {
                        console.log("Failed to send translation success response: Channel was closed by the client.");
                    } else {
                        console.error("Error sending translation success response:", e);
                    }
                }
            } catch (error) {
                // 모든 종류의 오류를 로그에 기록
                saveErrorLog(request.items, error, sender.tab?.url);

                const errorResponse = request.items.map(item => ({
                    id: item.id,
                    original: item.text,
                    translated: `번역 실패: ${error.message}`
                }));
                try {
                    sendResponse({ translations: errorResponse });
                } catch (e) {
                    if (e.message.includes(channelClosedMessage)) {
                        console.log("Failed to send translation error response: Channel was closed by the client.");
                    } else {
                        console.error("Error sending translation error response:", e);
                    }
                }
            }
        })();
        return true; // 비동기 응답을 위해 true 반환
    } else if (request.action === 'fetchTitle') {
        (async () => {
            try {
                const title = await fetchPageTitle(request.url);
                try {
                    sendResponse({ title });
                } catch (e) {
                    if (e.message.includes(channelClosedMessage)) {
                        console.log("Failed to send title success response: Channel was closed by the client.");
                    } else {
                        console.error("Error sending title success response:", e);
                    }
                }
            } catch (error) {
                // 제목 가져오기 실패 시 오류 로그 저장
                saveErrorLog([], error, request.url);
                try {
                    sendResponse({ title: request.url, error: error.message });
                } catch (e) {
                    if (e.message.includes(channelClosedMessage)) {
                        console.log("Failed to send title error response: Channel was closed by the client.");
                    } else {
                        console.error("Error sending title error response:", e);
                    }
                }
            }
        })();
        return true; // 비동기 응답을 위해 true 반환
    }
    return false;
});

async function fetchPageTitle(url) {
    try {
        const response = await fetch(url, { credentials: 'include' }); // 인증 쿠키 포함
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status} for URL: ${url}`);
        }
        const text = await response.text();
        const titleMatch = text.match(/<title>(.*?)<\/title>/i);
        return titleMatch ? titleMatch[1].trim() : url;
    } catch (e) {
        console.error(`Failed to fetch title for ${url}:`, e);
        // 오류를 다시 던져서 onMessage 리스너에서 잡을 수 있도록 함
        throw new Error(`제목 가져오기 실패: ${e.message}`);
    }
}

async function handleBatchTranslate(items, sourceUrl) {
    const texts = items.map(item => item.text);

    try {
        const response = await fetch('http://127.0.0.1:8001/translate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: texts })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || `Server error: ${response.status}`);
        }

        const data = await response.json();
        
        if (!data.translations || data.translations.length !== items.length) {
            throw new Error('Received invalid translation data from server.');
        }

        // Map results and apply quote correction
        return items.map((item, index) => {
            let translatedText = data.translations[index];

            // Post-processing to enforce quote style (belt-and-suspenders for the prompt)
            if (translatedText && translatedText.startsWith('"') && translatedText.endsWith('"')) {
                const innerText = translatedText.substring(1, translatedText.length - 1);
                if (item.text.includes('「') && item.text.includes('」')) {
                    translatedText = `「${innerText}」`;
                } else if (item.text.includes('『') && item.text.includes('』')) {
                    translatedText = `『${innerText}』`;
                }
            }

            return {
                id: item.id,
                original: item.text,
                translated: translatedText
            };
        });

    } catch (error) {
        console.error('Translation request to local server failed:', error);
        // 오류를 다시 던져서 상위 호출자(onMessage)가 처리하도록 함
        throw error;
    }
}

async function saveErrorLog(items, error, url) {
    const logEntry = {
        timestamp: Date.now(),
        reason: error.message || '알 수 없는 오류',
        url: url || "알 수 없는 URL",
        texts: items.map(item => item.text),
        stack: error.stack || null
    };

    try {
        const result = await chrome.storage.local.get('error_log');
        const existingLogs = result.error_log || [];
        existingLogs.unshift(logEntry); // 최신 로그를 맨 위에 추가
        // 로그는 최대 20개까지만 저장
        if (existingLogs.length > 20) {
            existingLogs.length = 20;
        }
        await chrome.storage.local.set({ 'error_log': existingLogs });
        console.log("오류 로그를 저장했습니다.");
    } catch (e) {
        console.error("오류 로그 저장 실패:", e);
    }
}