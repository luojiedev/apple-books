import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DOCUMENT_OPTIONS, DEFAULT_SETTINGS, type Library, type Snapshot } from "../src/models.ts";
import { compareDocument, createDocument, digest, notePath, resolveDocument, updateDocument } from "../src/documents.ts";
import { validateTemplates } from "../src/templates.ts";
import { compareLines, mergedText } from "../src/diff.ts";
import { SyncEngine, type NoteStore } from "../src/sync.ts";
import { readLastSync, readSettings, readSyncRecords } from "../src/sync-state.ts";

function fixture() {
  const snapshot: Snapshot = {
    book: { id: 1, assetId: "sync-test", title: "示例书", author: "作者", status: "reading", progress: 0.4, annotationCount: 1, noteCount: 0 },
    annotations: [{ id: 1, uuid: "highlight", type: "highlight", style: 0, isUnderline: false, selectedText: "来源摘录", chapterOrder: 0 }], chaptersAvailable: false,
  };
  const files = new Map<string, string>();
  let reads = 0, writes = 0;
  let beforeProcess: ((content: string) => string) | undefined;
  const notes: NoteStore = {
    async list() { return [...files.keys()]; },
    async read(path) { const value = files.get(path); if (value === undefined) throw new Error("missing"); return value; },
    async create(path, content) { if (files.has(path)) throw new Error("collision"); files.set(path, content); writes++; },
    async process(path, transform) { const content = files.get(path)!; const latest = beforeProcess?.(content) ?? content; files.set(path, latest); files.set(path, transform(latest)); writes++; },
  };
  const library: Library = {
    async syncIndex() { return [{ book: structuredClone(snapshot.book), revision: digest(JSON.stringify(snapshot)) }]; },
    async call<T>() { reads++; return structuredClone(snapshot) as T; },
  };
  return { snapshot, files, notes, library, engine: new SyncEngine(library, notes), get reads() { return reads; }, get writes() { return writes; }, race(callback: (content: string) => string) { beforeProcess = callback; } };
}

test("incremental sync skips unchanged snapshots, persists cache, and detects source/local changes", async () => {
  const f = fixture();
  const first = await f.engine.sync("Books"); const path = first.paths[0]!;
  assert.equal(f.reads, 1);
  const records = readSyncRecords({ syncRecords: [...f.engine.records] });
  const restarted = new SyncEngine(f.library, f.notes, records);
  assert.equal((await restarted.sync("Books", undefined, undefined, DEFAULT_DOCUMENT_OPTIONS, true)).skipped, 1);
  assert.equal(f.reads, 1); assert.equal(f.writes, 1);
  f.snapshot.annotations[0]!.selectedText = "新的来源";
  assert.equal((await restarted.sync("Books", undefined, undefined, DEFAULT_DOCUMENT_OPTIONS, true)).updated, 1);
  f.files.set(path, f.files.get(path)!.replace("新的来源", "本地改动"));
  const conflict = await restarted.sync("Books", undefined, undefined, DEFAULT_DOCUMENT_OPTIONS, true);
  assert.equal(conflict.failures[0]?.canResolve, true); assert.match(f.files.get(path)!, /本地改动/);
});

test("incremental sync detects moves, deleted notes, duplicate identities and template changes", async () => {
  const f = fixture(); const first = await f.engine.sync("Books"); const path = first.paths[0]!;
  f.files.set("Renamed.md", f.files.get(path)!); f.files.delete(path);
  assert.deepEqual((await f.engine.sync("Books", undefined, undefined, DEFAULT_DOCUMENT_OPTIONS, true)).paths, ["Renamed.md"]);
  assert.equal(f.reads, 1);
  f.files.set("Duplicate.md", f.files.get("Renamed.md")!);
  assert.equal((await f.engine.sync("Books", undefined, undefined, DEFAULT_DOCUMENT_OPTIONS, true)).failures.length, 1);
  f.files.delete("Duplicate.md"); f.files.delete("Renamed.md");
  assert.equal((await f.engine.sync("Books", undefined, undefined, DEFAULT_DOCUMENT_OPTIONS, true)).created, 1);
  const options = { ...DEFAULT_DOCUMENT_OPTIONS, bodyTemplate: "# {{title}}\n\n{{annotations}}" };
  assert.equal((await f.engine.sync("Books", undefined, undefined, options, true)).updated, 1);
  assert.equal((await f.engine.sync("Books")).skipped, 0); // manual sync always rechecks chapters
});

