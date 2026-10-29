import { serverFetch } from './api_client';
// dom_applier.ts: 웹소설 본문 DOM 번역문 주입, 원문 복원 및 문단 클릭 상호작용 모듈
import { state } from './state';
import { PID_REGEX } from './filters';
import { logToSidebar, updateApplyButtonUI, showSidebar } from '../ui/sidebar';

export function getCleanUrl(): string {
  return window.location.href.split('#')[0].trim();
}

export function getTargetParagraphs(): HTMLElement[] {
  const allParagraphs = document.querySelectorAll<HTMLElement>('p[id]');
  return Array.from(allParagraphs).filter((p) => !p.classList.contains('blank') && PID_REGEX.test(p.id));
}

export function applyTranslationsToPage(translations: any[], logNotification = true): void {
  if (!translations || translations.length === 0) return;

  const translationMap = new Map(translations.map((t) => [t.pid || t.id, t.translated]));
  const paragraphs = getTargetParagraphs();
  let replacementCount = 0;

  paragraphs.forEach((p) => {
    if (translationMap.has(p.id)) {
      const translatedText = translationMap.get(p.id);
      if (translatedText && !translatedText.includes('번역 실패') && !translatedText.includes('API 오류')) {
        if (!p.dataset.lanovelOriginalHtml) {
          p.dataset.lanovelOriginalHtml = p.innerHTML;
          p.dataset.lanovelOriginalStyle = p.getAttribute('style') || '';
        }
        p.innerHTML = translatedText;
        p.classList.add('lanovel-applied-text');
        const appliedStyle = { color: '#E2E8F0', fontFamily: 'TwoCon' };
        Object.assign(p.style, appliedStyle);
        replacementCount++;
      }
    }
  });

  if (logNotification && replacementCount > 0) {
    logToSidebar(`페이지에 번역 ${replacementCount}개를 적용했습니다.`);
  }
  updateApplyButtonUI(true, paragraphs.length);
  setupParagraphInteraction();
}

export function restoreOriginalPage(): void {
  const paragraphs = getTargetParagraphs();
  let restoredCount = 0;

  paragraphs.forEach((p) => {
    if (p.dataset.lanovelOriginalHtml) {
      p.innerHTML = p.dataset.lanovelOriginalHtml;
      if (p.dataset.lanovelOriginalStyle) {
        p.setAttribute('style', p.dataset.lanovelOriginalStyle);
      } else {
        p.removeAttribute('style');
      }
      p.classList.remove('lanovel-applied-text');
      restoredCount++;
    }
  });

  logToSidebar(`본문을 원문으로 복원했습니다 (${restoredCount}개 문단).`);
  updateApplyButtonUI(false, paragraphs.length);
  setupParagraphInteraction();
}

export async function setPageApplyStatus(applied: boolean, syncStorageAndServer = true): Promise<void> {
  state.isPageApplied = applied;

  if (state.isPageApplied) {
    const allTranslations = Array.from(state.translationCache.values());
    applyTranslationsToPage(allTranslations, true);
  } else {
    restoreOriginalPage();
  }

  const paragraphs = getTargetParagraphs();
  updateApplyButtonUI(state.isPageApplied, paragraphs.length);

  if (syncStorageAndServer) {
    const cleanUrl = getCleanUrl();
    const currentUrl = window.location.href;

    try {
      await serverFetch('http://127.0.0.1:8001/api/urls/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cleanUrl, apply: state.isPageApplied }),
      });
    } catch (e) {
      console.warn('[setPageApplyStatus] Failed to sync apply status to server:', e);
    }

    try {
      const statusObj = { applied: state.isPageApplied, timestamp: Date.now() };
      await chrome.storage.local.set({
        ['status-' + cleanUrl]: statusObj,
        ['status-' + currentUrl]: statusObj,
      });
    } catch (e) {
      console.warn('[setPageApplyStatus] Failed to sync apply status to chrome storage:', e);
    }
  }
}

export function togglePageApplyStatus(): void {
  setPageApplyStatus(!state.isPageApplied, true);
}

export function setupParagraphInteraction(): void {
  const paragraphs = getTargetParagraphs();
  paragraphs.forEach((p) => {
    if (p.dataset.lanovelLinked) return;
    p.dataset.lanovelLinked = 'true';

    p.addEventListener('click', () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;

      p.classList.remove('lanovel-highlight-pulse');
      void p.offsetWidth;
      p.classList.add('lanovel-highlight-pulse');
      setTimeout(() => {
        p.classList.remove('lanovel-highlight-pulse');
      }, 1600);

      const row = document.querySelector<HTMLTableRowElement>(`tr[data-pid="${p.id}"]`);
      if (row) {
        showSidebar();
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.classList.remove('lanovel-row-highlight');
        void row.offsetWidth;
        row.classList.add('lanovel-row-highlight');
        setTimeout(() => {
          row.classList.remove('lanovel-row-highlight');
        }, 1600);
      }
    });
  });
}

/**
 * URL 해시 또는 외부 링크(#L15, #p15)를 통해 특정 단락으로 순간이동하고 시각적 효과를 부여합니다.
 * 화면 비율 65% 이상일 때만 번역 사이드바를 함께 전개하고 행을 포커스합니다.
 */
export function jumpToParagraph(rawPid: string): boolean {
  if (!rawPid) return false;
  const cleanPid = rawPid.replace(/^#/, '').trim();
  if (!cleanPid) return false;

  // Syosetu (#L1, L1), Kakuyomu (#p1, p1), 또는 기타 DOM ID 매핑 탐색
  let targetP: HTMLElement | null = document.getElementById(cleanPid);
  if (!targetP && cleanPid.startsWith('p')) {
    targetP = document.getElementById(cleanPid.slice(1));
  }
  if (!targetP && !cleanPid.startsWith('p') && !cleanPid.startsWith('L')) {
    targetP = document.getElementById('p' + cleanPid) || document.getElementById('L' + cleanPid);
  }
  if (!targetP) {
    targetP =
      document.querySelector<HTMLElement>(`[data-pid="${cleanPid}"]`) ||
      document.querySelector<HTMLElement>(`p#${cleanPid}`);
  }

  if (!targetP) return false;

  // 1. 본문 단락으로 즉시 부드럽게 스크롤 & 펄스 애니메이션 발광
  targetP.scrollIntoView({ behavior: 'smooth', block: 'center' });
  targetP.classList.remove('lanovel-highlight-pulse');
  void targetP.offsetWidth;
  targetP.classList.add('lanovel-highlight-pulse');
  setTimeout(() => {
    targetP?.classList.remove('lanovel-highlight-pulse');
  }, 1600);

  // 2. 화면 비율 65% 이상 규칙 검사 (창 너비 / 모니터 유효 가로폭)
  const availWidth = (window.screen && (window.screen.availWidth || window.screen.width)) || 1920;
  const screenRatio = window.innerWidth / availWidth;

  if (screenRatio >= 0.65) {
    const row =
      document.querySelector<HTMLTableRowElement>(`tr[data-pid="${cleanPid}"]`) ||
      document.querySelector<HTMLTableRowElement>(`tr[data-pid="${targetP.id}"]`);
    if (row) {
      showSidebar();
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('lanovel-row-highlight');
      void row.offsetWidth;
      row.classList.add('lanovel-row-highlight');
      setTimeout(() => {
        row?.classList.remove('lanovel-row-highlight');
      }, 1600);
    }
  }

  return true;
}
