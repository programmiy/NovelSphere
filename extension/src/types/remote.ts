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

export interface RemoteTabReport {
  data: RemoteStatusPayload;
  at: number;
  activeAt: number;
}
