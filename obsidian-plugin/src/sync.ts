import { DEFAULT_DOCUMENT_OPTIONS, type Book, type DocumentOptions, type Library, type Page, type Snapshot } from "./models";
import { debug, errorMessage, reportError } from "./models";
import { compareDocument, createDocument, digest, documentIdentity, notePath, resolveDocument, SyncConflict, updateDocument, validateFolder, type DocumentComparison } from "./documents";
import { validateTemplates } from "./templates";

export interface NoteStore {
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  process(path: string, transform: (current: string) => string): Promise<void>;
}
export interface SyncFailure { title: string; message: string; bookId?: number; assetId?: string; path?: string; canResolve?: boolean }
export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failures: SyncFailure[];
  paths: string[];
}
export interface SyncRecord { revision: string; documentHash: string; optionsHash: string }
export interface ConflictReview extends DocumentComparison {
  path: string;
  snapshot: Snapshot;
  documentHash: string;
  options: DocumentOptions;
}
interface IndexedNote { path: string; content: string }

export class SyncEngine {
  private busy = false;
  private stopped = false;
  constructor(private library: Library, private notes: NoteStore, readonly records = new Map<string, SyncRecord>()) {}

  stop(): void { this.stopped = true; }
  private checkActive(): void { if (this.stopped) throw new Error("同步已停止。"); }
  private begin(): void {
    if (this.busy) throw new Error("同步正在进行，请等待完成。");
    this.checkActive(); this.busy = true;
  }

  async sync(folder: string, selected?: Book[], progress?: (done: number, total: number) => void, options = DEFAULT_DOCUMENT_OPTIONS, incremental = false): Promise<SyncResult> {
    validateFolder(folder); validateTemplates(options);
    this.begin();
    const result: SyncResult = { created: 0, updated: 0, unchanged: 0, skipped: 0, failures: [], paths: [] };
    const optionsHash = digest(JSON.stringify(options));
    try {
      const index = await this.indexNotes();
      const entries = this.library.syncIndex ? await this.library.syncIndex() : (await this.allBooks()).map(book => ({ book, revision: "" }));
      const revisions = new Map(entries.map(entry => [entry.book.assetId, entry.revision]));
      const books = selected ?? entries.map(entry => entry.book).filter(book => book.annotationCount > 0 || index.has(book.assetId));
      let done = 0;
      const seen = new Set<string>();
      for (const book of books) {
        this.checkActive();
        if (seen.has(book.assetId)) continue;
        seen.add(book.assetId);
        let path: string | undefined;
        try {
          const existing = index.get(book.assetId) ?? [];
          if (existing.length > 1) throw new SyncConflict("发现同一本书的多个同步文件；请保留一个后重试。");
          const note = existing[0]; path = note?.path;
          const revision = revisions.get(book.assetId) ?? "";
          const record = this.records.get(book.assetId);
          if (incremental && note && revision && record?.revision === revision && record.optionsHash === optionsHash && record.documentHash === digest(note.content)) {
            result.unchanged++; result.skipped++; result.paths.push(note.path);
            progress?.(++done, books.length); continue;
          }
          const snapshot = await this.library.call<Snapshot>("book", { id: book.id });
          if (snapshot.book.assetId !== book.assetId) throw new SyncConflict("书库已变化，请刷新后重新同步。");
          this.checkActive();
          path ??= notePath(folder, snapshot, options);
          let finalContent: string;
          if (!note) {
            finalContent = createDocument(snapshot, options);
            await this.notes.create(path, finalContent);
            index.set(book.assetId, [{ path, content: finalContent }]);
            result.created++;
          } else {
            const current = await this.notes.read(path);
            if (updateDocument(current, snapshot, options) === current) {
              finalContent = current; result.unchanged++;
            } else {
              let changed = false;
              finalContent = current;
              await this.notes.process(path, current => {
                this.checkActive();
                const next = updateDocument(current, snapshot, options);
                changed = next !== current; finalContent = next;
                return next;
              });
              if (changed) result.updated++; else result.unchanged++;
            }
          }
          this.records.set(book.assetId, { revision, documentHash: digest(finalContent), optionsHash });
          result.paths.push(path);
        } catch (error) {
          reportError("book sync failed", error);
          result.failures.push({ title: book.title, message: errorMessage(error), bookId: book.id, assetId: book.assetId, path, canResolve: error instanceof SyncConflict && !!path });
        }
        progress?.(++done, books.length);
      }
      // Source books may disappear; their notes remain, only stale cache entries go.
      for (const assetID of this.records.keys()) if (!revisions.has(assetID)) this.records.delete(assetID);
      debug("sync completed", { created: result.created, updated: result.updated, unchanged: result.unchanged, skipped: result.skipped, failed: result.failures.length });
      return result;
    } finally { this.busy = false; }
  }

  async review(failure: SyncFailure, options: DocumentOptions): Promise<ConflictReview> {
    this.checkActive();
    if (!failure.path || !failure.bookId || !failure.assetId) throw new Error("本问题需要先打开笔记检查，无法自动对比。");
    const matches = (await this.indexNotes()).get(failure.assetId) ?? [];
    if (matches.length !== 1 || matches[0]?.path !== failure.path) throw new SyncConflict("笔记已移动或存在多个副本，请重新同步。");
    const snapshot = await this.library.call<Snapshot>("book", { id: failure.bookId });
    if (snapshot.book.assetId !== failure.assetId) throw new SyncConflict("书库标识已变化，请重新同步。");
    const current = await this.notes.read(failure.path);
    this.checkActive();
    return { ...compareDocument(current, snapshot, options), path: failure.path, snapshot, documentHash: digest(current), options: { ...options } };
  }

  async resolve(review: ConflictReview, body: string, properties: string | undefined, currentOptions: DocumentOptions): Promise<void> {
    this.begin();
    try {
      if (JSON.stringify(currentOptions) !== JSON.stringify(review.options)) throw new SyncConflict("模板设置已变化，请重新打开对比。");
      const snapshot = await this.library.call<Snapshot>("book", { id: review.snapshot.book.id });
      if (digest(JSON.stringify(snapshot)) !== digest(JSON.stringify(review.snapshot))) throw new SyncConflict("Apple Books 内容已变化，请重新打开对比。");
      const matches = (await this.indexNotes()).get(snapshot.book.assetId) ?? [];
      if (matches.length !== 1 || matches[0]?.path !== review.path) throw new SyncConflict("笔记已移动或存在多个副本，请重新同步。");
      this.checkActive();
      await this.notes.process(review.path, current => {
        this.checkActive();
        if (digest(current) !== review.documentHash) throw new SyncConflict("笔记在对比期间被修改，已保留最新内容；请重新打开对比。");
        return resolveDocument(current, snapshot, review.options, body, properties);
      });
      this.records.delete(snapshot.book.assetId);
      debug("sync conflict resolved", { bookID: snapshot.book.id });
    } finally { this.busy = false; }
  }

  private async indexNotes(): Promise<Map<string, IndexedNote[]>> {
    const index = new Map<string, IndexedNote[]>();
    for (const path of await this.notes.list()) {
      this.checkActive();
      const content = await this.notes.read(path);
      const identity = documentIdentity(content);
      if (identity) index.set(identity, [...(index.get(identity) ?? []), { path, content }]);
    }
    return index;
  }

  private async allBooks(): Promise<Book[]> {
    const books: Book[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await this.library.call<Page<Book>>("books", { limit: 100, offset });
      books.push(...page.items);
      if (page.items.length === 0 || offset + page.items.length >= page.total) break;
    }
    return books;
  }
}
