import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import initSqlJs from "sql.js/dist/sql-asm.js";
import { AppleBooksLibrary, LibraryError } from "../src/apple-books-library.ts";
import { readSnapshot, mergeCommittedWal } from "../src/sqlite-snapshot.ts";
import { DEFAULT_SETTINGS, type Book, type Page, type Snapshot, type Summary, type Review, type YearReport } from "../src/models.ts";

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "apple-books-direct-test-"));
  const settings = { ...DEFAULT_SETTINGS, libraryDB: join(directory, "library.sqlite"), annotationDB: join(directory, "annotations.sqlite") };
  for (const [name, path] of [["library", settings.libraryDB], ["annotations", settings.annotationDB]] as const) {
    const database = new DatabaseSync(path);
    database.exec(await readFile(new URL(`./fixtures/${name}.sql`, import.meta.url), "utf8"));
    database.close();
  }
  const client = new AppleBooksLibrary(() => settings);
  return { directory, settings, client, async close() { client.dispose(); await rm(directory, { recursive: true, force: true }); } };
}

test("direct SQLite queries preserve library, search, review, reports and source files", async () => {
  const f = await fixture();
  try {
    const before = await Promise.all([readFile(f.settings.libraryDB), readFile(f.settings.annotationDB)]);
    const [summary, books, snapshot, report, wanted, search] = await Promise.all([
      f.client.call<Summary>("summary"), f.client.call<Page<Book>>("books"), f.client.call<Snapshot>("book", { id: 1 }),
      f.client.call<YearReport>("report", { year: 2026 }), f.client.call<Page<Book>>("wantToRead"), f.client.call<Page<Review>>("search", { search: "问题" }),
    ]);
    assert.equal(summary.totalBooks, 3); assert.equal(summary.annotationCount, 3); assert.equal(summary.readingTimeAvailable, false);
    assert.equal(books.total, 3); assert.equal(snapshot.annotations.length, 2); assert.equal(snapshot.book.annotationCount, 2);
    assert.equal(report.annotationCount, 3); assert.equal(report.finishedBooks, 1); assert.equal(report.activeDays, 2);
    assert.equal(wanted.items[0]?.id, 3); assert.equal(search.total, 2);
    assert.equal((await f.client.call<Page<Book>>("books", { status: "reading", search: "林间", limit: 1 })).total, 1);
    assert.deepEqual(await f.client.call("review", { key: "repeatable", notesOnly: true }), await f.client.call("review", { key: "repeatable", notesOnly: true }));
    await assert.rejects(f.client.call("book", { id: 999 }), (error: unknown) => error instanceof LibraryError && error.code === "not_found");
    assert.deepEqual(await Promise.all([readFile(f.settings.libraryDB), readFile(f.settings.annotationDB)]), before);
    assert.deepEqual((await readdir(f.directory)).sort(), ["annotations.sqlite", "library.sqlite"]);
  } finally { await f.close(); }
});

test("live WAL includes committed updates, excludes uncommitted writes, refreshes cache without resetting", async () => {
  const f = await fixture();
  const writer = new DatabaseSync(f.settings.annotationDB);
  try {
    writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE ZAEANNOTATION SET ZANNOTATIONNOTE='committed' WHERE Z_PK=1");
    let snapshot = await f.client.call<Snapshot>("book", { id: 1 });
    assert.equal(snapshot.annotations.find(item => item.id === 1)?.note, "committed");
    writer.exec("BEGIN IMMEDIATE; UPDATE ZAEANNOTATION SET ZANNOTATIONNOTE='uncommitted' WHERE Z_PK=1");
    f.client.reset();
    snapshot = await f.client.call<Snapshot>("book", { id: 1 });
    assert.equal(snapshot.annotations.find(item => item.id === 1)?.note, "committed");
    writer.exec("COMMIT");
    snapshot = await f.client.call<Snapshot>("book", { id: 1 });
    assert.equal(snapshot.annotations.find(item => item.id === 1)?.note, "uncommitted");
    writer.exec("UPDATE ZAEANNOTATION SET ZANNOTATIONDELETED=1 WHERE Z_PK=1");
    assert.equal((await f.client.call<Snapshot>("book", { id: 1 })).annotations.length, 1);
    writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    f.client.reset();
    assert.equal((await f.client.call<Snapshot>("book", { id: 1 })).annotations.length, 1);
  } finally { writer.close(); await f.close(); }
});

