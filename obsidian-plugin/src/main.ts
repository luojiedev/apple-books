import { FileSystemAdapter, Modal, Notice, Plugin, TFile } from "obsidian";
import { AppleBooksLibrary } from "./apple-books-library";
import { DEFAULT_SETTINGS, errorMessage, reportError, type Book, type Settings } from "./models";
import { ArchiveSettingTab, SetupModal } from "./settings";
import { SyncEngine, type SyncResult } from "./sync";
import { VaultNotes } from "./vault-notes";
import { ArchiveView, ResultModal, VIEW_TYPE } from "./view";
import { AutoSync } from "./auto-sync";
import { documentOptions, readLastSync, readSettings, readSyncRecords, type LastSync } from "./sync-state";
import { ConflictModal } from "./conflicts";
import type { ConflictReview, SyncFailure } from "./sync";

export default class AppleBooksPlugin extends Plugin {
  settings: Settings = { ...DEFAULT_SETTINGS };
  library!: AppleBooksLibrary;
  private syncEngine!: SyncEngine;
  private saving: Promise<void> = Promise.resolve();
  private syncing = false;
  private loaded = false;
  private modals = new Set<Modal>();
  private scheduler!: AutoSync;
  private statusBar!: HTMLElement;
  private statusListeners = new Set<() => void>();
  private scheduleKey = "";
  lastSync?: LastSync;

