import initSqlJs from "sql.js/dist/sql-asm.js";
import type { SqlJsStatic, SqlValue } from "sql.js";
import { createHash } from "node:crypto";
import { resolveDatabasePaths } from "./database-paths";
import { databaseSignature, readSnapshot } from "./sqlite-snapshot";
import { decodeHistory, type History } from "./reading-history";
import { readChapters } from "./chapters";
import { describeHistoryError } from "./history-status";
import { debug, reportError, errorMessage, type Annotation, type Book, type Library, type Page, type Review, type Settings, type Snapshot, type Summary, type YearReport } from "./models";

export class LibraryError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}

interface SourceBook extends Book { sourcePath: string }
interface SourceAnnotation extends Annotation { assetId: string }
interface Data {
  books: SourceBook[];
  annotations: SourceAnnotation[];
  wantedIDs: number[];
  history?: History;
  historyError?: string;
}
type Row = Record<string, SqlValue>;
const text = (row: Row, field: string): string => String(row[field] ?? "");
const number = (row: Row, field: string): number => Number(row[field] ?? 0);
const appleDate = (value: number): string | undefined => value > 0 ? new Date((978307200 + value) * 1000).toISOString() : undefined;
const hasText = (annotation: Annotation): boolean => !!(annotation.selectedText?.trim() || annotation.note?.trim());
let engine: Promise<SqlJsStatic> | undefined;

async function queryFile(path: string, queries: string[]): Promise<Row[][]> {
  engine ??= initSqlJs().catch(error => { engine = undefined; throw error; });
  const [SQL, bytes] = await Promise.all([engine, readSnapshot(path)]);
  const database = new SQL.Database(bytes);
  try {
    database.run("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF;");
    if (database.exec("PRAGMA quick_check")[0]?.values[0]?.[0] !== "ok") throw new Error("SQLite 快照完整性检查失败，请等待 Apple Books 同步完成后重试。");
    return queries.map(query => {
      const statement = database.prepare(query);
      try {
        const rows: Row[] = [];
        while (statement.step()) rows.push(statement.getAsObject());
        return rows;
      } finally { statement.free(); }
    });
  } finally { database.close(); }
}

const BOOK_QUERY = `SELECT Z_PK, ZASSETID, ZTITLE, ZAUTHOR, ZREADINGPROGRESS, ZISFINISHED, ZDATEFINISHED, ZPATH FROM ZBKLIBRARYASSET ORDER BY ZTITLE COLLATE NOCASE, ZAUTHOR COLLATE NOCASE, Z_PK`;
const WANTED_QUERY = `SELECT DISTINCT asset.Z_PK FROM ZBKLIBRARYASSET asset JOIN ZBKCOLLECTIONMEMBER member ON member.ZASSET = asset.Z_PK JOIN ZBKCOLLECTION collection ON collection.Z_PK = member.ZCOLLECTION WHERE collection.ZCOLLECTIONID = 'Want_To_Read_Collection_ID' ORDER BY member.ZSORTKEY, member.Z_PK`;
const ANNOTATION_QUERY = `SELECT Z_PK, ZANNOTATIONUUID, ZANNOTATIONTYPE, ZANNOTATIONSTYLE, ZANNOTATIONISUNDERLINE, ZANNOTATIONSELECTEDTEXT, ZANNOTATIONNOTE, ZANNOTATIONLOCATION, ZANNOTATIONCREATIONDATE, ZANNOTATIONMODIFICATIONDATE, ZANNOTATIONASSETID FROM ZAEANNOTATION WHERE COALESCE(ZANNOTATIONDELETED, 0) = 0 AND ZANNOTATIONTYPE IN (1, 2) ORDER BY ZANNOTATIONCREATIONDATE DESC, Z_PK`;

export class AppleBooksLibrary implements Library {
  private queue: Promise<unknown> = Promise.resolve();
  private data?: Data;
  private signature = "";
  private disposed = false;
  private generation = 0;

  constructor(private settings: () => Settings) {}

  async syncIndex(): Promise<{ book: Book; revision: string }[]> {
    return this.call("syncIndex");
  }

  reset(): void { this.generation++; this.data = undefined; this.signature = ""; }
  dispose(): void { this.disposed = true; this.reset(); }

