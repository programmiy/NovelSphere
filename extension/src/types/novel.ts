// novel.ts: 소설 플랫폼 및 번역 데이터 공통 타입 정의

export interface ParagraphItem {
  element: HTMLElement;
  text: string;
  pid: string;
}

export interface TranslationRecord {
  id?: string | number;
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
  pid?: string;
}

export interface ExcludedPidInfo {
  matchedSep: string;
  isSubsequent: boolean;
  isPreface: boolean;
}

export interface SeparatorAnalysis {
  topSeparator?: SeparatorMatch | null;
  bottomSeparator?: SeparatorMatch | null;
  prefacePids: Set<string>;
  afterwordPids: Set<string>;
  separatorPids: Set<string>;
  excludedPidMap: Map<string, ExcludedPidInfo>;
}

export interface SeparatorExcludedItem {
  id: string | number;
  pid: string;
  original: string;
  translated: string;
  matchedSep: string;
  isSubsequent: boolean;
  isPreface?: boolean;
}

export interface BatchStats {
  consecutiveCount: number;
  novelTodayCount: number;
  totalTodayCount: number;
}