  async onload(): Promise<void> {
    const saved: unknown = await this.loadData();
    this.settings = readSettings(saved);
    this.lastSync = readLastSync(saved);
    if (!(this.app.vault.adapter instanceof FileSystemAdapter) || !this.manifest.dir) {
      new Notice("Apple Books Reading Archive 需要桌面文件系统。");
      return;
    }
    this.library = new AppleBooksLibrary(() => this.settings);
    this.syncEngine = new SyncEngine(this.library, new VaultNotes(this.app.vault), readSyncRecords(saved));
    this.scheduler = new AutoSync(async () => { await this.syncBooks(undefined, false); });
    this.statusBar = this.addStatusBarItem();
    this.registerDomEvent(this.statusBar, "click", () => this.showSyncResult());
    this.statusBar.setAttribute("role", "button");
    this.statusBar.setAttribute("tabindex", "0");
    this.registerDomEvent(this.statusBar, "keydown", event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); this.showSyncResult(); } });
    this.registerView(VIEW_TYPE, leaf => new ArchiveView(leaf, this));
    this.addRibbonIcon("book-open", "Apple Books 阅读档案", () => void this.openArchive());
    this.addCommand({ id: "open-reading-archive", name: "打开阅读档案", callback: () => void this.openArchive() });
    this.addCommand({ id: "sync-annotations", name: "同步高亮与笔记", callback: () => void this.syncBooks() });
    this.addCommand({ id: "connection-settings", name: "设置与连接诊断", callback: () => this.openSetup() });
    this.addCommand({ id: "show-sync-result", name: "查看上次同步结果与冲突", callback: () => this.showSyncResult() });
    this.addSettingTab(new ArchiveSettingTab(this.app, this));
    this.loaded = true;
    this.notifyStatus();
    this.app.workspace.onLayoutReady(() => {
      if (!this.loaded) return;
      this.configureAutoSync();
      if (this.loaded && this.settings.syncOnStartup) void this.syncBooks(undefined, false);
    });
  }

  onunload(): void {
    this.loaded = false;
    this.scheduler?.stop();
    this.syncEngine?.stop();
    this.library?.dispose();
    for (const modal of this.modals) modal.close();
    this.modals.clear();
    this.statusListeners.clear();
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
    await this.persist();
    if (reconnect) this.library.reset();
    this.configureAutoSync();
    this.notifyStatus();
  }

  private async persist(): Promise<void> {
    const value = { ...this.settings, syncRecords: [...this.syncEngine.records], lastSync: this.lastSync };
    this.saving = this.saving.catch(() => undefined).then(() => this.saveData(value));
    await this.saving;
  }

  private configureAutoSync(): void {
    const key = `${this.settings.autoSync}:${this.settings.syncIntervalMinutes}`;
    if (key === this.scheduleKey) return;
    this.scheduler.configure(this.settings.autoSync, this.settings.syncIntervalMinutes);
    this.scheduleKey = key;
  }

  syncStatus(): string {
    if (this.syncing) return "Apple Books：正在同步…";
    const mode = this.settings.autoSync ? `自动同步 ${this.settings.syncIntervalMinutes} 分钟` : "手动同步";
    if (!this.lastSync) return `${mode} · 尚未同步`;
    const time = new Date(this.lastSync.finishedAt).toLocaleString();
    if (this.lastSync.error) return `${mode} · ${time} 同步失败`;
    const result = this.lastSync.result!;
    return `${mode} · ${time} · 新增 ${result.created} / 更新 ${result.updated} / 无变化 ${result.unchanged}${result.failures.length ? ` / 待处理 ${result.failures.length}` : ""}`;
  }

  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }
  private notifyStatus(): void {
    this.statusBar?.setText(this.syncing ? "Apple Books：同步中" : this.lastSync?.error ? "Apple Books：同步失败" : this.lastSync?.result?.failures.length ? `Apple Books：${this.lastSync.result.failures.length} 项待处理` : "Apple Books：同步状态");
    this.statusBar?.setAttribute("aria-label", this.syncStatus());
    for (const listener of this.statusListeners) listener();
  }
  showSyncResult(): void {
    if (this.lastSync?.result) this.openModal(new ResultModal(this.app, this, this.lastSync.result));
    else if (this.lastSync?.error) new Notice(this.lastSync.error, 10000);
    else new Notice("尚未同步。可在阅读档案中手动同步，或在设置中开启自动同步。");
  }
  openConflict(failure: SyncFailure): void { this.openModal(new ConflictModal(this.app, this, failure)); }
  async reviewConflict(failure: SyncFailure): Promise<ConflictReview> { return this.syncEngine.review(failure, documentOptions(this.settings)); }
  async resolveConflict(review: ConflictReview, body: string, properties?: string): Promise<void> {
    if (!this.loaded) throw new Error("插件已关闭。");
    if (this.syncing) throw new Error("同步正在进行，请稍后保存处理结果。");
    this.syncing = true; this.notifyStatus();
    try {
      await this.syncEngine.resolve(review, body, properties, documentOptions(this.settings));
      if (this.lastSync?.result) this.lastSync.result.failures = this.lastSync.result.failures.filter(failure => failure.path !== review.path);
      await this.persist();
      if (this.loaded) new Notice("处理结果已保存。后续来源变化时会再次检查冲突。");
    } finally { this.syncing = false; if (this.loaded) this.notifyStatus(); }
  }

  async syncBooks(books?: Book[], showResult = true): Promise<SyncResult | undefined> {
    if (!this.loaded) return;
    if (this.syncing) { if (showResult) new Notice("同步正在进行，请等待完成。"); return; }
    this.syncing = true;
    this.notifyStatus();
    const progress = showResult ? new Notice("正在读取 Apple Books…", 0) : undefined;
    try {
      const result = await this.syncEngine.sync(this.settings.outputFolder, books, (done, total) => progress?.setMessage(`正在同步 ${done} / ${total} 本书…`), documentOptions(this.settings), !showResult);
      if (!this.loaded) return result;
      this.lastSync = { finishedAt: new Date().toISOString(), result };
      await this.persist();
      if (!this.loaded) return result;
      if (showResult) {
        this.openModal(new ResultModal(this.app, this, result));
      }
      return result;
    } catch (error) {
      reportError("sync failed", error);
      if (this.loaded) {
        this.lastSync = { finishedAt: new Date().toISOString(), error: errorMessage(error) };
        await this.persist().catch(error => reportError("save sync status failed", error));
        if (showResult) this.showError(error);
      }
      return undefined;
    }
    finally { progress?.hide(); this.syncing = false; if (this.loaded) this.notifyStatus(); }
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
