
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
    if (request.action === 'batchTranslate') {
        handleBatchTranslate(request.items)
            .then(translations => sendResponse({ translations }))
            .catch(error => {
                // Log to history if it's a content block error
                if (error.message && error.message.includes('PROHIBITED_CONTENT')) {
                    saveErrorLog(request.items, error.message, sender.tab?.url);
                }
                const errorResponse = request.items.map(item => ({
                    id: item.id,
                    original: item.text,
                    translated: `번역 실패: ${error.message}`
                }));
                sendResponse({ translations: errorResponse });
            });
        return true; // 비동기 응답을 위해 true 반환
    } else if (request.action === 'fetchTitle') {
        fetchPageTitle(request.url)
            .then(title => sendResponse({ title }))
            .catch(error => sendResponse({ title: request.url, error: error.message }));
        return true; // 비동기 응답을 위해 true 반환
    }
});

async function fetchPageTitle(url) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return url; // Return URL on HTTP error
        }
        const text = await response.text();
        const titleMatch = text.match(/<title>(.*?)<\/title>/i);
        return titleMatch ? titleMatch[1].trim() : url;
    } catch (e) {
        console.error(`Failed to fetch title for ${url}:`, e);
        return url; // Return URL on network error
    }
}

async function handleBatchTranslate(items) {
    const { apiKey: GEMINI_API_KEY } = await chrome.storage.local.get('apiKey');
    if (!GEMINI_API_KEY) {
        throw new Error("API key is not set. Please set it in the extension popup.");
    }
    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    
    const texts = items.map(item => item.text);
    const prompt = `You are a translation API. Translate the following Japanese texts into Korean. Return a single valid JSON array of strings. The output array must contain the translation for each input text in the same order. Do not include any other text or explanations. Preserve the original quotation marks (「」 and 『』) in the translation. For example, 「おはよう」 should be translated as 「안녕」, and 『何をですか？』 should be translated as 『무엇을요?』.`;
    const textsToTranslate = items.map(item => item.text);

    const MAX_RETRIES = 3;
    let lastError = null;

    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }, { text: JSON.stringify(textsToTranslate) }] }],
                    generationConfig: {
                        temperature: 0.2,
                        maxOutputTokens: 65535
                    }
                })
            });

            if (!response.ok) {
                // Only retry on server errors (5xx) or rate limiting (429)
                if (response.status === 429 || response.status >= 500) {
                    throw new Error(`HTTP error! status: ${response.status} ${response.statusText}`);
                } else {
                    // For other errors (e.g., 400 Bad Request), fail immediately
                    const errorBody = await response.text();
                    throw new Error(`HTTP error! status: ${response.status} ${response.statusText}. Body: ${errorBody}`);
                }
            }

            const data = await response.json();
            console.log(`Full API Response (Attempt ${i + 1}):`, JSON.stringify(data, null, 2));

            if (data.promptFeedback?.blockReason) {
                throw new Error(`Translation blocked by API. Reason: ${data.promptFeedback.blockReason}`);
            }

            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!rawText) {
                const finishReason = data.candidates?.[0]?.finishReason;
                if (finishReason && finishReason !== 'STOP') {
                    throw new Error(`Translation failed. Finish reason: ${finishReason}.`);
                }
                throw new Error("No text found in API response.");
            }

            let jsonString = rawText.trim();
            if (jsonString.startsWith("```json")) {
                jsonString = jsonString.substring(7).trim();
            }
            if (jsonString.endsWith("```")) {
                jsonString = jsonString.slice(0, -3).trim();
            }

            let translatedParts;
            try {
                translatedParts = JSON.parse(jsonString);
            } catch (e) {
                console.error("Failed to parse JSON response from API:", e);
                console.error("Cleaned string for parsing was:", jsonString);
                throw new Error("API returned a response that was not valid JSON.");
            }

            if (!Array.isArray(translatedParts)) {
                throw new Error("API response was valid JSON, but not an array.");
            }

            if (translatedParts.length !== texts.length) {
                console.warn('Mismatch between original and translated text count.', { numOriginals: texts.length, numTranslated: translatedParts.length });
                throw new Error('Translated parts count does not match original texts count.');
            }

            // Success
            return items.map((item, index) => ({
                id: item.id,
                original: item.text,
                translated: translatedParts[index]
            }));

        } catch (error) {
            lastError = error;
            if (i < MAX_RETRIES - 1) {
                const delay = 1000 * Math.pow(2, i); // Exponential backoff
                console.warn(`Translation API call failed. Attempt ${i + 1} of ${MAX_RETRIES}. Retrying in ${delay}ms...`, error.message);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    // If all retries failed
    console.error('Translation API call failed after all retries:', lastError);
    throw lastError;
}

async function saveErrorLog(items, reason, url) {
    const logEntry = {
        timestamp: Date.now(),
        reason: reason,
        url: url || "Unknown URL",
        texts: items.map(item => item.text)
    };

    try {
        const result = await chrome.storage.local.get('error_log');
        const existingLogs = result.error_log || [];
        existingLogs.push(logEntry);
        await chrome.storage.local.set({ 'error_log': existingLogs });
        console.log("Saved prohibited content error to history log.");
    } catch (e) {
        console.error("Failed to save error log:", e);
    }
}