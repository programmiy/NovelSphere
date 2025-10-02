// '번역 기록 보기' 버튼 클릭 시 기록 페이지 열기
document.getElementById('openHistory').addEventListener('click', () => {
    chrome.tabs.create({ url: 'history.html' });
});