test("templates validate required variables, sanitize paths, and keep source text inert", () => {
  const f = fixture();
  const options = { ...DEFAULT_DOCUMENT_OPTIONS, fileNameTemplate: "{{author}}/{{title}}", bodyTemplate: "# {{title}}\n\n进度：{{progress}}\n\n{{annotations}}" };
  f.snapshot.book.author = "../../evil"; f.snapshot.book.title = '<img src="remote">';
  const path = notePath("Books", f.snapshot, options);
  assert.match(path, /^Books\/[^/]+\/[^/]+ — [a-f0-9]{20}\.md$/);
  const content = createDocument(f.snapshot, options);
  assert.match(content, /40%/); assert.doesNotMatch(content, /# <img/);
  for (const bodyTemplate of ["no excerpts", "{{annotations}}{{annotations}}", "{{unknown}}{{annotations}}", "{{annotations}}<!-- apple-books:end -->"]) assert.throws(() => validateTemplates({ ...options, bodyTemplate }));
  for (const fileNameTemplate of ["../out", "/root", "{{missing}}", "a//b", ".obsidian/test"]) assert.throws(() => validateTemplates({ ...options, fileNameTemplate }));
});

test("owned book properties update while arbitrary user YAML and reflections remain byte-identical", () => {
  const f = fixture();
  let content = createDocument(f.snapshot).replace("tags:\n", 'custom: {keep: true} # my comment\ntags:\n') + "心得保留\n";
  f.snapshot.book.progress = 0.75;
  content = updateDocument(content, f.snapshot);
  assert.match(content, /apple_books_progress: 75/); assert.match(content, /custom: \{keep: true\} # my comment/); assert.ok(content.endsWith("心得保留\n"));
  assert.equal(updateDocument(content.replace(/\n/g, "\r\n"), f.snapshot), content.replace(/\n/g, "\r\n"));
  assert.throws(() => updateDocument(content.replace("apple_books_progress: 75", "apple_books_progress: 99"), f.snapshot), /手动修改/);
  const legacy = createDocument(f.snapshot, { ...DEFAULT_DOCUMENT_OPTIONS, includeBookProperties: false });
  assert.match(updateDocument(legacy, f.snapshot), /apple_books_progress: 75/);
  assert.throws(() => updateDocument(legacy.replace("tags:", "apple_books_progress: 99\ntags:"), f.snapshot), /同名书籍属性/);
  assert.equal(updateDocument(content, f.snapshot, { ...DEFAULT_DOCUMENT_OPTIONS, includeBookProperties: false }), content);
});

test("retaining local conflict choices is idempotent and future source changes ask again", async () => {
  const f = fixture(); const first = await f.engine.sync("Books"); const path = first.paths[0]!;
  f.files.set(path, f.files.get(path)!.replace("来源摘录", "保留的本地摘录"));
  const failure = (await f.engine.sync("Books")).failures[0]!;
  const review = await f.engine.review(failure, DEFAULT_DOCUMENT_OPTIONS);
  await f.engine.resolve(review, review.localBody, review.sourceProperties, DEFAULT_DOCUMENT_OPTIONS);
  const resolved = f.files.get(path)!;
  assert.equal((await f.engine.sync("Books")).unchanged, 1); assert.equal(f.files.get(path), resolved);
  f.snapshot.annotations[0]!.selectedText = "再一次来源更新";
  const next = (await f.engine.sync("Books")).failures[0]!;
  assert.match(next.message, /重新对比/);
  const source = await f.engine.review(next, DEFAULT_DOCUMENT_OPTIONS);
  await f.engine.resolve(source, source.sourceBody, source.sourceProperties, DEFAULT_DOCUMENT_OPTIONS);
  assert.match(f.files.get(path)!, /再一次来源更新/); assert.doesNotMatch(f.files.get(path)!, /local-source/);
  assert.equal((await f.engine.sync("Books")).unchanged, 1);
});

test("conflict resolution refuses concurrent note edits, changed source, changed templates and duplicates", async () => {
  for (const race of ["local", "source", "template", "duplicate"]) {
    const f = fixture(); const first = await f.engine.sync("Books"); const path = first.paths[0]!;
    f.files.set(path, f.files.get(path)!.replace("来源摘录", "本地"));
    const failure = (await f.engine.sync("Books")).failures[0]!;
    const review = await f.engine.review(failure, DEFAULT_DOCUMENT_OPTIONS);
    const options = { ...DEFAULT_DOCUMENT_OPTIONS };
    if (race === "local") f.race(current => current + "刚写的心得\n");
    if (race === "source") f.snapshot.annotations[0]!.selectedText = "并发更新";
    if (race === "template") options.bodyTemplate = "{{annotations}}";
    if (race === "duplicate") f.files.set("copy.md", f.files.get(path)!);
    await assert.rejects(f.engine.resolve(review, review.sourceBody, review.sourceProperties, options), /修改|变化|副本/);
    assert.match(f.files.get(path)!, /本地/); if (race === "local") assert.match(f.files.get(path)!, /刚写的心得/);
  }
});

test("properties can retain local selections without being overwritten on the next sync", () => {
  const f = fixture(); const content = createDocument(f.snapshot).replace("apple_books_author: \"作者\"", "apple_books_author: \"本地作者\"");
  const review = compareDocument(content, f.snapshot, DEFAULT_DOCUMENT_OPTIONS);
  const resolved = resolveDocument(content, f.snapshot, DEFAULT_DOCUMENT_OPTIONS, review.sourceBody, review.localProperties);
  assert.equal(updateDocument(resolved, f.snapshot), resolved);
  f.snapshot.book.progress = 0.5;
  assert.throws(() => updateDocument(resolved, f.snapshot), /重新对比/);
});

test("line comparisons reconstruct both versions and allow individual choices", () => {
  const local = "共同\n本地修改\n分隔\n仅本地\n结尾\n", source = "共同\n来源修改\n分隔\n来源增加\n结尾\n";
  const differences = compareLines(local, source);
  assert.equal(mergedText(differences), local);
  const changes = differences.filter(item => item.changed); assert.equal(changes.length, 2);
  changes[0]!.choice = "source";
  assert.match(mergedText(differences), /来源修改/); assert.match(mergedText(differences), /仅本地/);
  for (const item of differences) item.choice = "source";
  assert.equal(mergedText(differences), source);
  for (const [a, b] of [["", "added\n"], ["removed\n", ""], ["same", "same"], ["tail", "tail\n"], ["a\n".repeat(1100), "b\n".repeat(1100)]]) {
    const diff = compareLines(a!, b!); assert.equal(mergedText(diff), a); for (const item of diff) item.choice = "source"; assert.equal(mergedText(diff), b);
  }
});

test("persisted settings and sync status validate malformed values", () => {
  assert.equal(readSettings({ autoSync: "yes", syncIntervalMinutes: -5 }).autoSync, false);
  assert.equal(readSettings({ syncIntervalMinutes: 0 }).syncIntervalMinutes, 5);
  assert.deepEqual(readSettings(undefined), DEFAULT_SETTINGS);
  assert.equal(readSyncRecords({ syncRecords: [["bad", { revision: "x" }]] }).size, 0);
  assert.equal(readLastSync({ lastSync: { finishedAt: "bad" } }), undefined);
  assert.equal(readLastSync({ lastSync: { finishedAt: new Date().toISOString(), result: { failures: null } } }), undefined);
});
