import { errorMessage } from "./models";

export function describeHistoryError(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "EPERM" || code === "EACCES") {
    return "macOS 拒绝读取阅读历史数据库或 WAL。请在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中允许 Obsidian，再用 ⌘Q 完全退出并重新打开。书库和批注可读取，不代表阅读历史目录也已获授权。";
  }
  if (code === "ENOENT") return "未找到阅读历史数据库。请先在本机 Apple Books 中完成同步；使用自定义路径时，请检查「阅读历史数据库」设置。";
  return errorMessage(error);
}

export function historyStatus(error?: string): string {
  return `阅读时长暂不可用：${error || "请在「设置与连接」中检测连接，查看阅读历史是否可读取。"}`;
}