test("WAL replay handles snapshots without shm, repeated page writes, truncation and corruption", async () => {
  const f = await fixture();
  const writer = new DatabaseSync(f.settings.annotationDB);
  const SQL = await initSqlJs();
  try {
    writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE ZAEANNOTATION SET ZANNOTATIONNOTE='first' WHERE Z_PK=1; UPDATE ZAEANNOTATION SET ZANNOTATIONNOTE='second' WHERE Z_PK=1");
    const db = await readFile(f.settings.annotationDB), wal = await readFile(`${f.settings.annotationDB}-wal`);
    const snapshot = new SQL.Database(mergeCommittedWal(db, wal));
    try { assert.equal(snapshot.exec("SELECT ZANNOTATIONNOTE FROM ZAEANNOTATION WHERE Z_PK=1")[0]?.values[0]?.[0], "second"); } finally { snapshot.close(); }
    const corrupted = Buffer.from(wal); corrupted[60] = corrupted[60]! ^ 1;
    assert.throws(() => mergeCommittedWal(db, corrupted), /校验失败/);
    assert.throws(() => mergeCommittedWal(db, wal.subarray(0, 20)), /正在变化/);
    assert.throws(() => mergeCommittedWal(db, wal, Buffer.alloc(136)), /正在变化/);
    const native = new DatabaseSync(f.settings.annotationDB, { readOnly: true });
    const nativeCount = native.prepare("SELECT COUNT(*) AS count FROM ZAEANNOTATION").get()?.count; native.close();
    const complete = new SQL.Database(await readSnapshot(f.settings.annotationDB));
    try { assert.equal(complete.exec("SELECT COUNT(*) FROM ZAEANNOTATION")[0]?.values[0]?.[0], nativeCount); } finally { complete.close(); }
  } finally { writer.close(); await f.close(); }
});

test("recovered WAL with attempted backfill remains readable and leaves source files unchanged", async () => {
  const f = await fixture();
  const writer = new DatabaseSync(f.settings.annotationDB);
  const recoveredPath = join(f.directory, "recovered.sqlite");
  let reader: DatabaseSync | undefined;
  const SQL = await initSqlJs();
  try {
    writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE ZAEANNOTATION SET ZANNOTATIONNOTE='recovered commit' WHERE Z_PK=1");
    // A missing shm forces SQLite to rebuild its index from the committed WAL,
    // just as after recovery. No checkpoint or writer remains active here.
    await writeFile(recoveredPath, await readFile(f.settings.annotationDB));
    await writeFile(`${recoveredPath}-wal`, await readFile(`${f.settings.annotationDB}-wal`));
    reader = new DatabaseSync(recoveredPath, { readOnly: true });
    const expected = reader.prepare("SELECT ZANNOTATIONNOTE FROM ZAEANNOTATION WHERE Z_PK=1").get()?.ZANNOTATIONNOTE;
    assert.equal(expected, "recovered commit");
    const files = [recoveredPath, `${recoveredPath}-wal`, `${recoveredPath}-shm`];
    const before = await Promise.all(files.map(file => readFile(file)));
    const shm = before[2]!;
    assert.equal(shm.readUInt32LE(96), 0);
    assert.ok(shm.readUInt32LE(128) > 0);
    assert.equal(shm.readUInt32LE(128), shm.readUInt32LE(16));
    const snapshot = new SQL.Database(await readSnapshot(recoveredPath));
    try {
      assert.equal(snapshot.exec("PRAGMA quick_check")[0]?.values[0]?.[0], "ok");
      assert.equal(snapshot.exec("SELECT ZANNOTATIONNOTE FROM ZAEANNOTATION WHERE Z_PK=1")[0]?.values[0]?.[0], expected);
    } finally { snapshot.close(); }
    assert.deepEqual(await Promise.all(files.map(file => readFile(file))), before);
  } finally { reader?.close(); writer.close(); await f.close(); }
});

