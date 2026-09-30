import { test } from "node:test";
import assert from "node:assert/strict";
import { createDocument, digest, documentIdentity, notePath, renderBody, SyncConflict, updateDocument, validateFolder } from "../src/documents.ts";
import { SyncEngine, type NoteStore } from "../src/sync.ts";
import type { Library, Snapshot } from "../src/models.ts";

function snapshot(): Snapshot {
  return {
    book: { id: 1, assetId: "book-one", title: "一本书", author: "作者", status: "reading", progress: 0.4, annotationCount: 2, noteCount: 1 },
    chaptersAvailable: true,
    annotations: [
      { id: 1, uuid: "note-one", selectedText: "第一条", note: "我的想法", location: "epubcfi(/6/2!/4/2)", type: "highlight", style: 3, isUnderline: false, chapter: "第一章", chapterOrder: 0 },
      { id: 2, uuid: "note-two", selectedText: "第二条", location: "epubcfi(/6/2!/4/10)", type: "highlight", style: 3, isUnderline: false, chapter: "第一章", chapterOrder: 0 },
    ],
  };
}

class MemoryNotes implements NoteStore {
  files = new Map<string, string>();
  writes = 0;
  beforeProcess?: (current: string) => string;
  async list(): Promise<string[]> { return [...this.files.keys()]; }
  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error("missing");
    return value;
  }
  async create(path: string, content: string): Promise<void> {
    if (this.files.has(path)) throw new Error("file exists");
    this.files.set(path, content); this.writes++;
  }
  async process(path: string, transform: (current: string) => string): Promise<void> {
    const current = await this.read(path);
    this.files.set(path, transform(this.beforeProcess?.(current) ?? current)); this.writes++;
  }
}

function library(data: Snapshot, noBooks = false): Library {
  return { async call<T>(method: string): Promise<T> {
    if (method === "books") return { items: noBooks ? [] : [data.book], total: noBooks ? 0 : 1, limit: 100, offset: 0 } as T;
    return structuredClone(data) as T;
  } };
}

test("repeat sync is byte-identical, does not write, and preserves user reflections", async () => {
  const data = snapshot();
  const notes = new MemoryNotes();
  const engine = new SyncEngine(library(data), notes);
  const first = await engine.sync("Books");
  const path = first.paths[0]!;
  notes.files.set(path, (await notes.read(path)) + "我的长期想法\n");
  const before = await notes.read(path);
  const second = await engine.sync("Books");
  assert.equal(first.created, 1); assert.equal(second.unchanged, 1);
  assert.equal(notes.writes, 1); assert.equal(await notes.read(path), before);
});

test("changes and deletions update managed body and preserve the latest concurrent outside edits", async () => {
  const data = snapshot();
  const notes = new MemoryNotes();
  const engine = new SyncEngine(library(data), notes);
  const first = await engine.sync("Books");
  const path = first.paths[0]!;
  data.annotations[0]!.note = "更新后的笔记";
  data.annotations.pop();
  notes.beforeProcess = current => current.replace("tags:\n", "my_property: keep\ntags:\n") + "同步过程中新增的心得\n";
  const result = await engine.sync("Books");
  const content = await notes.read(path);
  assert.equal(result.updated, 1);
  assert.match(content, /更新后的笔记/); assert.doesNotMatch(content, /第二条/);
  assert.match(content, /my_property: keep/); assert.match(content, /同步过程中新增的心得/);
});

test("renamed and moved notes are updated in place even when the title changes", async () => {
  const data = snapshot(); const notes = new MemoryNotes(); const engine = new SyncEngine(library(data), notes);
  const first = await engine.sync("Books");
  const path = first.paths[0]!;
  notes.files.set("My notes/renamed.md", await notes.read(path)); notes.files.delete(path);
  data.book.title = "新书名";
  const result = await engine.sync("New Books");
  assert.equal(result.updated, 1); assert.equal(notes.files.size, 1);
  assert.deepEqual(result.paths, ["My notes/renamed.md"]);
});

test("same titles with different asset IDs create independent notes", () => {
  const first = snapshot(); const second = snapshot(); second.book.assetId = "another";
  assert.notEqual(notePath("Books", first), notePath("Books", second));
});

test("manual edits in the managed region are preserved and reported as conflicts", async () => {
  const data = snapshot(); const notes = new MemoryNotes(); const engine = new SyncEngine(library(data), notes);
  const first = await engine.sync("Books"); const path = first.paths[0]!;
  const changed = (await notes.read(path)).replace("第一条", "我修改了摘录");
  notes.files.set(path, changed);
  const result = await engine.sync("Books");
  assert.equal(result.failures.length, 1); assert.equal(await notes.read(path), changed); assert.equal(notes.writes, 1);
});

