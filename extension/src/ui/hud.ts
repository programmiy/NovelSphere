// hud.ts: 플로팅 미니멀 HUD 알림 모듈

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

export function showLanovelHud(message: string, icon = '📖', durationMs = 2200): void {
  let hud = document.getElementById('lanovel-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'lanovel-hud';
    document.body.appendChild(hud);
  }
  hud.innerHTML = `<span class="hud-icon">${icon}</span><span class="hud-message">${escapeHtml(message)}</span>`;
  hud.classList.add('visible');

  if (hudTimer) {
    clearTimeout(hudTimer);
  }
  hudTimer = setTimeout(() => {
    if (hud) hud.classList.remove('visible');
  }, durationMs);
}
