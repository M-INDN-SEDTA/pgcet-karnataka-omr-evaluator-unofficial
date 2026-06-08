export interface PageLookupResult {
  success: boolean;
  pageNo?: number;
  message?: string;
  isMock?: boolean;
}

export interface ScoreResult {
  success: boolean;
  versionCode: string;
  studentAnswers: string[];
  message: string;
  debugImageUrl?: string;
  debugParts?: { name: string; dataUrl: string; extractedAnswers: string[] }[];
}

export interface SummaryData {
  totalCorrect: number;
  totalWrong: number;
  totalBlank: number;
  totalMultiple: number;
  score: number;
}

