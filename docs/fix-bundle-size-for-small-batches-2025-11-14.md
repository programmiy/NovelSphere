# [Fix] 번역 묶음 크기 조정 및 중단선 추가

- **파일:** `extension/content.js`
- **날짜:** 2025-11-14

## 문제

번역할 문장 수가 80개 이하일 때, 묶음(chunk) 크기가 과도하게 크게 설정되어 API 서버에서 `503 Service Unavailable` 오류를 반환하는 경우가 있었습니다. 또한, 80개 초과 시에도 묶음 크기가 너무 커서 서버에 부담을 줄 수 있었습니다. 이는 서버가 한 번에 처리할 수 있는 요청의 양을 초과했기 때문입니다.

추가적으로, 번역 중단선에 `<あとがき>`와 같은 특정 키워드가 포함되지 않아 불필요한 번역이 진행되는 문제가 있었습니다.

## 해결

`translateAllPTags` 함수 내에서 번역 묶음 크기 설정 로직과 번역 중단선 로직을 다음과 같이 수정했습니다.

1.  **총 문장 수 80개 이하인 경우:**
    *   `initialChunkSize`를 계산한 후, `Math.min(8, initialChunkSize)`를 추가하여 묶음 크기가 최대 8개를 넘지 않도록 제한했습니다.
2.  **총 문장 수 80개 초과인 경우:**
    *   `initialChunkSize`를 계산한 후, `Math.min(13, initialChunkSize)`를 추가하여 묶음 크기가 최대 13개를 넘지 않도록 제한했습니다.
3.  **번역 중단선 추가:**
    *   `text.includes('＜あとがき＞')` 조건을 추가하여 해당 키워드가 발견되면 번역을 중단하도록 했습니다.

이를 통해 서버에 과도한 부하를 주지 않고 안정적으로 번역을 처리할 수 있게 되었으며, 불필요한 번역을 방지할 수 있게 되었습니다.

### 기존 코드 (80개 이하)

```javascript
            initialChunkSize = Math.ceil(normalSentenceCount / numGroups);
            logToSidebar(`총 문장 수(${totalSentences})가 80개 이하이므로, ${numGroups}개의 그룹으로 나누어(묶음 크기: ${initialChunkSize}) 번역합니다.`);
```

### 변경된 코드 (80개 이하)

```javascript
            initialChunkSize = Math.ceil(normalSentenceCount / numGroups);
            initialChunkSize = Math.min(8, initialChunkSize); // Cap the chunk size at 8
            logToSidebar(`총 문장 수(${totalSentences})가 80개 이하이므로, ${numGroups}개의 그룹으로 나누어(묶음 크기: ${initialChunkSize}) 번역합니다.`);
```

### 기존 코드 (80개 초과)

```javascript
            initialChunkSize = Math.min(20, initialChunkSize);
```

### 변경된 코드 (80개 초과)

```javascript
            initialChunkSize = Math.min(13, initialChunkSize);
```

### 기존 코드 (번역 중단선)

```javascript
        if (/^[\s—]+$/.test(text) || text.includes('----------') || text.includes('◎◎◎')) {
```

### 변경된 코드 (번역 중단선)

```javascript
        if (/^[\s—]+$/.test(text) || text.includes('----------') || text.includes('◎◎◎') || text.includes('＜あとがき＞')) {
```