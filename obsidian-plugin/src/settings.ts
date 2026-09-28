import { App, Modal, PluginSettingTab, Setting } from "obsidian";
import type AppleBooksPlugin from "./main";
import { errorMessage, type Summary } from "./models";
import { validateFolder } from "./documents";
import { historyStatus } from "./history-status";

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
  container.createEl("p", { text: "同步仅更新有标记且未被手动修改的自动生成区域。标记外的心得和属性会保留；源批注删除后会从自动区域移除，源书籍消失时不会删除已有笔记。" });
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
