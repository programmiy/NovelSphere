// state.ts: 중앙 집중식 상태 관리 및 원격 제어 직접 발행 엔진 (wrapGlobal 해킹 폐기)
import type { RemoteStatusPayload, RemotePhase, RemoteCommandType, RemoteCommandResult } from '../types/remote.ts';
import type { TranslationRecord, SeparatorConfig, SeparatorExcludedItem } from '../types/novel.ts';
import { DEFAULT_GLOBAL_SEPARATORS } from './separators.ts';

export class ExtensionState {
  // 번역 수명주기 상태
  public hasScannedForPTags = false;
  public isTranslationCancelled = false;
  public resolveResume: (() => void) | null = null;
  public translationCache = new Map<string, TranslationRecord>();
  public exclusionSet = new Set<string>();
  public isPageApplied = false;
  public translationsLoadedPromise: Promise<TranslationRecord[] | null> | null = null;
  public userDeletedTranslationPids = new Set<string>();

  // 소설 및 구분선 상태
  public currentNovelTitle = '';
  public activeSeparators: string[] = [...DEFAULT_GLOBAL_SEPARATORS];
  public separatorConfig: SeparatorConfig = {
    useDefaults: true,
    customSeparators: [],
    effectiveSeparators: [...DEFAULT_GLOBAL_SEPARATORS],
  };
  public separatorExcludedItems: SeparatorExcludedItem[] = [];

  // 알림 센터 검수 상태
  public reviewTargetsData: any = null;
  public reviewTargetPids = new Set<string>();
  public isReviewSession = false;

  // ⚡ 쾌속모드 상태
  public isTurboMode = false;
  public turboCutoffHour: number | null = null;
  public turboTargetTimestamp = 0;
  public turboAbortedOnLoad = false;
  public currentDelayResolver: (() => void) | null = null;
  public currentDelayStart = 0;

  // 원격 제어 및 관찰 상태
  public inflight = 0;
  public remoteNextPending = false;
  public nextDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  public lastLogText = '';
  public censorSplitUntil = 0;
  public retryDelayUntil = 0;
  public activeDelayFn: (() => number) | number | null = null;

  // 원격 제어 핸들러 주입
  public onNextEpisode: (() => RemoteCommandResult) | null = null;
  public onPrevEpisode: (() => RemoteCommandResult) | null = null;
  public onRetranslate: (() => RemoteCommandResult) | null = null;
  public onResumeTranslation: (() => void) | null = null;
  public onStartTranslation: ((isRetranslation?: boolean) => Promise<void>) | null = null;
  public onToggleTurboMode: ((enabled: boolean, save: boolean) => void) | null = null;
  public onExtractEpisodeTitle: (() => string) | null = null;

