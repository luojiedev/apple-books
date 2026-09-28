import { App, Modal, PluginSettingTab, Setting } from "obsidian";
import type AppleBooksPlugin from "./main";
import { DEFAULT_DOCUMENT_OPTIONS, errorMessage, type Snapshot, type Summary } from "./models";
import { createDocument, notePath, validateFolder } from "./documents";
import { historyStatus } from "./history-status";
import { documentOptions } from "./sync-state";
import { validateTemplates } from "./templates";

export class ArchiveSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: AppleBooksPlugin) { super(app, plugin); }
  display(): void { renderSettings(this.containerEl, this.plugin); }
}

export class SetupModal extends Modal {
  constructor(app: App, private plugin: AppleBooksPlugin) { super(app); }
  onOpen(): void { this.setTitle("连接 Apple Books"); renderSettings(this.contentEl, this.plugin); }
  onClose(): void { this.contentEl.empty(); this.plugin.releaseModal(this); }
}

function renderSettings(container: HTMLElement, plugin: AppleBooksPlugin): void {
  container.empty();
  container.addClass("abr-settings");
  container.createEl("p", { text: "在这台 Mac 上读取 Apple Books，然后将高亮和笔记保存为 Markdown。数据留在本机；Apple Books 数据库始终只读。" });
  const status = container.createDiv({ cls: "abr-status", text: "插件直接读取本机书库，无需辅助程序或额外安装。" });
  new Setting(container).setName("本机书库").setDesc("自动查找这台 Mac 上的 Apple Books 数据。首次使用请先在 Apple Books 中完成同步。")
    .addButton(button => button.setButtonText("检测连接").setCta().onClick(async () => {
      button.setDisabled(true); status.setText("正在检测…");
      try {
        plugin.library.reset();
        const summary = await plugin.library.call<Summary>("summary");
        status.setText(`已连接：${summary.totalBooks} 本书、${summary.annotationCount} 条批注。${summary.readingTimeAvailable ? "阅读时长可用。" : historyStatus(summary.readingTimeError)}`);
      } catch (error) { status.setText(errorMessage(error)); plugin.showError(error); }
      finally { button.setDisabled(false); }
    }));
  container.createEl("p", { cls: "abr-muted", text: "若提示数据库权限不足：在 macOS「系统设置 → 隐私与安全性 → 完全磁盘访问权限」中允许 Obsidian，然后完全退出并重新打开。缺少批注时，请先在 Apple Books 下载并打开该书，等待 iCloud 同步。" });
  new Setting(container).setName("笔记文件夹").setDesc("新笔记保存的位置。已同步的笔记即使移动或改名，也会在原位置更新。")
    .addText(text => {
      text.setValue(plugin.settings.outputFolder).setPlaceholder("Apple Books");
      text.inputEl.addEventListener("change", () => {
        try { plugin.settings.outputFolder = validateFolder(text.getValue()); void plugin.saveSettings().catch(error => plugin.showError(error)); }
        catch (error) { plugin.showError(error); text.setValue(plugin.settings.outputFolder); }
      });
    });
  new Setting(container).setName("启动时同步").setDesc("默认关闭。开启后，同步所有有批注的书和此前已同步的书。")
    .addToggle(toggle => toggle.setValue(plugin.settings.syncOnStartup).onChange(async value => {
      plugin.settings.syncOnStartup = value;
      try { await plugin.saveSettings(); } catch (error) { plugin.showError(error); }
    }));
  new Setting(container).setName("自动增量同步").setDesc("默认关闭。开启后定时检查变化，只更新变动的书；后台不会弹出结果窗口，冲突会显示在底部状态栏。")
    .addToggle(toggle => toggle.setValue(plugin.settings.autoSync).onChange(async value => {
      plugin.settings.autoSync = value;
      try { await plugin.saveSettings(); } catch (error) { plugin.showError(error); }
    }));
  new Setting(container).setName("检查间隔（分钟）").setDesc("范围 1–1440。上次检查结束后才会安排下一次，插件停用或 Obsidian 关闭后停止。")
    .addText(text => {
      text.setValue(String(plugin.settings.syncIntervalMinutes));
      text.inputEl.type = "number"; text.inputEl.min = "1"; text.inputEl.max = "1440";
      text.inputEl.addEventListener("change", () => {
        const value = Number(text.getValue());
        if (!Number.isInteger(value) || value < 1 || value > 1440) { text.setValue(String(plugin.settings.syncIntervalMinutes)); plugin.showError(new Error("检查间隔须为 1–1440 分钟。")); return; }
        plugin.settings.syncIntervalMinutes = value;
        void plugin.saveSettings().catch(error => plugin.showError(error));
      });
    });
  new Setting(container).setName("上次同步").setDesc(plugin.syncStatus())
    .addButton(button => button.setButtonText("查看结果与冲突").onClick(() => plugin.showSyncResult()));
  container.createEl("p", { text: "同步仅更新有标记且未被手动修改的自动生成区域。标记外的心得和属性会保留；源批注删除后会从自动区域移除，源书籍消失时不会删除已有笔记。" });
  renderTemplateSettings(container, plugin);
  const details = container.createEl("details");
  details.createEl("summary", { text: "高级设置：指定数据库与查看日志" });
  details.createEl("p", { cls: "abr-muted", text: "通常无需填写。书库和批注路径必须同时设置；修改后下次读取时重新连接。使用快照时请确保数据库与 WAL 文件来自同一次一致性备份。" });
  for (const [key, label] of [["libraryDB", "书库数据库"], ["annotationDB", "批注数据库"], ["readingHistoryDB", "阅读历史数据库"]] as const) {
    new Setting(details).setName(label).addText(text => {
      text.setValue(plugin.settings[key]).setPlaceholder("留空自动发现");
      text.inputEl.addEventListener("change", () => {
        plugin.settings[key] = text.getValue().trim();
        void plugin.saveSettings(true).catch(error => plugin.showError(error));
      });
    });
  }
  details.createEl("p", { cls: "abr-muted", text: "插件调试信息可在 Obsidian 开发者工具 Console 中筛选 [Apple Books]。日志不记录摘录正文或搜索词。" });
}

