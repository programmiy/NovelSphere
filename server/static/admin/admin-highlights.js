/**
 * admin-highlights.js
 * 태블릿(갤럭시 탭 S8) 및 모바일에서 독서 중 마킹한 수정 대기 문장 연동 모듈.
 * PC 관리자에서 원클릭 조회, 인라인 즉시 수정 및 본문 단락 점프 지원.
 */

export async function loadTabletHighlightBadge() {
    try {
        const res = await fetch('/api/highlights/counts');
        if (!res.ok) return;
        const data = await res.json();
        const total = data.total || 0;
        const badge = document.getElementById('tabletHighlightBadge');
        const modalBadge = document.getElementById('tabletModalCountBadge');
        if (badge) {
            badge.textContent = total;
            badge.style.display = total > 0 ? 'inline-block' : 'none';
        }
        if (modalBadge) {
            modalBadge.textContent = `${total}건`;
        }
    } catch (e) {
        console.warn('[Highlights] Failed to load highlight counts:', e);
    }
}

export async function openTabletHighlightsModal() {
    const modal = document.getElementById('tabletHighlightsModal');
    if (!modal) return;
    modal.style.display = 'flex';
    await loadTabletHighlightsList();
}

export function closeTabletHighlightsModal() {
    const modal = document.getElementById('tabletHighlightsModal');
    if (modal) modal.style.display = 'none';
}

