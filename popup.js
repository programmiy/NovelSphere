// '번역 기록 보기' 버튼 클릭 시 기록 페이지 열기
document.getElementById('openHistory').addEventListener('click', () => {
    chrome.tabs.create({ url: 'history.html' });
});

// API Key 관련 로직
document.addEventListener('DOMContentLoaded', async () => {
    const apiKeyInput = document.getElementById('apiKeyInput');
    const saveApiKeyButton = document.getElementById('saveApiKey');

    // 저장된 API 키 불러오기
    const result = await chrome.storage.local.get('apiKey');
    if (result.apiKey) {
        apiKeyInput.value = result.apiKey;
    }

    // API 키 저장 버튼 클릭 이벤트
    saveApiKeyButton.addEventListener('click', async () => {
        const apiKey = apiKeyInput.value.trim();
        if (apiKey) {
            await chrome.storage.local.set({ apiKey: apiKey });
            alert('API 키가 저장되었습니다!');
        } else {
            alert('API 키를 입력해주세요.');
        }
    });
});