// turbo.ts: 쾌속모드 및 일일 쿼터 초기화(16/17시) 관리 모듈

export interface CutoffInfo {
  hour: number;
  isDst: boolean;
  label: string;
}

// 미국 써머타임 공식 룰 (3월 둘째 일요일 02시 ~ 11월 첫째 일요일 02시)
export function isUsDstRule(d: Date = new Date()): boolean {
  const year = d.getFullYear();
  const march1 = new Date(year, 2, 1);
  const firstSunMarch = ((7 - march1.getDay()) % 7) + 1;
  const secondSunMarch = firstSunMarch + 7;
  const dstStart = new Date(year, 2, secondSunMarch, 2, 0, 0);

  const nov1 = new Date(year, 10, 1);
  const firstSunNov = ((7 - nov1.getDay()) % 7) + 1;
  const dstEnd = new Date(year, 10, firstSunNov, 2, 0, 0);

  return d >= dstStart && d < dstEnd;
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

// 기준 정각의 다음 타임스탬프 계산 (오늘 이미 지났으면 내일 정각)
export function calculateNextCutoffTimestamp(cutoffHour: number): number {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), cutoffHour, 0, 0, 0);
  if (now.getTime() >= target.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime();
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
  const cutoffHour = detectCutoffInfo(turboCutoffHour).hour;
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hour = now.getHours();

  if (hour < cutoffHour) {
    const prev = new Date(now.getTime() - 24 * 3600 * 1000);
    const pYear = prev.getFullYear();
    const pMonth = String(prev.getMonth() + 1).padStart(2, '0');
    const pDay = String(prev.getDate()).padStart(2, '0');
    return `${pYear}-${pMonth}-${pDay}_${cutoffHour}`;
  }
  return `${year}-${month}-${day}_${cutoffHour}`;
}