export async function loadTabletHighlightsList() {
    const listEl = document.getElementById('tabletHighlightsList');
    if (!listEl) return;
    listEl.innerHTML = '<div style="text-align: center; padding: 40px; color: var(--text-muted);">수정 대기 목록을 불러오는 중...</div>';

    try {
        const res = await fetch('/api/highlights?is_resolved=0');
        if (!res.ok) throw new Error('목록을 불러오지 못했습니다.');
        const items = await res.json();

        if (items.length === 0) {
            listEl.innerHTML = `
                <div style="text-align: center; padding: 50px 20px; color: var(--text-muted);">
                    <div style="font-size: 36px; margin-bottom: 12px; opacity: 0.6;">✅</div>
                    <div style="font-size: 15px; font-weight: bold; color: var(--text-color);">수정 대기 중인 마킹이 없습니다.</div>
                    <div style="font-size: 12px; margin-top: 4px;">태블릿에서 독서 중 어색한 문장을 롱프레스하여 마킹하면 여기에 실시간으로 수집됩니다.</div>
                </div>
            `;
            await loadTabletHighlightBadge();
            return;
        }

        listEl.innerHTML = '';
        items.forEach((item) => {
            const card = document.createElement('div');
            card.className = 'cyber-tile';
            card.style.cssText = `
                padding: 14px 16px;
                border-radius: 12px;
                border: 1px solid rgba(245, 158, 11, 0.35);
                background: rgba(245, 158, 11, 0.04);
                display: flex;
                flex-direction: column;
                gap: 8px;
            `;

            card.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; font-weight: bold; border-radius: 6px; padding: 2px 7px; font-size: 11px;">
                            ${escapeHtml(item.book_name)}
                        </span>
                        <span style="font-size: 13px; font-weight: 600; color: var(--text-color);">
                            ${escapeHtml(item.chapter_title)}
                        </span>
                        <span style="font-size: 11px; color: var(--text-muted); font-family: monospace;">
                            (단락: ${escapeHtml(item.pid)})
                        </span>
                    </div>
                    <button type="button" class="btn btn-outline jump-to-row-btn" style="padding: 3px 8px; font-size: 11px;" title="본문 해당 단락으로 순간이동">
                        🔗 본문 행 점프
                    </button>
                </div>
                <!-- 원문 표시 -->
                <div style="background: rgba(0,0,0,0.18); border-left: 3px solid rgba(255,255,255,0.25); padding: 6px 10px; border-radius: 4px; font-size: 12px; color: var(--text-muted);">
                    <span style="color: #38bdf8; font-weight: bold; margin-right: 4px;">[원문]</span> ${escapeHtml(item.original)}
                </div>
                <!-- 번역문 수정 영역 -->
                <div style="display: flex; gap: 8px; align-items: flex-start; margin-top: 4px;">
                    <textarea class="form-textarea highlight-edit-input" style="flex: 1; min-height: 54px; font-size: 13px; padding: 8px 10px; line-height: 1.4; border-radius: 8px; border: 1px solid rgba(245, 158, 11, 0.4);">${escapeHtml(item.translated)}</textarea>
                    <button type="button" class="btn btn-cyber-primary save-highlight-btn" style="height: 54px; padding: 0 16px; background: #f59e0b; border-color: #f59e0b; color: #000; font-weight: bold;" title="번역 수정 저장 및 하이라이트 해결">
                        💾 저장 & 해결
                    </button>
                </div>
            `;

            // 본문 행 점프 버튼 바인딩
            const jumpBtn = card.querySelector('.jump-to-row-btn');
            jumpBtn.addEventListener('click', () => {
                closeTabletHighlightsModal();
                jumpToHighlightTarget(item);
            });

            // 저장 & 해결 버튼 바인딩
            const saveBtn = card.querySelector('.save-highlight-btn');
            const textarea = card.querySelector('.highlight-edit-input');
            saveBtn.addEventListener('click', async () => {
                const newText = textarea.value.trim();
                if (!newText) {
                    alert('번역문을 입력해주세요.');
                    return;
                }
                saveBtn.disabled = true;
                saveBtn.textContent = '저장 중...';

                try {
                    // 1. 번역문 upsert
                    const upRes = await fetch('/translations/upsert', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify([{
                            url: item.url,
                            pid: item.pid,
                            original: item.original,
                            translated: newText,
                            folderName: item.book_name,
                            title: item.chapter_title,
                            timestamp: Math.floor(Date.now() / 1000)
                        }])
                    });
                    if (!upRes.ok) throw new Error('번역문 저장 실패');

                    // 2. 하이라이트 해결 처리
                    await fetch('/api/highlights/resolve', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: item.id })
                    });

                    // 카드 제거 애니메이션
                    card.style.transition = 'all 0.3s ease';
                    card.style.opacity = '0';
                    card.style.transform = 'translateX(20px)';
                    setTimeout(() => {
                        card.remove();
                        loadTabletHighlightBadge();
                    }, 300);

                } catch (err) {
                    alert(`저장 중 오류가 발생했습니다: ${err}`);
                    saveBtn.disabled = false;
                    saveBtn.textContent = '💾 저장 & 해결';
                }
            });

            listEl.appendChild(card);
        });

        await loadTabletHighlightBadge();
    } catch (e) {
        listEl.innerHTML = `<div style="text-align: center; padding: 40px; color: #ef4444;">목록 조회 오류: ${escapeHtml(e.message)}</div>`;
    }
}

/**
 * 해당 소설과 회차 아코디언을 펼치고 해당 단락으로 순간이동
 */
function jumpToHighlightTarget(item) {
    const novelHeaders = document.querySelectorAll('.novel-folder-header');
    let targetNovelHeader = null;
    novelHeaders.forEach(nh => {
        if (nh.textContent.includes(item.book_name)) {
            targetNovelHeader = nh;
        }
    });

    if (targetNovelHeader) {
        const novelBody = targetNovelHeader.nextElementSibling;
        if (novelBody && novelBody.classList.contains('collapsed')) {
            targetNovelHeader.click();
        }
    }

    setTimeout(() => {
        const row = document.getElementById(`tr-${item.pid}`);
        if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.classList.add('lanovel-row-highlight');
            setTimeout(() => row.classList.remove('lanovel-row-highlight'), 3000);
            const input = row.querySelector('.translated-input');
            if (input) {
                input.focus();
                input.select();
            }
        }
    }, 400);
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function initTabletHighlights() {
    const openBtn = document.getElementById('openTabletHighlightsBtn');
    const closeBtn = document.getElementById('closeTabletHighlightsModalBtn');
    const closeBottomBtn = document.getElementById('closeTabletHighlightsModalBottomBtn');
    const refreshBtn = document.getElementById('refreshTabletHighlightsBtn');

    if (openBtn) openBtn.addEventListener('click', openTabletHighlightsModal);
    if (closeBtn) closeBtn.addEventListener('click', closeTabletHighlightsModal);
    if (closeBottomBtn) closeBottomBtn.addEventListener('click', closeTabletHighlightsModal);
    if (refreshBtn) refreshBtn.addEventListener('click', loadTabletHighlightsList);

    // 초기 뱃지 로드
    loadTabletHighlightBadge();
}
