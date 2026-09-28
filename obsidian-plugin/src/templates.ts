import type { DocumentOptions, Snapshot } from "./models";

const BODY_FIELDS = ["title", "author", "status", "progress", "annotation_count", "finished_at", "annotations", "chapter_notice"];
const PATH_FIELDS = ["title", "author", "id"];

export function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{([a-z_]+)\}\}/g, (_, field: string) => values[field] ?? "");
}

function validateTokens(template: string, fields: string[]): void {
  const residue = template.replace(/\{\{([a-z_]+)\}\}/g, (_, field: string) => {
    if (!fields.includes(field)) throw new Error(`不支持的模板变量：{{${field}}}`);
    return "";
  });
  if (residue.includes("{{") || residue.includes("}}")) throw new Error("模板变量格式无效，请使用 {{变量名}}。");
}

export function validateTemplates(options: DocumentOptions): void {
  if (!options.bodyTemplate.trim() || options.bodyTemplate.length > 20000) throw new Error("正文模板不能为空，且不能超过 20000 字符。");
  validateTokens(options.bodyTemplate, BODY_FIELDS);
  if (options.bodyTemplate.split("{{annotations}}").length !== 2) throw new Error("正文模板必须包含且只包含一次 {{annotations}}。");
  if (/apple-books:/i.test(options.bodyTemplate)) throw new Error("模板不能包含插件的同步标记。");
  validateTokens(options.fileNameTemplate, PATH_FIELDS);
  if (!options.fileNameTemplate.trim() || options.fileNameTemplate.length > 300 || /[\x00-\x1f\\:*?"<>|]/.test(options.fileNameTemplate)) throw new Error("文件名模板无效或过长。");
  for (const segment of options.fileNameTemplate.split("/")) {
    if (!segment.trim() || segment.trim().startsWith(".")) throw new Error("文件名模板不能包含空目录、隐藏目录或 ..。");
  }
}

export function safeName(value: string): string {
  const cleaned = value.replace(/[\x00-\x1f\\/:*?"<>|#\[\]^]/g, "-").replace(/^\.+|[. ]+$/g, "").trim();
  return Array.from(cleaned || "未命名").slice(0, 80).join("");
}

export function bookProperties(snapshot: Snapshot): string {
  const book = snapshot.book;
  return Object.entries({
    apple_books_title: book.title,
    apple_books_author: book.author,
    apple_books_status: book.status,
    apple_books_progress: Math.round(Math.max(0, Math.min(1, book.progress)) * 100),
    apple_books_annotation_count: snapshot.annotations.length,
    apple_books_finished_at: book.finishedAt ?? null,
  }).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join("\n") + "\n";
}
