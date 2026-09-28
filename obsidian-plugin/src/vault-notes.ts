import { TFile, TFolder, type Vault } from "obsidian";
import type { NoteStore } from "./sync";

export class VaultNotes implements NoteStore {
  constructor(private vault: Vault) {}
  async list(): Promise<string[]> { return this.vault.getMarkdownFiles().map(file => file.path); }
  async read(path: string): Promise<string> { return this.vault.read(this.file(path)); }
  async process(path: string, transform: (current: string) => string): Promise<void> {
    await this.vault.process(this.file(path), transform);
  }
  async create(path: string, content: string): Promise<void> {
    const parts = path.split("/").slice(0, -1);
    let directory = "";
    for (const part of parts) {
      directory = directory ? `${directory}/${part}` : part;
      const existing = this.vault.getAbstractFileByPath(directory);
      if (!existing) {
        try { await this.vault.createFolder(directory); }
        catch (error) { if (!(this.vault.getAbstractFileByPath(directory) instanceof TFolder)) throw error; }
      } else if (!(existing instanceof TFolder)) throw new Error(`同步目录被文件占用：${directory}`);
    }
    await this.vault.create(path, content);
  }
  private file(path: string): TFile {
    const file = this.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`笔记已移动或不存在：${path}。请重新同步。`);
    return file;
  }
}