function renderTemplateSettings(container: HTMLElement, plugin: AppleBooksPlugin): void {
  const details = container.createEl("details", { cls: "abr-template-settings" });
  details.createEl("summary", { text: "笔记模板与书籍属性" });
  let draft = documentOptions(plugin.settings);
  details.createEl("p", { text: "文件名模板仅影响新笔记；正文模板影响下次同步的自动区域。已移动或改名的笔记会继续原位更新。" });
  new Setting(details).setName("文件名与子目录模板").setDesc("支持 {{title}}、{{author}}、{{id}}，可用 / 划分子目录。未写 {{id}} 时自动追加稳定标识，避免同名书混写。")
    .addText(text => text.setValue(draft.fileNameTemplate).onChange(value => { draft.fileNameTemplate = value; }));
  new Setting(details).setName("正文模板").setDesc("支持 {{title}}、{{author}}、{{status}}、{{progress}}、{{annotation_count}}、{{finished_at}}、{{chapter_notice}} 和 {{annotations}}；必须且只能包含一次 {{annotations}}。")
    .addTextArea(text => { text.setValue(draft.bodyTemplate).onChange(value => { draft.bodyTemplate = value; }); text.inputEl.rows = 10; });
  new Setting(details).setName("同步书籍属性").setDesc("在 frontmatter 的专用区域同步书名、作者、状态、进度（0–100）、批注数和完成日期。个人属性保留；手动修改专用区域时会进入冲突处理。关闭后已有属性保留但不再更新。")
    .addToggle(toggle => toggle.setValue(draft.includeBookProperties).onChange(value => { draft.includeBookProperties = value; }));
  const feedback = details.createEl("p", { attr: { role: "status" } });
  const preview = details.createEl("pre", { cls: "abr-template-preview" });
  const sample: Snapshot = {
    book: { id: 1, assetId: "template-preview", title: "慢慢读，慢慢想", author: "示例作者", status: "reading", progress: 0.42, annotationCount: 1, noteCount: 0 },
    annotations: [{ id: 1, uuid: "preview-highlight", selectedText: "给一个念头留出时间。", type: "highlight", style: 0, isUnderline: false, chapter: "第一章", chapterOrder: 0 }], chaptersAvailable: true,
  };
  new Setting(details).addButton(button => button.setButtonText("预览示例").onClick(() => {
    try { validateTemplates(draft); preview.setText(`${notePath(plugin.settings.outputFolder, sample, draft)}\n\n${createDocument(sample, draft)}`); feedback.setText("这是虚构数据预览，不会创建笔记。"); }
    catch (error) { feedback.setText(errorMessage(error)); }
  })).addButton(button => button.setButtonText("保存模板").setCta().onClick(async () => {
    try { validateTemplates(draft); Object.assign(plugin.settings, draft); await plugin.saveSettings(); feedback.setText("模板已保存，下次同步时生效。"); }
    catch (error) { feedback.setText(errorMessage(error)); plugin.showError(error); }
  })).addButton(button => button.setButtonText("恢复默认模板").onClick(async () => {
    draft = { ...DEFAULT_DOCUMENT_OPTIONS };
    Object.assign(plugin.settings, draft);
    try { await plugin.saveSettings(); renderSettings(container, plugin); }
    catch (error) { plugin.showError(error); }
  }));
}
