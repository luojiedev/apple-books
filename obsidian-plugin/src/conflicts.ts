import { App, Modal } from "obsidian";
import type AppleBooksPlugin from "./main";
import { errorMessage } from "./models";
import { compareLines, mergedText, type Difference } from "./diff";
import type { ConflictReview, SyncFailure } from "./sync";

export class ConflictModal extends Modal {
  private closed = false;
  constructor(app: App, private plugin: AppleBooksPlugin, private failure: SyncFailure) { super(app); }
  async onOpen(): Promise<void> {
    this.setTitle(`对比并处理：${this.failure.title}`);
    this.modalEl.addClass("abr-conflict-modal");
    this.contentEl.createEl("p", { text: "正在读取双方的最新内容…" });
    try {
      const review = await this.plugin.reviewConflict(this.failure);
      if (!this.closed) this.render(review);
    } catch (error) {
      if (!this.closed) {
        this.contentEl.empty();
        this.contentEl.createEl("p", { text: errorMessage(error) });
        if (this.failure.path) this.contentEl.createEl("button", { text: "打开笔记检查" }).addEventListener("click", () => { void this.plugin.openNote(this.failure.path!).catch(error => this.plugin.showError(error)); });
      }
    }
  }

  private render(review: ConflictReview): void {
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: "每一处差异默认保留本地内容，可逐段改为 Apple Books 内容。只有点击保存才会修改笔记，标记外的心得不会改动。" });
    this.contentEl.createEl("p", { cls: "abr-muted", text: "保留本地内容后，相同来源不会覆盖它；来源再次变化时，会重新提示对比。保存前会再次检查双方是否有新修改。" });
    const body = compareLines(review.localBody, review.sourceBody);
    const properties = review.sourceProperties !== undefined ? compareLines(review.localProperties ?? "", review.sourceProperties) : undefined;
    const actions = this.contentEl.createDiv({ cls: "abr-actions" });
    const comparisons = this.contentEl.createDiv();
    const status = this.contentEl.createEl("p", { attr: { role: "status" } });
    const all = [...body, ...(properties ?? [])];
    const render = () => {
      comparisons.empty();
      if (properties) this.renderDifferences(comparisons, "书籍属性", properties);
      this.renderDifferences(comparisons, "笔记正文", body);
    };
    for (const [choice, label] of [["local", "全部保留本地"], ["source", "全部采用 Apple Books"]] as const) {
      actions.createEl("button", { text: label }).addEventListener("click", () => { for (const difference of all) difference.choice = choice; render(); });
    }
    const save = actions.createEl("button", { text: "保存所选结果", cls: "mod-cta" });
    save.addEventListener("click", () => {
      save.disabled = true;
      void this.plugin.resolveConflict(review, mergedText(body), properties ? mergedText(properties) : undefined).then(() => {
        if (!this.closed) this.close();
      }).catch(error => {
        if (!this.closed) status.setText(errorMessage(error));
        this.plugin.showError(error);
      }).finally(() => { save.disabled = false; });
    });
    render();
  }

  private renderDifferences(parent: HTMLElement, title: string, differences: Difference[]): void {
    parent.createEl("h3", { text: title });
    if (!differences.some(difference => difference.changed)) { parent.createEl("p", { cls: "abr-muted", text: "内容一致，保存时会重新确认同步标记。" }); return; }
    let number = 0;
    for (const difference of differences) {
      if (!difference.changed) continue;
      const section = parent.createDiv({ cls: "abr-difference" });
      section.createEl("h4", { text: `差异 ${++number}` });
      const columns = section.createDiv({ cls: "abr-diff-columns" });
      for (const [side, label] of [["local", "本地笔记"], ["source", "Apple Books / 当前模板"]] as const) {
        const column = columns.createDiv();
        column.createEl("strong", { text: label });
        column.createEl("pre", { text: difference[side] || "（此处无内容）" });
      }
      const select = section.createEl("select", { attr: { "aria-label": `${title}差异 ${number} 的处理方式` } });
      select.createEl("option", { value: "local", text: "保留本地" });
      select.createEl("option", { value: "source", text: "采用 Apple Books" });
      select.value = difference.choice;
      select.addEventListener("change", () => { difference.choice = select.value === "local" ? "local" : "source"; });
    }
  }
  onClose(): void { this.closed = true; this.contentEl.empty(); this.plugin.releaseModal(this); }
}
