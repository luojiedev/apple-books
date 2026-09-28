import { DEFAULT_SETTINGS, type Settings, type DocumentOptions } from "./models";
import type { SyncRecord, SyncResult } from "./sync";

export interface LastSync { finishedAt: string; result?: SyncResult; error?: string }

export function readSettings(saved: unknown): Settings {
  const settings = { ...DEFAULT_SETTINGS };
  if (!saved || typeof saved !== "object") return settings;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    const value: unknown = Reflect.get(saved, key);
    if (typeof value === typeof DEFAULT_SETTINGS[key]) Reflect.set(settings, key, value);
  }
  if (!Number.isInteger(settings.syncIntervalMinutes) || settings.syncIntervalMinutes < 1 || settings.syncIntervalMinutes > 1440) settings.syncIntervalMinutes = 5;
  return settings;
}

export function documentOptions(settings: Settings): DocumentOptions {
  return { fileNameTemplate: settings.fileNameTemplate, bodyTemplate: settings.bodyTemplate, includeBookProperties: settings.includeBookProperties };
}

export function readSyncRecords(saved: unknown): Map<string, SyncRecord> {
  const records = new Map<string, SyncRecord>();
  const entries: unknown = saved && typeof saved === "object" ? Reflect.get(saved, "syncRecords") : undefined;
  if (!Array.isArray(entries)) return records;
  for (const entry of entries) {
    if (!Array.isArray(entry) || typeof entry[0] !== "string" || !entry[1] || typeof entry[1] !== "object") continue;
    const record = entry[1] as Partial<SyncRecord>;
    if ([record.revision, record.documentHash, record.optionsHash].every(value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))) records.set(entry[0], record as SyncRecord);
  }
  return records;
}

export function readLastSync(saved: unknown): LastSync | undefined {
  const value: unknown = saved && typeof saved === "object" ? Reflect.get(saved, "lastSync") : undefined;
  if (!value || typeof value !== "object") return undefined;
  const entry = value as Partial<LastSync>;
  if (typeof entry.finishedAt !== "string" || !Number.isFinite(Date.parse(entry.finishedAt))) return undefined;
  if (typeof entry.error === "string") return { finishedAt: entry.finishedAt, error: entry.error };
  const result = entry.result;
  if (!result || ![result.created, result.updated, result.unchanged, result.skipped].every(count => Number.isSafeInteger(count) && count >= 0)) return undefined;
  if (!Array.isArray(result.paths) || !result.paths.every(path => typeof path === "string") || !Array.isArray(result.failures)) return undefined;
  if (!result.failures.every(failure => failure && typeof failure.title === "string" && typeof failure.message === "string" && (failure.path === undefined || typeof failure.path === "string") && (failure.assetId === undefined || typeof failure.assetId === "string") && (failure.bookId === undefined || Number.isSafeInteger(failure.bookId)))) return undefined;
  return { finishedAt: entry.finishedAt, result };
}
