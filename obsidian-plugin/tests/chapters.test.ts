import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { readChapters } from "../src/chapters.ts";

const container = '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf"/></rootfiles></container>';
const publication = '<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="nav" href="nav.xhtml" properties="nav"/><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>';
const navigation = '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="toc"><a href="one.xhtml#start">第一章</a><a href="two.xhtml">第二章</a></nav></body></html>';

test("EPUB chapter lookup works for archives and extracted directories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "books-epub-"));
  try {
    const files = { "META-INF/container.xml": strToU8(container), "OPS/book.opf": strToU8(publication), "OPS/nav.xhtml": strToU8(navigation) };
    const archive = join(directory, "book.epub"); await writeFile(archive, zipSync(files));
    const extracted = join(directory, "extracted"); await mkdir(join(extracted, "META-INF"), { recursive: true }); await mkdir(join(extracted, "OPS"));
    for (const [name, value] of Object.entries(files)) await writeFile(join(extracted, name), value);
    for (const path of [archive, extracted]) {
      const chapters = await readChapters(path);
      assert.deepEqual(chapters.lookup("epubcfi(/6/2[one]!/4/2)"), { title: "第一章", order: 0 });
      assert.deepEqual(chapters.lookup("epubcfi(/6/4!/4/2)"), { title: "第二章", order: 1 });
      assert.equal(chapters.lookup("epubcfi(/6/3!/4)"), undefined);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("EPUB references cannot escape the book directory through traversal or symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "books-epub-path-"));
  try {
    const root = join(directory, "book"); await mkdir(join(root, "META-INF"), { recursive: true });
    await writeFile(join(directory, "outside.opf"), publication);
    await writeFile(join(root, "META-INF/container.xml"), container.replace("OPS/book.opf", "../outside.opf"));
    await assert.rejects(readChapters(root), /路径无效/);
    await writeFile(join(root, "META-INF/container.xml"), container.replace("OPS/book.opf", "linked.opf"));
    await symlink(join(directory, "outside.opf"), join(root, "linked.opf"));
    await assert.rejects(readChapters(root), /有效范围/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
