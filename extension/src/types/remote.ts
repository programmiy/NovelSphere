// remote.ts: 원격 제어 및 서버 통신 공통 타입 정의

export type RemotePhase = 'idle' | 'translating' | 'censor_split' | 'delay_wait' | 'paused' | 'turbo_wait';

export interface RemoteStatusPayload {
  phase: RemotePhase;
  text: string;
  url: string;
  book_title: string;
  chapter_title: string;
  percentage: number;
  delay_remaining_sec: number;
  next_scheduled: boolean;
  turbo: boolean;
  tab_id?: number;
}

export type RemoteCommandType =
  | 'reload'
  | 'next'
  | 'cancel_next'
  | 'prev'
  | 'goto'
  | 'pause'
  | 'resume'
  | 'turbo_on'
  | 'turbo_off'
  | 'retranslate'
  | 'go_next_site';

export interface RemoteCommand {
  id?: string;
  type: RemoteCommandType;
  params?: Record<string, any>;
}

export interface RemoteCommandResult {
  ok: boolean;
  message?: string;
}

// ---- '다음에 번역할 소설' 목록 작업 ----

/** 서버가 목록에서 시작시킨 탭에 붙는 표시 (탭 기준이라 사이트가 바뀌어도 유지됨) */
export interface QueueSession {
  queue_item_id: number | null;
  skip_translated: boolean;
}

/** 콘텐츠 스크립트 → 서버로 전달되는 목록 이벤트 */
export interface QueueEventData {
  kind: 'novel_finished' | 'page_problem' | 'cinderella';
  queue_item_id?: number | null;
  reason?: string;
}

/** 서버가 확장에 내려주는 목록 설정 */
export interface RemoteConfig {
  running: boolean;
  cinderella: boolean;
}

export interface RemoteTabReport {
  data: RemoteStatusPayload;
  at: number;
  activeAt: number;
}
