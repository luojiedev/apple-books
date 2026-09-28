import { createHash } from "node:crypto";
import { DEFAULT_DOCUMENT_OPTIONS, type Annotation, type DocumentOptions, type Snapshot } from "./models";
import { bookProperties, safeName, substitute, validateTemplates } from "./templates";

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

export function notePath(folder: string, snapshot: Snapshot, options = DEFAULT_DOCUMENT_OPTIONS): string {
  validateTemplates(options);
  const id = digest(snapshot.book.assetId).slice(0, 20);
  const template = options.fileNameTemplate;
  let path = substitute(template, { title: safeName(snapshot.book.title), author: safeName(snapshot.book.author || "未知作者"), id });
  path = path.split("/").map(safeName).join("/");
  if (!template.includes("{{id}}")) path += ` — ${id}`;
  return `${validateFolder(folder)}/${path}.md`;
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

export function renderBody(snapshot: Snapshot, options = DEFAULT_DOCUMENT_OPTIONS): string {
  validateTemplates(options);
  if (!snapshot.book.assetId) throw new SyncConflict("书籍缺少 assetId，无法安全同步。");
  const annotations = snapshot.annotations.filter(item => item.selectedText?.trim() || item.note?.trim()).sort(annotationOrder);
  const seen = new Set<string>();
  const body: string[] = [];
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
  return substitute(options.bodyTemplate.replace(/\r\n/g, "\n"), {
    title: inline(snapshot.book.title || "未命名书籍"), author: inline(snapshot.book.author || "未知作者"),
    status: snapshot.book.status === "finished" ? "已读完" : snapshot.book.status === "reading" ? "阅读中" : "未开始",
    progress: `${Math.round(snapshot.book.progress * 100)}%`, annotation_count: String(annotations.length),
    finished_at: inline(snapshot.book.finishedAt ?? ""),
    chapter_notice: snapshot.chaptersAvailable ? "" : "章节信息不可用；保留摘录与原始位置。\n\n",
    annotations: body.join("\n") + "\n",
  }).trimEnd() + "\n\n";
}

function managedBlock(assetID: string, body: string): string {
  return `<!-- apple-books:begin ${token(assetID)} ${digest(body)} -->\n${body}${END}`;
}

export function createDocument(snapshot: Snapshot, options = DEFAULT_DOCUMENT_OPTIONS): string {
  const content = [
    "---", `apple_books_asset_id: ${JSON.stringify(snapshot.book.assetId)}`, "tags:", "  - apple-books", "---", "",
    "> 下方标记内的摘录由插件维护。请将个人内容写在「我的读书心得」或标记外；修改标记内内容会暂停本书更新。", "",
    managedBlock(snapshot.book.assetId, renderBody(snapshot, options)), "", "## 我的读书心得", "", "",
  ].join("\n");
  return options.includeBookProperties ? replaceProperties(content, bookProperties(snapshot)) : content;
}

interface Region {
  start: number;
  end: number;
  raw: string;
  content: string;
  valid: boolean;
  sourceHash?: string;
  crlf: boolean;
}

function regionContent(raw: string, prefix: "<!--" | "#"): { content: string; sourceHash?: string } {
  const pattern = prefix === "<!--" ? /^<!-- apple-books:local-source ([a-f0-9]{64}) -->\n/ : /^# apple-books:local-source ([a-f0-9]{64})\n/;
  const match = pattern.exec(raw);
  return { content: match ? raw.slice(match[0].length) : raw, sourceHash: match?.[1] };
}

function bodyRegion(current: string, assetID: string): Region {
  const matches = [...current.matchAll(BEGIN)];
  const match = matches[0];
  if (matches.length !== 1 || !match || match[1] !== token(assetID)) {
    throw new SyncConflict("同步标记缺失、重复或书籍标识不匹配；保留原文件，请检查标记。");
  }
  const bodyStart = match.index + match[0].length;
  const end = current.indexOf(END, bodyStart);
  if (end < 0 || current.indexOf(END, end + END.length) >= 0) throw new SyncConflict("同步结束标记缺失或重复；保留原文件。");
  const existingBody = current.slice(bodyStart, end).replace(/\r\n/g, "\n");
  return { start: match.index, end: end + END.length, raw: existingBody, ...regionContent(existingBody, "<!--"), valid: digest(existingBody) === match[2], crlf: match[0].endsWith("\r\n") };
}

function acceptedContent(region: Region, source: string): string {
  if (!region.valid) throw new SyncConflict("自动生成区域有手动修改；已保留原文，请打开「对比并处理」选择保留内容。");
  if (region.sourceHash) {
    if (region.sourceHash !== digest(source)) throw new SyncConflict("Apple Books 内容已变化，与此前保留的本地内容需要重新对比。");
    return region.raw;
  }
  return source;
}

function replaceBody(current: string, assetID: string, body: string): string {
  const region = bodyRegion(current, assetID);
  if (region.valid && region.raw === body) return current;
  let block = managedBlock(assetID, body);
  if (region.crlf) block = block.replace(/\n/g, "\r\n");
  return current.slice(0, region.start) + block + current.slice(region.end);
}

const PROPERTY_END = "# apple-books:properties end";
function propertyRegion(current: string): Region | undefined {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(current);
  if (!frontmatter) return undefined;
  const matches = [...frontmatter[0].matchAll(/^# apple-books:properties begin ([a-f0-9]{64})\r?\n/gm)];
  const match = matches[0];
  const hasEnd = frontmatter[0].includes(PROPERTY_END);
  if (!match && !hasEnd) return undefined;
  if (matches.length !== 1 || !match) throw new SyncConflict("书籍属性标记缺失或重复，请先修复标记。");
  const start = match.index + match[0].length;
  const end = frontmatter[0].indexOf(PROPERTY_END, start);
  if (end < 0 || frontmatter[0].indexOf(PROPERTY_END, end + PROPERTY_END.length) >= 0) throw new SyncConflict("书籍属性结束标记缺失或重复。");
  const raw = current.slice(start, end).replace(/\r\n/g, "\n");
  return { start: match.index, end: end + PROPERTY_END.length, raw, ...regionContent(raw, "#"), valid: digest(raw) === match[1], crlf: match[0].endsWith("\r\n") };
}

function replaceProperties(current: string, properties: string): string {
  const region = propertyRegion(current);
  if (region?.valid && region.raw === properties) return current;
  let block = `# apple-books:properties begin ${digest(properties)}\n${properties}${PROPERTY_END}`;
  if (region) {
    if (region.crlf) block = block.replace(/\n/g, "\r\n");
    return current.slice(0, region.start) + block + current.slice(region.end);
  }
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(current);
  if (!frontmatter) return `---\n${block}\n---\n\n${current}`;
  if (/^["']?apple_books_(title|author|status|progress|annotation_count|finished_at)["']?:/m.test(frontmatter[1]!)) throw new SyncConflict("已有同名书籍属性，已保留原值；请重命名该属性或关闭同步书籍属性。");
  const start = current.startsWith("---\r\n") ? 5 : 4;
  const eol = start === 5 ? "\r\n" : "\n";
  if (start === 5) block = block.replace(/\n/g, eol);
  return current.slice(0, start) + block + eol + current.slice(start);
}

export function updateDocument(current: string, snapshot: Snapshot, options = DEFAULT_DOCUMENT_OPTIONS): string {
  const body = acceptedContent(bodyRegion(current, snapshot.book.assetId), renderBody(snapshot, options));
  let updated = replaceBody(current, snapshot.book.assetId, body);
  if (options.includeBookProperties) {
    const region = propertyRegion(current);
    const source = bookProperties(snapshot);
    updated = replaceProperties(updated, region ? acceptedContent(region, source) : source);
  }
  return updated;
}

export interface DocumentComparison { localBody: string; sourceBody: string; localProperties?: string; sourceProperties?: string }
export function compareDocument(current: string, snapshot: Snapshot, options: DocumentOptions): DocumentComparison {
  const comparison: DocumentComparison = { localBody: bodyRegion(current, snapshot.book.assetId).content, sourceBody: renderBody(snapshot, options) };
  if (options.includeBookProperties) {
    comparison.localProperties = propertyRegion(current)?.content ?? bookProperties(snapshot);
    comparison.sourceProperties = bookProperties(snapshot);
    // Validate a missing metadata region before offering a save action.
    if (!propertyRegion(current)) replaceProperties(current, comparison.sourceProperties);
  }
  return comparison;
}

export function resolveDocument(current: string, snapshot: Snapshot, options: DocumentOptions, chosenBody: string, chosenProperties?: string): string {
  const comparison = compareDocument(current, snapshot, options);
  if (/apple-books:/i.test(chosenBody) || (chosenProperties && /apple-books:/i.test(chosenProperties))) throw new SyncConflict("保留内容不能包含同步控制标记。");
  const body = chosenBody === comparison.sourceBody ? chosenBody : `<!-- apple-books:local-source ${digest(comparison.sourceBody)} -->\n${chosenBody}`;
  let updated = replaceBody(current, snapshot.book.assetId, body);
  if (comparison.sourceProperties !== undefined) {
    if (chosenProperties === undefined) throw new SyncConflict("尚未选择书籍属性的处理结果。");
    const properties = chosenProperties === comparison.sourceProperties ? chosenProperties : `# apple-books:local-source ${digest(comparison.sourceProperties)}\n${chosenProperties}`;
    updated = replaceProperties(updated, properties);
  }
  return updated;
}
