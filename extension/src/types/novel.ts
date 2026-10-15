// novel.ts: 소설 플랫폼 및 번역 데이터 공통 타입 정의

export interface ParagraphItem {
  element: HTMLElement;
  text: string;
  pid: string;
}

export interface TranslationRecord {
  id?: string;
  pid?: string;
  original: string;
  translated: string;
  error?: string;
  timestamp?: number;
  folderName?: string | null;
  title?: string;
}

export interface SeparatorConfig {
  useDefaults: boolean;
  customSeparators: string[];
  effectiveSeparators: string[];
}

export interface SeparatorMatch {
  sep: string;
  index: number;
}

export interface SeparatorAnalysis {
  topSeparator?: SeparatorMatch;
  bottomSeparator?: SeparatorMatch;
  prefacePids: Set<string>;
  afterwordPids: Set<string>;
  separatorPids: Set<string>;
}

export interface BatchStats {
  consecutiveCount: number;
  novelTodayCount: number;
  totalTodayCount: number;
}
