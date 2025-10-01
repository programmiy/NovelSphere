# 수정사항: 통신 오류 재시도 기능 추가 (v1.0)

'A listener indicated an asynchronous response...' 오류는 백그라운드 스크립트와의 통신 채널이 응답을 받기 전에 닫힐 때 발생합니다. 이 문제를 해결하기 위해, 통신 실패 시 자동으로 재시도하는 로직을 추가했습니다.

## 주요 수정사항

- **통신 재시도:** `content.js`에서 `background.js`로 메시지를 보낼 때 오류가 발생하면, 최대 3번까지 자동으로 재전송을 시도합니다.
- **지수 백오프:** 재시도할 때마다 대기 시간을 점진적으로 늘려(예: 1초, 2초, 4초), 일시적인 과부하로 인한 오류를 효과적으로 회피합니다.
- **안정성 강화:** 여러 번의 재시도 후에도 통신이 실패하면, 기존처럼 번역 작업을 더 작은 단위로 나누어 처리하는 로직이 실행됩니다.
- **오류 로깅:** 사이드바 로그에 통신 재시도 시도 및 최종 실패 메시지를 기록하여 디버깅이 용이하도록 개선했습니다.
- **코드 구조:** `translateChunk` 함수 내에 `try-catch` 블록과 `for` 루프를 사용하여 재시도 로직을 명확하고 안정적으로 구현했습니다.

---

## 보존할 세부 문서

이번 수정은 `content.js`의 `translateChunk` 함수에 집중되었습니다. 핵심은 `chrome.runtime.sendMessage` 호출을 재시도 루프로 감싸는 것입니다.

```javascript
async function translateChunk(items, chunkSize) {
    if (isTranslationCancelled) return;

    const MAX_MESSAGE_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_MESSAGE_RETRIES; attempt++) {
        try {
            const response = await chrome.runtime.sendMessage({
                action: 'batchTranslate',
                items: items
            });

            if (chrome.runtime.lastError) {
                throw new Error(chrome.runtime.lastError.message);
            }

            // ... (기존 성공 로직) ...
            return; // 성공 시 루프 종료

        } catch (error) {
            console.warn(`Chunk translation failed (attempt ${attempt + 1}/${MAX_MESSAGE_RETRIES}):`, error.message);
            if (attempt < MAX_MESSAGE_RETRIES - 1) {
                const delay = 1000 * Math.pow(2, attempt); // 지수 백오프
                logToSidebar(`통신 오류. ${delay / 1000}초 후 재시도... (${attempt + 1}/${MAX_MESSAGE_RETRIES})`, 'log-error');
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                // ... (최종 실패 시 기존 handleFailure 호출) ...
                await handleFailure(items, chunkSize);
            }
        }
    }
}
```

이 구조를 통해 `background.js`가 일시적으로 응답할 수 없는 상태일 때 `content.js`가 유연하게 대처할 수 있습니다. `background.js`의 비동기 처리 로직(`addListener`에서 `return true` 사용)은 이미 올바르게 구현되어 있었으므로, 이번 수정은 클라이언트 측의 회복탄력성을 높이는 데 중점을 두었습니다.