  call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const generation = this.generation;
    const request = this.queue.catch(() => undefined).then(async () => {
      this.checkActive(generation);
      const started = Date.now();
      try {
        validateRequest(method, params);
        const data = await this.load(generation);
        this.checkActive(generation);
        const result = await dispatch(data, method, params);
        this.checkActive(generation);
        debug("local query completed", { method, durationMs: Date.now() - started });
        return result as T;
      } catch (error) {
        reportError("local query failed", { method, message: errorMessage(error) });
        if (["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new Error("无法读取 Apple Books 数据库，请在 macOS 完全磁盘访问权限中允许 Obsidian，然后重启 Obsidian。");
        throw error;
      }
    });
    this.queue = request;
    return request;
  }

  private checkActive(generation: number): void {
    if (this.disposed) throw new Error("插件已关闭。");
    if (generation !== this.generation) throw new Error("数据库设置已变化，请重试。");
  }

  private async load(generation: number): Promise<Data> {
    const paths = await resolveDatabasePaths({ ...this.settings() });
    const historySignature = paths.history ? await databaseSignature(paths.history).catch(error => `unavailable:${(error as NodeJS.ErrnoException).code ?? errorMessage(error)}`) : "disabled";
    const signatures = await Promise.all([databaseSignature(paths.library), databaseSignature(paths.annotations)]);
    const signature = JSON.stringify([paths, signatures, historySignature]);
    if (this.data && signature === this.signature) return this.data;
    const [bookRows, wantedRows] = await queryFile(paths.library, [BOOK_QUERY, WANTED_QUERY]);
    const [annotationRows] = await queryFile(paths.annotations, [ANNOTATION_QUERY]);
    const annotations: SourceAnnotation[] = annotationRows!.map(row => ({
      id: number(row, "Z_PK"), uuid: text(row, "ZANNOTATIONUUID"), type: number(row, "ZANNOTATIONTYPE") === 2 ? "highlight" : "bookmark",
      style: number(row, "ZANNOTATIONSTYLE"), isUnderline: number(row, "ZANNOTATIONISUNDERLINE") === 1,
      selectedText: text(row, "ZANNOTATIONSELECTEDTEXT"), note: text(row, "ZANNOTATIONNOTE"), location: text(row, "ZANNOTATIONLOCATION"),
      createdAt: appleDate(number(row, "ZANNOTATIONCREATIONDATE")), modifiedAt: appleDate(number(row, "ZANNOTATIONMODIFICATIONDATE")), chapterOrder: 0, assetId: text(row, "ZANNOTATIONASSETID"),
    }));
    const counts = new Map<string, { total: number; notes: number }>();
    for (const item of annotations) {
      const count = counts.get(item.assetId) ?? { total: 0, notes: 0 };
      count.total++; if (item.note) count.notes++;
      counts.set(item.assetId, count);
    }
    const books: SourceBook[] = bookRows!.map(row => {
      const assetId = text(row, "ZASSETID"), progress = number(row, "ZREADINGPROGRESS"), finished = number(row, "ZISFINISHED") === 1;
      return { id: number(row, "Z_PK"), assetId, title: text(row, "ZTITLE"), author: text(row, "ZAUTHOR"), progress,
        status: finished ? "finished" : progress > 0 ? "reading" : "unread", finishedAt: finished ? appleDate(number(row, "ZDATEFINISHED")) : undefined,
        annotationCount: counts.get(assetId)?.total ?? 0, noteCount: counts.get(assetId)?.notes ?? 0, sourcePath: text(row, "ZPATH") };
    });
    const data: Data = { books, annotations, wantedIDs: wantedRows!.map(row => number(row, "Z_PK")) };
    if (paths.history) {
      try {
        const [rows] = await queryFile(paths.history, ["SELECT ZPROTODATA FROM ZCRDTMODELSYNCENTITY WHERE ZTYPE = 'ReadingHistoryModel' AND COALESCE(ZDELETEDFLAG, 0) = 0 ORDER BY ZMODIFICATIONDATE DESC LIMIT 1"]);
        const blob = rows?.[0]?.ZPROTODATA;
        if (!(blob instanceof Uint8Array)) throw new Error("阅读历史模型缺失。");
        data.history = decodeHistory(blob);
      } catch (error) {
        data.historyError = describeHistoryError(error);
        reportError("reading history unavailable", { message: errorMessage(error) });
      }
    } else {
      data.historyError = "自定义书库未指定阅读历史数据库。请在高级设置中填写阅读历史数据库路径；书库和批注文件不包含阅读时长。";
    }
    this.checkActive(generation);
    this.data = data; this.signature = signature;
    debug("local library loaded", { books: books.length, annotations: annotations.length, readingHistoryAvailable: !!data.history });
    return data;
  }
}

function validateRequest(method: string, params: Record<string, unknown>): void {
  if (!["summary", "books", "wantToRead", "book", "search", "review", "report", "syncIndex"].includes(method)) throw new Error("未知的书库操作。");
  for (const [key, minimum, maximum] of [["limit", 1, 100], ["offset", 0, 1000000], ["id", 1, Number.MAX_SAFE_INTEGER], ["year", 1900, 3000]] as const) {
    const value = params[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum)) throw new Error(`无效的查询参数：${key}`);
  }
  if ((method === "book" && params.id === undefined) || (method === "report" && params.year === undefined)) throw new Error("缺少查询参数。");
  if (params.search !== undefined && (typeof params.search !== "string" || params.search.length > 1000)) throw new Error("搜索词过长或无效。");
  if (params.status !== undefined && !["", "reading", "finished", "unread"].includes(String(params.status))) throw new Error("无效的阅读状态。");
  if (method === "review" && (typeof params.key !== "string" || !params.key || params.key.length > 128)) throw new Error("无效的回顾标识。");
}

