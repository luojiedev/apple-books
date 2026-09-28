import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { Settings } from "./models";

export interface DatabasePaths { library: string; annotations: string; history: string }

async function newest(directory: string): Promise<string> {
  const entries = await readdir(directory, { withFileTypes: true });
  const candidates = await Promise.all(entries.filter(entry => entry.isFile() && entry.name.endsWith(".sqlite")).map(async entry => {
    const path = join(directory, entry.name);
    return { path, modified: (await stat(path)).mtimeMs };
  }));
  candidates.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
  if (!candidates[0]) throw new Error("未找到 Apple Books 数据库，请先在本机打开 Apple Books 并完成同步。");
  return candidates[0].path;
}

export async function resolveDatabasePaths(settings: Settings): Promise<DatabasePaths> {
  if (!!settings.libraryDB !== !!settings.annotationDB) throw new Error("自定义数据库时，请同时填写书库和批注数据库路径。");
  for (const path of [settings.libraryDB, settings.annotationDB, settings.readingHistoryDB]) {
    if (path && !isAbsolute(path)) throw new Error("数据库路径必须是绝对路径。");
  }
  if (settings.libraryDB) return { library: settings.libraryDB, annotations: settings.annotationDB, history: settings.readingHistoryDB };
  if (process.platform !== "darwin") throw new Error("读取 Apple Books 需要 macOS。");
  const documents = join(homedir(), "Library/Containers/com.apple.iBooksX/Data/Documents");
  const [library, annotations] = await Promise.all([newest(join(documents, "BKLibrary")), newest(join(documents, "AEAnnotation"))]);
  return { library, annotations, history: settings.readingHistoryDB || join(homedir(), "Library/Group Containers/group.com.apple.iBooks/Documents/BCCloudData-BookDataStoreService/CRDTModelSync-ReadingHistoryModel/CRDTModelSync-ReadingHistoryModel") };
}
