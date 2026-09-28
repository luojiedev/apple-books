import { createHash } from "node:crypto";
import type { Annotation, Snapshot } from "./models";

const END = "<!-- apple-books:end -->";
const BEGIN = /^<!-- apple-books:begin ([A-Za-z0-9_-]+) ([a-f0-9]{64}) -->\r?\n/gm;

export class SyncConflict extends Error {}

export function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function token(assetID: string): string {
  return Buffer.from(assetID, "utf8").toString("base64url");
}

export function documentIdentity(content: string): string | undefined {
  const match = /^<!-- apple-books:begin ([A-Za-z0-9_-]+) /m.exec(content);
  if (match?.[1]) return Buffer.from(match[1], "base64url").toString("utf8");
  // The property still identifies a note if its managed markers were removed.
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content)?.[1];
  const value = frontmatter?.match(/^apple_books_asset_id: ("(?:[^"\\]|\\.)*")\r?$/m)?.[1];
  if (!value) return undefined;
  try { return JSON.parse(value) as string; } catch { return undefined; }
}

export function validateFolder(folder: string): string {
  const value = folder.trim().replace(/\/+$/, "");
  if (!value || value.startsWith("/") || value.includes("\\") || value.split("/").some(part => !part || part.startsWith(".") || /[\x00-\x1f:*?"<>|]/.test(part))) {
    throw new Error("同步文件夹必须是仓库内的普通文件夹，例如 Apple Books；不能使用隐藏目录或 ..。");
  }
  return value;
}

export function notePath(folder: string, snapshot: Snapshot): string {
  const title = snapshot.book.title.replace(/[\x00-\x1f\\/:*?"<>|#\[\]^]/g, "-").replace(/^\.+|[. ]+$/g, "").trim();
  return `${validateFolder(folder)}/${Array.from(title || "未命名书籍").slice(0, 60).join("")} — ${digest(snapshot.book.assetId).slice(0, 20)}.md`;
}

function literal(text: string): string {
  // Apple Books content is untrusted text: prevent HTML, embeds, links and
  // Markdown structure from turning an imported quotation into active content.
  return text.replace(/\r\n/g, "\n").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]()#!|~$^]/g, "\\$&");
}

function inline(text: string): string { return literal(text.replace(/\s+/g, " ").trim()); }
function quote(text: string): string { return literal(text.trim()).split("\n").map(line => `> ${line}`).join("\n"); }

function annotationOrder(left: Annotation, right: Annotation): number {
  const chapter = (left.chapter ? left.chapterOrder : Number.MAX_SAFE_INTEGER) - (right.chapter ? right.chapterOrder : Number.MAX_SAFE_INTEGER);
  return chapter || (left.location ?? "").localeCompare(right.location ?? "", "en", { numeric: true }) || left.uuid.localeCompare(right.uuid, "en");
}

export function renderBody(snapshot: Snapshot): string {
  if (!snapshot.book.assetId) throw new SyncConflict("书籍缺少 assetId，无法安全同步。");
  const annotations = snapshot.annotations.filter(item => item.selectedText?.trim() || item.note?.trim()).sort(annotationOrder);
  const seen = new Set<string>();
  const body = [
    `# ${inline(snapshot.book.title || "未命名书籍")}`, "",
    `作者：${inline(snapshot.book.author || "未知作者")}`,
    `阅读状态：${snapshot.book.status === "finished" ? "已读完" : snapshot.book.status === "reading" ? "阅读中" : "未开始"}`,
    `高亮与笔记：${annotations.length} 条`, "",
  ];
  if (!snapshot.chaptersAvailable) body.push("章节信息不可用；保留摘录与原始位置。", "");
  let previousChapter = "";
  for (const annotation of annotations) {
    if (!annotation.uuid || seen.has(annotation.uuid)) throw new SyncConflict("批注 UUID 缺失或重复，已跳过本书以保护已有内容。");
    seen.add(annotation.uuid);
    const chapter = annotation.chapter || "未识别章节";
    if (chapter !== previousChapter) { body.push(`## ${inline(chapter)}`, ""); previousChapter = chapter; }
    if (annotation.selectedText?.trim()) body.push(quote(annotation.selectedText), "");
    if (annotation.note?.trim()) body.push("**Apple Books 笔记**", "", quote(annotation.note), "");
    if (!annotation.chapter && annotation.location) body.push(`位置：${inline(annotation.location)}`, "");
    // Stable block IDs survive changed text, ordering and repeated imports.
    body.push(`^ab-${digest(snapshot.book.assetId + "\0" + annotation.uuid).slice(0, 24)}`, "");
  }
  if (!annotations.length) body.push("本书目前没有已同步到本机的高亮或笔记。", "");
  return body.join("\n") + "\n";
}

function managedBlock(assetID: string, body: string): string {
  return `<!-- apple-books:begin ${token(assetID)} ${digest(body)} -->\n${body}${END}`;
}

export function createDocument(snapshot: Snapshot): string {
  return [
    "---", `apple_books_asset_id: ${JSON.stringify(snapshot.book.assetId)}`, "tags:", "  - apple-books", "---", "",
    "> 下方标记内的摘录由插件维护。请将个人内容写在「我的读书心得」或标记外；修改标记内内容会暂停本书更新。", "",
    managedBlock(snapshot.book.assetId, renderBody(snapshot)), "", "## 我的读书心得", "", "",
  ].join("\n");
}

export function updateDocument(current: string, snapshot: Snapshot): string {
  const matches = [...current.matchAll(BEGIN)];
  const match = matches[0];
  if (matches.length !== 1 || !match || match[1] !== token(snapshot.book.assetId)) {
    throw new SyncConflict("同步标记缺失、重复或书籍标识不匹配；保留原文件，请检查标记。");
  }
  const bodyStart = match.index + match[0].length;
  const end = current.indexOf(END, bodyStart);
  if (end < 0 || current.indexOf(END, end + END.length) >= 0) throw new SyncConflict("同步结束标记缺失或重复；保留原文件。");
  const existingBody = current.slice(bodyStart, end).replace(/\r\n/g, "\n");
  if (digest(existingBody) !== match[2]) throw new SyncConflict("自动生成区域有手动修改；已保留原文，请先将改动移到标记外，再恢复该区域后重试。");
  const body = renderBody(snapshot);
  if (existingBody === body) return current;
  const block = managedBlock(snapshot.book.assetId, body);
  const replacement = match[0].endsWith("\r\n") ? block.replace(/\n/g, "\r\n") : block;
  return current.slice(0, match.index) + replacement + current.slice(end + END.length);
}
