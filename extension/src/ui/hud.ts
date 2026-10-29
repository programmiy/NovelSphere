// hud.ts: 플로팅 미니멀 & 프로그레스 HUD 알림 모듈

function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

let hudTimer: ReturnType<typeof setTimeout> | null = null;
let countdownInterval: ReturnType<typeof setInterval> | null = null;

export interface HudProgressOptions {
  title: string;
  current: number;
  total: number;
  chunkIndex?: number;
  chunkTotal?: number;
  icon?: string;
  subtext?: string;
  durationMs?: number;
}

export interface HudCountdownOptions {
  title: string;
  totalSeconds: number;
  icon?: string;
  subtext?: string;
  onFinish?: () => void;
}

function getOrCreateHud(): HTMLElement {
  let hud = document.getElementById('lanovel-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'lanovel-hud';
    document.body.appendChild(hud);
  }
  return hud;
}

export function clearLanovelHudTimers(): void {
  if (hudTimer) {
    clearTimeout(hudTimer);
    hudTimer = null;
  }
  if (countdownInterval) {
    clearInterval(countdownInterval);
    countdownInterval = null;
  }
}

export function hideLanovelHud(immediate = false): void {
  clearLanovelHudTimers();
  const hud = document.getElementById('lanovel-hud');
  if (!hud) return;

  if (immediate) {
    hud.classList.remove('visible', 'detailed');
    hud.innerHTML = '';
  } else {
    hud.classList.remove('visible');
    hudTimer = setTimeout(() => {
      hud.classList.remove('detailed');
      hud.innerHTML = '';
      hudTimer = null;
    }, 260);
  }
}

export function showLanovelHud(message: string, icon = '📖', durationMs = 2200): void {
  clearLanovelHudTimers();
  const hud = getOrCreateHud();

  hud.classList.remove('detailed');
  hud.innerHTML = `<span class="hud-icon">${icon}</span><span class="hud-message">${escapeHtml(message)}</span>`;
  hud.classList.add('visible');

  if (durationMs > 0) {
    hudTimer = setTimeout(() => {
      hideLanovelHud(false);
    }, durationMs);
  }
}

export function showLanovelProgressHud(options: HudProgressOptions): void {
  clearLanovelHudTimers();
  const hud = getOrCreateHud();

  const icon = options.icon || '📖';
  const title = options.title || '번역 진행 중';
  const total = Math.max(1, options.total);
  const current = Math.max(0, Math.min(options.current, total));
  const pct = Math.min(100, Math.round((current / total) * 100));

  let chunkInfo = '';
  if (options.chunkIndex !== undefined && options.chunkTotal !== undefined && options.chunkTotal > 0) {
    chunkInfo = `<span class="hud-chunk-info">${options.chunkIndex}/${options.chunkTotal} 묶음</span>`;
  }

  const subtext = options.subtext ? escapeHtml(options.subtext) : `${current}/${total}문장 (${pct}%)`;

  hud.classList.add('detailed');
  hud.innerHTML = `
    <div class="hud-detailed-wrapper">
      <div class="hud-header-row">
        <div class="hud-header-left">
          <span class="hud-icon">${icon}</span>
          <span class="hud-title">${escapeHtml(title)}</span>
        </div>
        <span class="hud-badge hud-badge-progress">${pct}%</span>
      </div>
      <div class="hud-progress-track">
        <div class="hud-progress-fill" style="width: ${pct}%;"></div>
      </div>
      <div class="hud-footer-row">
        <span class="hud-subtext">${subtext}</span>
        ${chunkInfo}
      </div>
    </div>
  `;
  hud.classList.add('visible');

  if (options.durationMs && options.durationMs > 0) {
    hudTimer = setTimeout(() => {
      hideLanovelHud(false);
    }, options.durationMs);
  }
}

export function startLanovelCountdownHud(options: HudCountdownOptions): () => void {
  clearLanovelHudTimers();
  const hud = getOrCreateHud();

  const icon = options.icon || '⏳';
  const title = options.title || '다음 작업 대기 중';
  const totalSeconds = Math.max(1, options.totalSeconds);
  let remaining = totalSeconds;

  const renderCountdown = (sec: number) => {
    const pct = Math.max(0, Math.min(100, Math.round((sec / totalSeconds) * 100)));
    const subtext = options.subtext ? escapeHtml(options.subtext) : `남은 시간: ${sec}초`;

    hud.classList.add('detailed');
    hud.innerHTML = `
      <div class="hud-detailed-wrapper">
        <div class="hud-header-row">
          <div class="hud-header-left">
            <span class="hud-icon">${icon}</span>
            <span class="hud-title">${escapeHtml(title)}</span>
          </div>
          <span class="hud-badge hud-badge-timer">${sec}초</span>
        </div>
        <div class="hud-progress-track">
          <div class="hud-progress-fill hud-fill-timer" style="width: ${pct}%;"></div>
        </div>
        <div class="hud-footer-row">
          <span class="hud-subtext">${subtext}</span>
          <span class="hud-chunk-info">대기 중</span>
        </div>
      </div>
    `;
    hud.classList.add('visible');
  };

  renderCountdown(remaining);

  countdownInterval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      const badge = hud.querySelector('.hud-badge-timer');
      if (badge) badge.textContent = `${remaining}초`;

      const fill = hud.querySelector<HTMLElement>('.hud-fill-timer');
      if (fill) {
        const pct = Math.max(0, Math.min(100, Math.round((remaining / totalSeconds) * 100)));
        fill.style.width = `${pct}%`;
      }
    } else {
      clearLanovelHudTimers();
      const badge = hud.querySelector('.hud-badge-timer');
      if (badge) badge.textContent = '0초';
      const fill = hud.querySelector<HTMLElement>('.hud-fill-timer');
      if (fill) fill.style.width = '0%';

      if (options.onFinish) {
        options.onFinish();
      }
    }
  }, 1000);

  return () => {
    clearLanovelHudTimers();
    hideLanovelHud(false);
  };
}
