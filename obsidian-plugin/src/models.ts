export interface Book {
  id: number;
  assetId: string;
  title: string;
  author: string;
  progress: number;
  status: string;
  annotationCount: number;
  noteCount: number;
  finishedAt?: string;
}

export interface Annotation {
  id: number;
  uuid: string;
  type: string;
  style: number;
  isUnderline: boolean;
  selectedText?: string;
  note?: string;
  location?: string;
  createdAt?: string;
  modifiedAt?: string;
  chapter?: string;
  chapterOrder: number;
}

export interface Snapshot {
  book: Book;
  annotations: Annotation[];
  chaptersAvailable: boolean;
}

export interface Page<T> { items: T[]; total: number; limit: number; offset: number }
export interface Review { book: Book; annotation: Annotation }
export interface Summary {
  totalBooks: number;
  readingBooks: number;
  finishedBooks: number;
  annotationCount: number;
  readingSeconds: number;
  readingTimeAvailable: boolean;
  readingTimeError?: string;
  readingYears: number[] | null;
  annotationYears: number[] | null;
  finishedYears: { year: number; count: number }[] | null;
}

export interface YearReport {
  year: number;
  finishedBooks: number;
  annotationCount: number;
  activeDays: number;
  readingTimeAvailable: boolean;
  readingTimeError?: string;
  readingSeconds: number;
  months: { month: number; annotationCount: number; readingSeconds: number }[];
  topBooks: { book: Book; annotationCount: number }[];
}

export interface Settings {
  outputFolder: string;
  syncOnStartup: boolean;
  libraryDB: string;
  annotationDB: string;
  readingHistoryDB: string;
}

export const DEFAULT_SETTINGS: Settings = {
  outputFolder: "Apple Books",
  syncOnStartup: false,
  libraryDB: "",
  annotationDB: "",
  readingHistoryDB: "",
};

export interface Library {
  call<T>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function debug(message: string, details?: unknown): void {
  console.debug(`[Apple Books] ${message}`, details ?? "");
}

export function reportError(message: string, error: unknown): void {
  console.error(`[Apple Books] ${message}`, error);
}
