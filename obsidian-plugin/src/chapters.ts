import { readFile, realpath, stat } from "node:fs/promises";
import { join, posix, sep } from "node:path";
import { unzipSync } from "fflate";
import { DOMParser, type Element, type Document } from "@xmldom/xmldom";

interface Chapter { title: string; order: number }
export interface Chapters { lookup(location: string): Chapter | undefined }
const XML_LIMIT = 2 * 1024 * 1024;

function elements(node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS("*", name));
}
function resolveEntry(directory: string, href: string): string {
  const path = posix.normalize(posix.join(directory, decodeURIComponent(href.split("#")[0]!)));
  if (path === ".." || path.startsWith("../") || path.startsWith("/") || path.includes("\\")) throw new Error("EPUB 目录路径无效。");
  return path;
}
function xml(bytes: Uint8Array): Document {
  if (bytes.length > XML_LIMIT) throw new Error("EPUB 目录超过 2 MB。");
  return new DOMParser({ onError: level => { if (level !== "warning") throw new Error("EPUB XML 解析失败。"); } }).parseFromString(Buffer.from(bytes).toString("utf8"), "application/xml");
}

export async function readChapters(source: string): Promise<Chapters> {
  const info = await stat(source);
  let read: (entry: string) => Promise<Uint8Array>;
  if (info.isDirectory()) {
    const root = await realpath(source);
    read = async entry => {
      const path = await realpath(join(root, resolveEntry(".", entry)));
      if (!path.startsWith(root + sep) || (await stat(path)).size > XML_LIMIT) throw new Error("EPUB 目录文件不在有效范围内。");
      return readFile(path);
    };
  } else {
    if (info.size > 128 * 1024 * 1024) throw new Error("EPUB 超过章节解析上限（128 MB）。");
    let total = 0;
    const files = unzipSync(await readFile(source), { filter: entry => {
      if (!/\.(xml|opf|ncx|xhtml|html)$/i.test(entry.name)) return false;
      total += entry.originalSize;
      if (entry.originalSize > XML_LIMIT || total > 16 * 1024 * 1024) throw new Error("EPUB 目录解压大小超过上限。");
      return true;
    } });
    read = async entry => { const bytes = files[resolveEntry(".", entry)]; if (!bytes) throw new Error("EPUB 目录文件缺失。"); return bytes; };
  }
  const container = xml(await read("META-INF/container.xml"));
  const packagePath = elements(container, "rootfile")[0]?.getAttribute("full-path");
  if (!packagePath) throw new Error("EPUB package 路径缺失。");
  const publication = xml(await read(packagePath));
  const items = elements(publication, "item");
  const tocID = elements(publication, "spine")[0]?.getAttribute("toc");
  const navigation = items.find(item => (item.getAttribute("properties") ?? "").split(/\s+/).includes("nav"))
    ?? items.find(item => item.getAttribute("id") === tocID || item.getAttribute("media-type") === "application/x-dtbncx+xml");
  const href = navigation?.getAttribute("href");
  if (!href) throw new Error("EPUB 目录缺失。");
  const navigationPath = resolveEntry(posix.dirname(packagePath), href);
  const document = xml(await read(navigationPath));
  const titles = new Map<string, string>();
  const add = (href: string | null, title: string | null) => {
    if (!href || !title?.trim()) return;
    const path = resolveEntry(posix.dirname(navigationPath), href);
    if (!titles.has(path)) titles.set(path, title.replace(/\s+/g, " ").trim());
  };
  if ((navigation?.getAttribute("properties") ?? "").split(/\s+/).includes("nav")) {
    for (const nav of elements(document, "nav")) {
      if (!`${nav.getAttribute("epub:type")} ${nav.getAttribute("role")}`.includes("toc")) continue;
      for (const anchor of elements(nav, "a")) add(anchor.getAttribute("href"), anchor.textContent);
    }
  } else {
    for (const point of elements(document, "navPoint")) add(elements(point, "content")[0]?.getAttribute("src") ?? null, elements(point, "navLabel")[0]?.textContent ?? null);
  }
  const byID = new Map<string, Chapter>(), byOrder = new Map<number, Chapter>();
  let currentTitle = "";
  elements(publication, "itemref").forEach((reference, order) => {
    const id = reference.getAttribute("idref") ?? "";
    const item = items.find(item => item.getAttribute("id") === id);
    if (!item) return;
    currentTitle = titles.get(resolveEntry(posix.dirname(packagePath), item.getAttribute("href") ?? "")) ?? currentTitle;
    if (!currentTitle) return;
    const chapter = { title: currentTitle, order };
    byOrder.set(order, chapter); byID.set(id, chapter);
    const referenceID = reference.getAttribute("id");
    if (referenceID) byID.set(referenceID, chapter);
  });
  if (!byOrder.size) throw new Error("EPUB 章节无法映射。");
  return { lookup(location) {
    const match = /^epubcfi\(\/6\/(\d+)(?:\[([^\]]+)\])?/.exec(location);
    if (!match) return undefined;
    const step = Number(match[1]);
    return (match[2] ? byID.get(match[2]) : undefined) ?? (step >= 2 && step % 2 === 0 ? byOrder.get(step / 2 - 1) : undefined);
  } };
}