test("duplicate note identities, missing markers, and destination collisions never overwrite", async () => {
  const data = snapshot();
  for (const scenario of ["duplicate", "missing-markers", "collision"]) {
    const notes = new MemoryNotes(); const content = createDocument(data);
    if (scenario === "duplicate") { notes.files.set("a.md", content); notes.files.set("b.md", content); }
    if (scenario === "missing-markers") notes.files.set("a.md", content.replace(/<!-- apple-books:[^\n]+/g, ""));
    if (scenario === "collision") notes.files.set(notePath("Books", data), "User note");
    const before = [...notes.files];
    const result = await new SyncEngine(library(data), notes).sync("Books");
    assert.equal(result.failures.length, 1, scenario); assert.deepEqual([...notes.files], before); assert.equal(notes.writes, 0);
  }
});

test("all-sync skips never-annotated books but removes deleted annotations from previously synced notes", async () => {
  const data = snapshot(); const notes = new MemoryNotes();
  data.book.annotationCount = 0; data.annotations = [];
  const engine = new SyncEngine(library(data), notes);
  assert.equal((await engine.sync("Books")).created, 0);
  notes.files.set("old.md", createDocument(snapshot()));
  assert.equal((await engine.sync("Books")).updated, 1);
  assert.doesNotMatch(await notes.read("old.md"), /第一条/);
});

test("books missing from Apple Books do not delete notes", async () => {
  const notes = new MemoryNotes(); notes.files.set("old.md", createDocument(snapshot()));
  await new SyncEngine(library(snapshot(), true), notes).sync("Books");
  assert.equal(notes.files.size, 1); assert.equal(notes.writes, 0);
});

test("parallel sync is rejected and the engine recovers after a request failure", async () => {
  const notes = new MemoryNotes(); let release!: () => void;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const failing: Library = { async call<T>(): Promise<T> { await waiting; throw new Error("offline"); } };
  const engine = new SyncEngine(failing, notes);
  const first = engine.sync("Books");
  await assert.rejects(engine.sync("Books"), /正在进行/);
  release(); await assert.rejects(first, /offline/);
  await assert.rejects(engine.sync("Books"), /offline/);
});

test("excerpts omit block IDs while preserving separation, numeric CFI order and CRLF reimports", () => {
  const data = snapshot(); data.annotations.reverse();
  const content = createDocument(data);
  assert.ok(content.indexOf("第一条") < content.indexOf("第二条"));
  assert.doesNotMatch(content, /\^ab-/);
  assert.match(content, /> 我的想法\n\n---\n\n> 第二条/);
  data.annotations[1]!.selectedText = "改了正文";
  const updated = updateDocument(content, data);
  assert.doesNotMatch(updated, /\^ab-/);
  assert.match(updated, /> 改了正文/);
  assert.equal(updateDocument(updated.replace(/\n/g, "\r\n"), data), updated.replace(/\n/g, "\r\n"));
  assert.equal(documentIdentity(content), data.book.assetId);
});

test("sync replaces previously generated block IDs without changing personal reflections", () => {
  const data = snapshot();
  const current = createDocument(data) + "保留我的心得\n";
  const previousBody = renderBody(data).replace("---\n\n", "^ab-0123456789abcdef01234567\n\n");
  const previous = current.replace(/(<!-- apple-books:begin \S+ )([a-f0-9]{64})( -->\n)[\s\S]*?(?=<!-- apple-books:end -->)/,
    (_match, prefix: string, _hash: string, suffix: string) => prefix + digest(previousBody) + suffix + previousBody);
  assert.match(previous, /\^ab-/);
  const updated = updateDocument(previous, data);
  assert.equal(updated, current);
  assert.equal(updateDocument(updated, data), updated);
  assert.throws(() => updateDocument(previous.replace("第一条", "手写改动"), data), SyncConflict);
});

test("untrusted content stays text and cannot inject an embed, HTML or sync markers", () => {
  const data = snapshot();
  data.annotations[0]!.selectedText = '<img src="https://example.com"> ![[private]] ![x](https://example.com)\n<!-- apple-books:end -->';
  const content = createDocument(data);
  assert.doesNotMatch(content, /<img|!\[\[|!\[x\]/);
  assert.equal(content.split("<!-- apple-books:end -->").length, 2);
  assert.equal(updateDocument(content, data), content);
});

test("missing or duplicate annotation UUIDs refuse unsafe sync", () => {
  const data = snapshot(); data.annotations[1]!.uuid = data.annotations[0]!.uuid;
  assert.throws(() => renderBody(data), SyncConflict);
  data.annotations[1]!.uuid = ""; assert.throws(() => renderBody(data), SyncConflict);
});

test("output paths remain inside a normal vault folder", () => {
  for (const folder of ["", "/tmp", "../out", ".obsidian/plugins", "Books/../out", "Books\\outside", "Books//nested"]) assert.throws(() => validateFolder(folder));
  assert.equal(validateFolder("Reading/Apple Books/"), "Reading/Apple Books");
  const data = snapshot(); data.book.title = '../x:<img>\\path/书\n名';
  assert.match(notePath("Books", data), /^Books\/[^/\\<>:]+\.md$/);
});
