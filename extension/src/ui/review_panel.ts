import { serverFetch } from '../core/api_client';
// review_panel.ts: 알림 센터 연계 재번역 검수 패널 및 본문/사이드바 하이라이트 모듈
import { state } from '../core/state';
import { escapeHtml, logToSidebar, showSidebar } from './sidebar';

/**
 * 특정 PID로 본문과 사이드바를 동시에 스크롤하고 펄스 하이라이트를 부여합니다.
 */
export function focusAndScrollToPid(pid: string): void {
  if (!pid) return;
  const targetP = document.getElementById(pid);
  if (targetP) {
    targetP.scrollIntoView({ behavior: 'smooth', block: 'center' });
    targetP.classList.remove('lanovel-highlight-pulse');
    void targetP.offsetWidth;
    targetP.classList.add('lanovel-highlight-pulse');
    setTimeout(() => {
      targetP.classList.remove('lanovel-highlight-pulse');
    }, 1800);
  }

  const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${pid}"]`);
  if (row) {
    showSidebar();
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('lanovel-row-highlight');
    void row.offsetWidth;
    row.classList.add('lanovel-row-highlight');
    setTimeout(() => {
      row.classList.remove('lanovel-row-highlight');
    }, 1800);
  }
}

/**
 * 본문 DOM에서 검수 대상 문단에 강조 표시(.review-target-dom)를 적용합니다.
 */
export function highlightReviewTargetDOMs(): void {
  if (!state.reviewTargetPids || state.reviewTargetPids.size === 0) return;
  state.reviewTargetPids.forEach((pid) => {
    const p = document.getElementById(pid);
    if (p) {
      p.classList.add('review-target-dom');
      p.title = '⚡ [알림 센터] 재번역 검수 대상 문장입니다. 클릭 시 사이드바에서 확인합니다.';
    }
  });
}

/**
 * 이미 렌더링된 사이드바 테이블 행 중 검수 대상 PID에 행 강조(.review-target-row) 및 배지(.review-badge)를 부여합니다.
 */
export function updateSidebarReviewTargetHighlights(): void {
  if (!state.reviewTargetPids || state.reviewTargetPids.size === 0) return;
  state.reviewTargetPids.forEach((pid) => {
    const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${pid}"]`);
    if (row) {
      row.classList.add('review-target-row');
      const oriCell = row.querySelector('.original-text');
      if (oriCell && !oriCell.querySelector('.review-badge')) {
        const badge = document.createElement('span');
        badge.className = 'review-badge';
        badge.textContent = '⚡재검수';
        oriCell.prepend(badge);
      }
    }
  });
}

/**
 * 검수 패널 내 특정 PID 카드의 번역문 표시(#review-tra-${pid})를 실시간 갱신합니다.
 */
export function updateReviewCardTranslation(pid: string, text: string, isWaiting = false): void {
  const reviewTraEl = document.getElementById(`review-tra-${pid}`);
  if (!reviewTraEl) return;
  reviewTraEl.textContent = text;
  if (isWaiting) {
    reviewTraEl.classList.add('waiting');
  } else {
    reviewTraEl.classList.remove('waiting');
  }
}

/**
 * 사이드바 상단 검수 전용 패널(#review-target-panel)을 렌더링합니다.
 */