test("WAL checkpoint progress cannot exceed the published commit boundary", async () => {
  const f = await fixture();
  const writer = new DatabaseSync(f.settings.annotationDB);
  try {
    writer.exec("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; UPDATE ZAEANNOTATION SET ZANNOTATIONNOTE='committed' WHERE Z_PK=1");
    const [db, wal, shm] = await Promise.all([f.settings.annotationDB, `${f.settings.annotationDB}-wal`, `${f.settings.annotationDB}-shm`].map(file => readFile(file)));
    const publishedFrames = shm!.readUInt32LE(16);
    assert.ok(publishedFrames > 0);
    for (const offset of [96, 128]) {
      const invalid = Buffer.from(shm!);
      invalid.writeUInt32LE(publishedFrames + 1, offset);
      assert.throws(() => mergeCommittedWal(db!, wal!, invalid), /正在变化/);
    }
    const wrongSalt = Buffer.from(wal!);
    wrongSalt[16] = wrongSalt[16]! ^ 1;
    assert.throws(() => mergeCommittedWal(db!, wrongSalt, shm!), /校验失败|正在变化/);
  } finally { writer.close(); await f.close(); }
});

test("bad schema, journal and missing files fail instead of returning an empty library", async () => {
  const f = await fixture();
  try {
    await writeFile(`${f.settings.libraryDB}-journal`, Buffer.from("active journal"));
    await assert.rejects(f.client.call("summary"), /回滚日志/);
    await rm(`${f.settings.libraryDB}-journal`);
    const writer = new DatabaseSync(f.settings.libraryDB); writer.exec("DROP TABLE ZBKCOLLECTION"); writer.close();
    await assert.rejects(f.client.call("summary"), /no such table/);
    await rm(f.settings.libraryDB);
    await assert.rejects(f.client.call("summary"), /ENOENT/);
  } finally { await f.close(); }
});

test("invalid parameters and unload reject pending queries", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.client.call("books", { limit: -1 }), /无效/);
    await assert.rejects(f.client.call("anything"), /未知/);
    const pending = f.client.call("summary");
    f.client.dispose();
    await assert.rejects(pending, /关闭/);
    await assert.rejects(f.client.call("summary"), /关闭/);
  } finally { await f.close(); }
});

test("reading history database supplies totals and an unsupported version degrades only duration", async () => {
  const { historyFixture } = await import("./fixtures/history.ts");
  const f = await fixture();
  f.settings.readingHistoryDB = join(f.directory, "history.sqlite");
  const history = new DatabaseSync(f.settings.readingHistoryDB);
  history.exec("CREATE TABLE ZCRDTMODELSYNCENTITY (ZTYPE TEXT, ZDELETEDFLAG INTEGER, ZMODIFICATIONDATE REAL, ZPROTODATA BLOB)");
  history.prepare("INSERT INTO ZCRDTMODELSYNCENTITY VALUES ('ReadingHistoryModel', 0, 1, ?)").run(historyFixture());
  try {
    assert.equal((await f.client.call<Summary>("summary")).readingSeconds, 3720);
    assert.equal((await f.client.call<YearReport>("report", { year: 2026 })).months[0]?.readingSeconds, 3720);
    history.prepare("UPDATE ZCRDTMODELSYNCENTITY SET ZPROTODATA=?").run(Buffer.from("crdt\x06\0\0\0"));
    const summary = await f.client.call<Summary>("summary");
    assert.equal(summary.readingTimeAvailable, false); assert.equal(summary.totalBooks, 3); assert.match(summary.readingTimeError!, /版本 4/);
  } finally { history.close(); await f.close(); }
});

test("real SQLite provider syncs idempotently and updates deleted source highlights", async () => {
  const { SyncEngine } = await import("../src/sync.ts");
  const f = await fixture();
  const files = new Map<string, string>();
  const sync = new SyncEngine(f.client, {
    async list() { return [...files.keys()]; }, async read(path) { return files.get(path)!; },
    async create(path, content) { if (files.has(path)) throw new Error("exists"); files.set(path, content); },
    async process(path, transform) { files.set(path, transform(files.get(path)!)); },
  });
  try {
    assert.equal((await sync.sync("Books")).created, 2);
    const before = [...files];
    assert.equal((await sync.sync("Books")).unchanged, 2); assert.deepEqual([...files], before);
    const writer = new DatabaseSync(f.settings.annotationDB); writer.exec("UPDATE ZAEANNOTATION SET ZANNOTATIONDELETED=1 WHERE ZANNOTATIONASSETID='fixture-book-one'"); writer.close();
    const result = await sync.sync("Books");
    assert.equal(result.updated, 1); assert.equal(result.unchanged, 1); assert.equal(files.size, 2);
  } finally { await f.close(); }
});
