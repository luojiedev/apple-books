import { FileSystemAdapter, Modal, Notice, Plugin, TFile } from "obsidian";
import { AppleBooksLibrary } from "./apple-books-library";
import { DEFAULT_SETTINGS, errorMessage, reportError, type Book, type Settings } from "./models";
import { ArchiveSettingTab, SetupModal } from "./settings";
import { SyncEngine, type SyncResult } from "./sync";
import { VaultNotes } from "./vault-notes";
import { ArchiveView, ResultModal, VIEW_TYPE } from "./view";

export default class AppleBooksPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  library!: AppleBooksLibrary;
  private syncEngine!: SyncEngine;
  private saving: Promise<void> = Promise.resolve();
  private syncing = false;
  private loaded = false;
  private modals = new Set<Modal>();

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    if (saved && typeof saved === "object") {
      for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
        const value: unknown = Reflect.get(saved, key);
        if (key === "syncOnStartup" && typeof value === "boolean") this.settings[key] = value;
        else if (key !== "syncOnStartup" && typeof value === "string") this.settings[key] = value;
      }
    }
    if (!(this.app.vault.adapter instanceof FileSystemAdapter) || !this.manifest.dir) {
      new Notice("Apple Books Reading Archive 需要桌面文件系统。");
      return;
    }
    this.library = new AppleBooksLibrary(() => this.settings);
    this.syncEngine = new SyncEngine(this.library, new VaultNotes(this.app.vault));
    this.registerView(VIEW_TYPE, leaf => new ArchiveView(leaf, this));
    this.addRibbonIcon("book-open", "Apple Books 阅读档案", () => void this.openArchive());
    this.addCommand({ id: "open-reading-archive", name: "打开阅读档案", callback: () => void this.openArchive() });
    this.addCommand({ id: "sync-annotations", name: "同步高亮与笔记", callback: () => void this.syncBooks() });
    this.addCommand({ id: "connection-settings", name: "设置与连接诊断", callback: () => this.openSetup() });
    this.addSettingTab(new ArchiveSettingTab(this.app, this));
    this.loaded = true;
    this.app.workspace.onLayoutReady(() => {
      if (this.loaded && this.settings.syncOnStartup) void this.syncBooks(undefined, false);
    });
  }

  onunload(): void {
    this.loaded = false;
    this.syncEngine?.stop();
    this.library?.dispose();
    for (const modal of this.modals) modal.close();
    this.modals.clear();
  }

  async openArchive(): Promise<void> {
    try {
      const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0] ?? this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      await this.app.workspace.revealLeaf(leaf);
    } catch (error) { this.showError(error); }
  }

  openSetup(): void {
    this.openModal(new SetupModal(this.app, this));
  }

  openModal(modal: Modal): void {
    this.modals.add(modal);
    modal.open();
  }

  releaseModal(modal: Modal): void { this.modals.delete(modal); }

  async saveSettings(reconnect = false): Promise<void> {
    const value = { ...this.settings };
    this.saving = this.saving.catch(() => undefined).then(() => this.saveData(value));
    await this.saving;
    if (reconnect) this.library.reset();
  }

  async syncBooks(books?: Book[], showResult = true): Promise<SyncResult | undefined> {
    if (this.syncing) { new Notice("同步正在进行，请等待完成。"); return; }
    this.syncing = true;
    const progress = new Notice("正在读取 Apple Books…", 0);
    try {
      const result = await this.syncEngine.sync(this.settings.outputFolder, books, (done, total) => progress.setMessage(`正在同步 ${done} / ${total} 本书…`));
      if (!this.loaded) return result;
      if (showResult || result.failures.length > 0) {
        this.openModal(new ResultModal(this.app, this, result));
      } else if (result.created + result.updated > 0) new Notice(`Apple Books：新增 ${result.created} 本，更新 ${result.updated} 本。`);
      return result;
    } catch (error) { if (this.loaded) this.showError(error); return undefined; }
    finally { progress.hide(); this.syncing = false; }
  }

  async openNote(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
  }

  showError(error: unknown): void {
    reportError("operation failed", error);
    new Notice(errorMessage(error), 10_000);
  }
}