function page<T>(items: T[], params: Record<string, unknown>): Page<T> {
  const limit = Number(params.limit ?? 50), offset = Number(params.offset ?? 0);
  return { items: items.slice(offset, offset + limit), total: items.length, limit, offset };
}
function reviews(data: Data): Review[] {
  const books = new Map(data.books.map(book => [book.assetId, book]));
  return data.annotations.flatMap(annotation => { const book = books.get(annotation.assetId); return book ? [{ book, annotation }] : []; });
}

async function dispatch(data: Data, method: string, params: Record<string, unknown>): Promise<unknown> {
  switch (method) {
    case "syncIndex": {
      const annotations = new Map<string, SourceAnnotation[]>();
      for (const annotation of data.annotations) {
        const items = annotations.get(annotation.assetId) ?? [];
        items.push(annotation); annotations.set(annotation.assetId, items);
      }
      return data.books.map(book => ({ book, revision: createHash("sha256").update(JSON.stringify([book, annotations.get(book.assetId) ?? []])).digest("hex") }));
    }
    case "summary": return summary(data);
    case "report": return report(data, Number(params.year));
    case "books": {
      const query = String(params.search ?? "").trim().toLocaleLowerCase();
      return page(data.books.filter(book => (!params.status || book.status === params.status) && (!query || `${book.title}\n${book.author}`.toLocaleLowerCase().includes(query))), params);
    }
    case "wantToRead": {
      const books = new Map(data.books.map(book => [book.id, book]));
      return page(data.wantedIDs.flatMap(id => { const book = books.get(id); return book ? [book] : []; }), params);
    }
    case "search": {
      const query = String(params.search ?? "").trim().toLocaleLowerCase();
      return page(reviews(data).filter(item => `${item.annotation.selectedText}\n${item.annotation.note}`.toLocaleLowerCase().includes(query)), params);
    }
    case "review": {
      const candidates = reviews(data).filter(item => params.notesOnly ? !!item.annotation.note?.trim() : hasText(item.annotation));
      if (!candidates.length) throw new LibraryError("暂无可回顾的摘录。", "not_found");
      return candidates[createHash("sha256").update(String(params.key)).digest().readUInt32BE(0) % candidates.length];
    }
    case "book": {
      const book = data.books.find(item => item.id === params.id);
      if (!book) throw new LibraryError("书籍不存在，请刷新书库。", "not_found");
      const snapshot: Snapshot = { book, annotations: data.annotations.filter(item => item.assetId === book.assetId && hasText(item)).map(item => ({ ...item })), chaptersAvailable: false };
      if (book.sourcePath) {
        try {
          const chapters = await readChapters(book.sourcePath);
          snapshot.chaptersAvailable = true;
          for (const annotation of snapshot.annotations) {
            const chapter = chapters.lookup(annotation.location ?? "");
            if (chapter) { annotation.chapter = chapter.title; annotation.chapterOrder = chapter.order; }
          }
        } catch (error) { debug("EPUB chapters unavailable", { bookID: book.id, message: errorMessage(error) }); }
      }
      return snapshot;
    }
  }
}

function summary(data: Data): Summary {
  const finished = new Map<number, number>(), annotationYears = new Set<number>();
  for (const book of data.books) if (book.finishedAt) { const year = new Date(book.finishedAt).getFullYear(); finished.set(year, (finished.get(year) ?? 0) + 1); }
  for (const item of data.annotations) if (item.createdAt) annotationYears.add(new Date(item.createdAt).getFullYear());
  return { totalBooks: data.books.length, readingBooks: data.books.filter(book => book.status === "reading").length,
    finishedBooks: data.books.filter(book => book.status === "finished").length, annotationCount: data.annotations.length,
    readingSeconds: data.history?.seconds ?? 0, readingTimeAvailable: !!data.history, readingTimeError: data.historyError,
    readingYears: data.history?.years ?? [], annotationYears: [...annotationYears].sort((a, b) => b - a),
    finishedYears: [...finished].map(([year, count]) => ({ year, count })).sort((a, b) => b.year - a.year) };
}

function report(data: Data, year: number): YearReport {
  const months = Array.from({ length: 12 }, (_, index) => ({ month: index + 1, annotationCount: 0, readingSeconds: data.history?.months.get(year * 100 + index + 1) ?? 0 }));
  const days = new Set<string>(), counts = new Map<string, number>();
  let annotationCount = 0;
  for (const item of data.annotations) {
    if (!item.createdAt) continue;
    const date = new Date(item.createdAt);
    if (date.getFullYear() !== year) continue;
    annotationCount++; months[date.getMonth()]!.annotationCount++;
    days.add(`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`);
    counts.set(item.assetId, (counts.get(item.assetId) ?? 0) + 1);
  }
  return { year, finishedBooks: data.books.filter(book => book.finishedAt && new Date(book.finishedAt).getFullYear() === year).length,
    annotationCount, activeDays: days.size, readingTimeAvailable: !!data.history, readingTimeError: data.historyError,
    readingSeconds: months.reduce((total, month) => total + month.readingSeconds, 0), months,
    topBooks: data.books.filter(book => counts.has(book.assetId)).map(book => ({ book, annotationCount: counts.get(book.assetId)! })).sort((a, b) => b.annotationCount - a.annotationCount || a.book.id - b.book.id).slice(0, 5) };
}