  private reportIntervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startStatusReporting();
  }

  public isReviewMode(): boolean {
    const hasHash = typeof window !== 'undefined' && window.location && window.location.hash.includes('lanovel_review');
    return this.isReviewSession || hasHash || Boolean(this.reviewTargetPids && this.reviewTargetPids.size > 0);
  }


  public recordLog(message: string): void {
    const text = String(message || '');
    this.lastLogText = text.slice(0, 120);
    if (text.includes('문장 분할 재시도') || text.includes('검열 감지')) {
      this.censorSplitUntil = Date.now() + 20000;
    }
    const m = text.match(/(\d+)초 후 재시도/);
    if (m) {
      this.retryDelayUntil = Date.now() + parseInt(m[1], 10) * 1000;
    }
    this.broadcastStatus();
  }

  public notifyInflightStart(): void {
    this.inflight++;
    this.broadcastStatus();
  }

  public notifyInflightEnd(): void {
    this.inflight = Math.max(0, this.inflight - 1);
    this.broadcastStatus();
  }

  public computeProgress(): number {
    const rows = document.querySelectorAll('#translation-table-body tr[data-pid]');
    if (!rows.length) return 0;
    let done = 0;
    rows.forEach((tr) => {
      const cell = tr.querySelector('.translated-text');
      const t = cell ? (cell.textContent || '').trim() : '';
      if (t && !t.includes('번역 중') && !t.includes('재번역 중')) done++;
    });
    return Math.round((done / rows.length) * 100);
  }

  public delayRemainingSec(): number {
    let remaining = 0;
    try {
      if (this.currentDelayResolver && this.activeDelayFn) {
        const target = typeof this.activeDelayFn === 'function' ? this.activeDelayFn() : this.activeDelayFn;
        remaining = Math.max(remaining, target - (Date.now() - this.currentDelayStart));
      }
    } catch (e) {}
    remaining = Math.max(remaining, this.retryDelayUntil - Date.now());
    return Math.max(0, Math.ceil(remaining / 1000));
  }

  public buildStatusPayload(): RemoteStatusPayload {
    const cancelled = this.isTranslationCancelled;
    const turboAborted = this.turboAbortedOnLoad;
    const delaySec = this.delayRemainingSec();

    let phase: RemotePhase = 'idle';
    if (turboAborted) phase = 'turbo_wait';
    else if (cancelled) phase = 'paused';
    else if (Date.now() < this.censorSplitUntil && this.inflight > 0) phase = 'censor_split';
    else if (delaySec > 0) phase = 'delay_wait';
    else if (this.inflight > 0) phase = 'translating';

    let chapterTitle = '';
    try {
      chapterTitle = (this.onExtractEpisodeTitle && this.onExtractEpisodeTitle()) || document.title || '';
    } catch (e) {
      chapterTitle = document.title || '';
    }

    return {
      phase,
      text: this.lastLogText,
      url: window.location.href.split('#')[0],
      book_title: this.currentNovelTitle || '',
      chapter_title: chapterTitle,
      percentage: this.computeProgress(),
      delay_remaining_sec: phase === 'delay_wait' ? delaySec : 0,
      next_scheduled: this.remoteNextPending,
      turbo: this.isTurboMode,
    };
  }

  public broadcastStatus(): void {
    if (!document.getElementById('jp-translator-sidebar')) return;
    try {
      const payload = this.buildStatusPayload();
      chrome.runtime.sendMessage({ action: 'remoteStatus', data: payload }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      // extension context invalidated
    }
  }

  private startStatusReporting(): void {
    if (typeof document === 'undefined') return;
    if (this.reportIntervalTimer) clearInterval(this.reportIntervalTimer);
    this.reportIntervalTimer = setInterval(() => {
      this.broadcastStatus();
    }, 2000);
    if (this.reportIntervalTimer && typeof (this.reportIntervalTimer as any).unref === 'function') {
      (this.reportIntervalTimer as any).unref();
    }
  }

  public handleRemoteCommand(type: RemoteCommandType, _params: Record<string, any> = {}): RemoteCommandResult {
    const sidebar = document.getElementById('jp-translator-sidebar');
    if (!sidebar) return { ok: false, message: '이 탭은 번역 페이지가 아닙니다.' };

    switch (type) {
      case 'next':
        if (this.inflight > 0) {
          this.remoteNextPending = true;
          return { ok: true, message: '현재 화 번역이 끝나면 다음 화로 이동합니다.' };
        }
        if (this.isTranslationCancelled) {
          this.remoteNextPending = true;
          return { ok: true, message: '일시정지 상태입니다. 재개 후 번역이 끝나면 이동합니다.' };
        }
        if (this.onNextEpisode) return this.onNextEpisode();
        return { ok: false, message: '다음 화 이동 핸들러가 등록되지 않았습니다.' };

      case 'cancel_next':
        this.remoteNextPending = false;
        if (this.nextDeadlineTimer) {
          clearTimeout(this.nextDeadlineTimer);
          this.nextDeadlineTimer = null;
        }
        return { ok: true, message: '다음화 예약을 취소했습니다.' };

      case 'prev':
        if (this.onPrevEpisode) return this.onPrevEpisode();
        return { ok: false, message: '이전 화 이동 핸들러가 등록되지 않았습니다.' };

      case 'pause':
        if (this.isTranslationCancelled) return { ok: true, message: '이미 일시정지 상태입니다.' };
        this.isTranslationCancelled = true;
        const stopBtn = document.getElementById('stop-translation-btn') as HTMLButtonElement | null;
        if (stopBtn) stopBtn.click();
        this.broadcastStatus();
        return { ok: true, message: '일시정지했습니다.' };

      case 'resume':
        if (this.resolveResume) {
          const resumeBtn = document.getElementById('resume-translation-btn') as HTMLButtonElement | null;
          if (resumeBtn) resumeBtn.click();
          this.broadcastStatus();
          return { ok: true, message: '번역을 재개합니다.' };
        }
        if (this.isTranslationCancelled) {
          this.isTranslationCancelled = false;
          const retryBtn = document.getElementById('retry-translation-btn');
          if (retryBtn) retryBtn.style.display = 'none';
          if (this.onStartTranslation) {
            this.onStartTranslation(false);
            this.broadcastStatus();
            return { ok: true, message: '남은 문장부터 번역을 다시 시작합니다.' };
          }
        }
        return { ok: true, message: '이미 진행 중입니다.' };

      case 'turbo_on':
        if (this.onToggleTurboMode) this.onToggleTurboMode(true, true);
        this.broadcastStatus();
        return { ok: true, message: '터보 모드를 켰습니다.' };

      case 'turbo_off':
        if (this.onToggleTurboMode) this.onToggleTurboMode(false, true);
        this.broadcastStatus();
        return { ok: true, message: '터보 모드를 껐습니다.' };

      case 'retranslate':
        if (this.onRetranslate) return this.onRetranslate();
        const retryEl = document.getElementById('retry-translation-btn') as HTMLButtonElement | null;
        if (retryEl) {
          retryEl.click();
          return { ok: true, message: '현재 화 전체 재번역을 시작합니다.' };
        }
        return { ok: false, message: '재번역 버튼을 찾을 수 없습니다.' };

      default:
        return { ok: false, message: `이 탭에서 처리하지 않는 명령: ${type}` };
    }
  }
}

export const state = new ExtensionState();