export function renderReviewTargetPanel(): void {
  const panel = document.getElementById('review-target-panel');
  if (!panel) return;

  if (
    !state.reviewTargetsData ||
    !state.reviewTargetsData.targets ||
    state.reviewTargetsData.targets.length === 0
  ) {
    panel.style.display = 'none';
    return;
  }

  const targets = state.reviewTargetsData.targets;
  const notifId = state.reviewTargetsData.notif_id;

  let cardsHtml = '';
  targets.forEach((t: any) => {
    const cached = state.translationCache.get(t.pid);
    const transText = cached && cached.translated ? cached.translated : '';
    const isWaiting = !transText || transText.includes('번역 중');

    cardsHtml += `
      <div class="review-card" data-pid="${escapeHtml(t.pid)}" title="클릭하면 본문 및 사이드바의 해당 문장으로 이동합니다">
        <div class="review-card-pid">ID: ${escapeHtml(t.pid)} ${t.reason_category ? `(${escapeHtml(t.reason_category)})` : ''}</div>
        <div class="review-card-ori">원문: ${escapeHtml(t.original || '')}</div>
        <div class="review-card-tra ${isWaiting ? 'waiting' : ''}" id="review-tra-${escapeHtml(t.pid)}">
          ${isWaiting ? '⏳ 번역 대기 또는 재번역 진행 중...' : `번역: ${escapeHtml(transText)}`}
        </div>
      </div>
    `;
  });

  panel.innerHTML = `
    <div class="review-panel-header">
      <div class="review-panel-title">
        <span>🔔 재번역 검수 대상 (${targets.length}건)</span>
      </div>
      <div class="review-panel-actions">
        ${notifId ? `<button id="review-dismiss-notif-btn" class="review-dismiss-btn" title="검수를 완료하고 알림 센터에서 이 알림을 닫습니다">✓ 검수 완료</button>` : ''}
        <button id="review-panel-close-btn" class="review-panel-close-btn" title="패널 접기">&times;</button>
      </div>
    </div>
    <div class="review-panel-body">
      ${cardsHtml}
    </div>
  `;
  panel.style.display = 'block';

  panel.querySelectorAll('.review-card').forEach((card) => {
    card.addEventListener('click', () => {
      const pid = card.getAttribute('data-pid');
      if (pid) focusAndScrollToPid(pid);
    });
  });

  const closeBtn = document.getElementById('review-panel-close-btn');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      panel.style.display = 'none';
    });
  }

  const dismissBtn = document.getElementById('review-dismiss-notif-btn') as HTMLButtonElement | null;
  if (dismissBtn && notifId) {
    dismissBtn.addEventListener('click', async () => {
      try {
        dismissBtn.disabled = true;
        dismissBtn.textContent = '처리 중...';
        await serverFetch(`http://127.0.0.1:8001/cleanup/notifications/${notifId}/dismiss`, {
          method: 'POST',
        });
        try {
          await chrome.storage.local.set({ lastNotificationDismissed: Date.now() });
        } catch (storageErr) {
          console.warn('[ReviewTarget] Failed to notify popup via storage:', storageErr);
        }
        panel.style.display = 'none';
        logToSidebar('✓ 재번역 검수가 완료 처리되어 알림이 해제되었습니다.');
      } catch (e) {
        console.error('Failed to dismiss notification:', e);
        dismissBtn.disabled = false;
        dismissBtn.textContent = '✓ 검수 완료';
      }
    });
  }
}

/**
 * 현재 페이지 URL에 대해 알림 센터 연계 재번역 검수 대상(review_targets)이 존재하는지 조회합니다.
 */
export async function checkAndLoadReviewTargets(cleanUrl: string): Promise<void> {
  try {
    let batchId: string | null = null;
    if (window.location.hash.includes('lanovel_review=')) {
      state.isReviewSession = true;
      const hashMatch = window.location.hash.match(/lanovel_review=([^&]+)/);
      if (hashMatch) {
        batchId = decodeURIComponent(hashMatch[1]);
      }
    } else if (window.location.hash.includes('lanovel_review')) {
      state.isReviewSession = true;
    }

    let apiUrl = `http://127.0.0.1:8001/cleanup/review_targets?url=${encodeURIComponent(cleanUrl)}`;
    if (batchId) {
      apiUrl += `&batch_id=${encodeURIComponent(batchId)}`;
    }

    const res = await serverFetch(apiUrl);
    if (!res.ok) return;
    const data = await res.json();

    if (data.has_targets && Array.isArray(data.targets) && data.targets.length > 0) {
      state.isReviewSession = true;
      state.reviewTargetsData = data;
      state.reviewTargetPids = new Set(data.targets.map((t: any) => t.pid).filter(Boolean));

      renderReviewTargetPanel();
      highlightReviewTargetDOMs();
      updateSidebarReviewTargetHighlights();

      if (window.location.hash.includes('lanovel_review')) {
        showSidebar();
        logToSidebar(
          `🔔 [알림 센터 연계] 재번역 검수 대상 ${data.targets.length}건이 감지되었습니다.`
        );
        const firstPid = data.targets[0].pid;
        if (firstPid) {
          setTimeout(() => focusAndScrollToPid(firstPid), 600);
        }
      }
    }
  } catch (e) {
    console.warn('[checkAndLoadReviewTargets] Failed to load review targets:', e);
  }
}
