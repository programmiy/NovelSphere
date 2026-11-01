// turbo.ts: 쾌속모드 및 일일 쿼터 초기화(16/17시) 관리 모듈

export interface CutoffInfo {
  hour: number;
  isDst: boolean;
  label: string;
}

/**
 * 미국 서머타임 공식 룰 (UTC 기준 정밀 판정)
 * - 시작: 3월 둘째 주 일요일 02:00 PST (10:00 UTC)
 * - 종료: 11월 첫째 주 일요일 02:00 PDT (09:00 UTC)
 */
export function isUsDstRule(d: Date = new Date()): boolean {
  const utcMs = d.getTime();
  const year = new Date(utcMs).getUTCFullYear();

  const march1 = new Date(Date.UTC(year, 2, 1));
  const firstSunMarch = ((7 - march1.getUTCDay()) % 7) + 1;
  const secondSunMarch = firstSunMarch + 7;
  const dstStartUtc = Date.UTC(year, 2, secondSunMarch, 10, 0, 0);

  const nov1 = new Date(Date.UTC(year, 10, 1));
  const firstSunNov = ((7 - nov1.getUTCDay()) % 7) + 1;
  const dstEndUtc = Date.UTC(year, 10, firstSunNov, 9, 0, 0);

  return utcMs >= dstStartUtc && utcMs < dstEndUtc;
}

/**
 * 미국 태평양(America/Los_Angeles) 다음 자정(리셋 시점) 타임스탬프를 초 단위 오차 없이 탐색
 */
export function getNextLaMidnightTimestamp(now: Date = new Date()): number {
  try {
    const currentLaDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
    }).format(now);

    let low = now.getTime();
    let high = now.getTime() + 27 * 3600 * 1000;

    while (high - low > 1000) {
      const mid = Math.floor((low + high) / 2);
      const midDate = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles',
      }).format(new Date(mid));

      if (midDate === currentLaDate) {
        low = mid;
      } else {
        high = mid;
      }
    }
    return Math.ceil(high / 1000) * 1000;
  } catch (_) {
    // Intl 미지원 환경 fallback: 기본 24시간 후 정각
    const target = new Date(now.getTime());
    target.setHours(isUsDstRule(now) ? 16 : 17, 0, 0, 0);
    if (now.getTime() >= target.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }
}

// ⚡ 쾌속모드 초기화 기준 시각(정각) 감지
export function detectCutoffInfo(turboCutoffHour: number | null = null): CutoffInfo {
  if (turboCutoffHour === 16) {
    return { hour: 16, isDst: true, label: '16:00 (수동)' };
  }
  if (turboCutoffHour === 17) {
    return { hour: 17, isDst: false, label: '17:00 (수동)' };
  }

  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles',
      timeZoneName: 'short',
    }).formatToParts(new Date());
    const tzName = parts.find((p) => p.type === 'timeZoneName')?.value || '';
    const isDst = tzName.includes('PDT') || (!tzName.includes('PST') && isUsDstRule(new Date()));
    return {
      hour: isDst ? 16 : 17,
      isDst: isDst,
      label: isDst ? '16:00 (써머타임)' : '17:00 (표준시)',
    };
  } catch (e) {
    const isDst = isUsDstRule(new Date());
    return {
      hour: isDst ? 16 : 17,
      isDst: isDst,
      label: isDst ? '16:00 (써머타임)' : '17:00 (표준시)',
    };
  }
}

// 기준 정각의 다음 타임스탬프 계산 (미국 태평양 자정 리셋 시점과 100% 동기화)
export function calculateNextCutoffTimestamp(cutoffHour: number): number {
  if (cutoffHour === 16 || cutoffHour === 17) {
    // 수동 오버라이드
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), cutoffHour, 0, 0, 0);
    if (now.getTime() >= target.getTime()) {
      target.setDate(target.getDate() + 1);
    }
    return target.getTime();
  }
  return getNextLaMidnightTimestamp(new Date());
}

// ⚡ 대기시간 경과 후 초기화 정각 도달 여부 판정
export function checkCutoffTimeReached(turboCutoffHour: number | null, turboTargetTimestamp: number): boolean {
  let target = turboTargetTimestamp;
  if (!target) {
    const info = detectCutoffInfo(turboCutoffHour);
    target = calculateNextCutoffTimestamp(info.hour);
  }
  return Date.now() >= target;
}

export function getCurrentQuotaWindow(now: Date = new Date(), turboCutoffHour: number | null = null): string {
  if (turboCutoffHour === 16 || turboCutoffHour === 17) {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = now.getHours();

    if (hour < turboCutoffHour) {
      const prev = new Date(now.getTime() - 24 * 3600 * 1000);
      const pYear = prev.getFullYear();
      const pMonth = String(prev.getMonth() + 1).padStart(2, '0');
      const pDay = String(prev.getDate()).padStart(2, '0');
      return `${pYear}-${pMonth}-${pDay}_${turboCutoffHour}`;
    }
    return `${year}-${month}-${day}_${turboCutoffHour}`;
  }

  // 자동 모드: 미국 LA 현지 날짜(YYYY-MM-DD)를 직접 창출 (서머타임 시작/종료 전환일 완벽 대응)
  try {
    const laDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Los_Angeles',
    }).format(now);
    const info = detectCutoffInfo(turboCutoffHour);
    return `${laDate}_${info.hour}`;
  } catch (_) {
    const info = detectCutoffInfo(turboCutoffHour);
    const cutoffHour = info.hour;
    const hour = now.getHours();
    if (hour < cutoffHour) {
      const prev = new Date(now.getTime() - 24 * 3600 * 1000);
      return `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}-${String(prev.getDate()).padStart(2, '0')}_${cutoffHour}`;
    }
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${cutoffHour}`;
  }
}
