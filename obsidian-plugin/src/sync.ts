import type { Book, Library, Page, Snapshot } from "./models";
import { debug, errorMessage, reportError } from "./models";
import { createDocument, documentIdentity, notePath, SyncConflict, updateDocument, validateFolder } from "./documents";

export interface NoteStore {
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  create(path: string, content: string): Promise<void>;
  process(path: string, transform: (current: string) => string): Promise<void>;
}

export interface SyncResult {
  created: number;
  updated: number;
  unchanged: number;
  failures: { title: string; message: string }[];
  paths: string[];
}

export class SyncEngine {
  private busy = false;
  private stopped = false;
  constructor(private library: Library, private notes: NoteStore) {}

  stop(): void { this.stopped = true; }

  async sync(folder: string, selected?: Book[], progress?: (done: number, total: number) => void): Promise<SyncResult> {
    if (this.busy) throw new Error("同步正在进行，请等待完成。");
    if (this.stopped) throw new Error("插件已关闭。");
    validateFolder(folder);
    this.busy = true;
    const result: SyncResult = { created: 0, updated: 0, unchanged: 0, failures: [], paths: [] };
    try {
      const index = await this.indexNotes();
      const books = selected ?? (await this.allBooks()).filter(book => book.annotationCount > 0 || index.has(book.assetId));
      let done = 0;
      const seen = new Set<string>();
      for (const book of books) {
        if (this.stopped) throw new Error("同步已停止。");
        if (seen.has(book.assetId)) continue;
        seen.add(book.assetId);
        try {
          const snapshot = await this.library.call<Snapshot>("book", { id: book.id });
          if (snapshot.book.assetId !== book.assetId) throw new SyncConflict("书库已变化，请刷新后重新同步。");
          if (this.stopped) throw new Error("同步已停止。");
          const existing = index.get(book.assetId) ?? [];
          if (existing.length > 1) throw new SyncConflict("发现同一本书的多个同步文件；请保留一个后重试。");
          const path = existing[0] ?? notePath(folder, snapshot);
          if (existing.length === 0) {
            // create() must be exclusive: a name collision never overwrites a note.
            await this.notes.create(path, createDocument(snapshot));
            index.set(book.assetId, [path]);
            result.created++;
          } else {
            const current = await this.notes.read(path);
            if (updateDocument(current, snapshot) === current) {
              result.unchanged++;
              result.paths.push(path);
              progress?.(++done, books.length);
              continue;
            }
            // Obsidian Vault.process reads the latest content and writes atomically.
            // The earlier index read is never used as the basis of an overwrite.
            let changed = false;
            await this.notes.process(path, current => {
              const next = updateDocument(current, snapshot);
              changed = next !== current;
              return next;
            });
            if (changed) result.updated++; else result.unchanged++;
          }
          result.paths.push(path);
        } catch (error) {
          reportError("book sync failed", error);
          result.failures.push({ title: book.title, message: errorMessage(error) });
        }
        progress?.(++done, books.length);
      }
      debug("sync completed", { created: result.created, updated: result.updated, unchanged: result.unchanged, failed: result.failures.length });
      return result;
    } finally { this.busy = false; }
  }

  private async indexNotes(): Promise<Map<string, string[]>> {
    const index = new Map<string, string[]>();
    for (const path of await this.notes.list()) {
      if (this.stopped) throw new Error("同步已停止。");
      const identity = documentIdentity(await this.notes.read(path));
      if (identity) index.set(identity, [...(index.get(identity) ?? []), path]);
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
