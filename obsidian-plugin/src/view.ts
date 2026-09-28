import { App, ItemView, Modal, WorkspaceLeaf } from "obsidian";
import { randomUUID } from "node:crypto";
import type AppleBooksPlugin from "./main";
import { LibraryError } from "./apple-books-library";
import { historyStatus } from "./history-status";
import { errorMessage, type Book, type Page, type Review, type Snapshot, type Summary, type YearReport } from "./models";
import type { SyncResult } from "./sync";

export const VIEW_TYPE = "apple-books-reading-archive";
type Tab = "overview" | "books" | "search" | "report";

function button(parent: HTMLElement, label: string, action: () => void | Promise<unknown>, primary = false): HTMLButtonElement {
  const element = parent.createEl("button", { text: label, cls: primary ? "mod-cta" : "" });
  element.addEventListener("click", () => {
    element.disabled = true;
    Promise.resolve().then(action).finally(() => { element.disabled = false; }).catch(error => console.error("[Apple Books] view action failed", error));
  });
  return element;
}

function duration(seconds: number): string { return `${(seconds / 3600).toFixed(1)} 小时`; }
function statusLabel(status: string): string { return status === "finished" ? "已读完" : status === "reading" ? "阅读中" : "未开始"; }
function metric(parent: HTMLElement, label: string, value: string): void {
  const card = parent.createDiv({ cls: "abr-metric" });
  card.createDiv({ cls: "abr-muted", text: label });
  card.createDiv({ cls: "abr-metric-value", text: value });
}

export class ArchiveView extends ItemView {
  private generation = 0;
  private tab: Tab = "overview";
  private query = "";
  private searchQuery = "";
  private bookStatus = "";
  private offset = 0;
  private searchOffset = 0;
  private year = new Date().getFullYear();
  private selected = new Map<string, Book>();

  constructor(leaf: WorkspaceLeaf, private plugin: AppleBooksPlugin) { super(leaf); }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return "Apple Books 阅读档案"; }
  getIcon(): string { return "book-open"; }
  async onOpen(): Promise<void> { await this.show("overview"); }
  async onClose(): Promise<void> { this.generation++; this.contentEl.empty(); }

  private async show(tab: Tab): Promise<void> {
    this.tab = tab;
    const generation = ++this.generation;
    this.contentEl.empty();
    this.contentEl.addClass("abr-view");
    const header = this.contentEl.createDiv({ cls: "abr-header" });
    const title = header.createDiv();
    title.createDiv({ cls: "abr-eyebrow", text: "APPLE BOOKS · 本机阅读档案" });
    title.createEl("h1", { text: "让读过的，留在身边。" });
    title.createEl("p", { cls: "abr-muted", text: "整理摘录，重温想法，看见阅读的积累。" });
    const actions = header.createDiv({ cls: "abr-actions" });
    button(actions, "设置与连接", () => this.plugin.openSetup());
    button(actions, "同步高亮与笔记", () => this.plugin.syncBooks(), true);
    const tabs = this.contentEl.createDiv({ cls: "abr-tabs", attr: { role: "tablist" } });
    for (const [id, label] of [["overview", "阅读概览"], ["books", "我的书库"], ["search", "搜索摘录"], ["report", "年度报告"]] as const) {
      const element = button(tabs, label, () => { if (id !== this.tab) return this.show(id); });
      element.setAttribute("role", "tab");
      element.setAttribute("aria-selected", String(id === tab));
      element.toggleClass("is-active", id === tab);
    }
    const body = this.contentEl.createDiv({ cls: "abr-body" });
    body.createEl("p", { cls: "abr-muted", text: "正在读取本机书库…" });
    try {
      switch (tab) {
        case "overview": await this.overview(body, generation); break;
        case "books": await this.books(body, generation); break;
        case "search": await this.search(body, generation); break;
        case "report": await this.report(body, generation); break;
      }
    } catch (error) {
      if (generation === this.generation) this.showFailure(body, error);
    }
  }

  private showFailure(parent: HTMLElement, error: unknown): void {
    parent.empty();
    const card = parent.createDiv({ cls: "abr-empty" });
    card.createEl("h2", { text: "连接你的 Apple Books" });
    card.createEl("p", { text: errorMessage(error) });
    card.createEl("p", { cls: "abr-muted", text: "首次使用请检测连接。如果书籍或批注尚未出现在本机，请先打开 Apple Books，等待同步完成。" });
    const actions = card.createDiv({ cls: "abr-actions" });
    button(actions, "打开设置与诊断", () => this.plugin.openSetup(), true);
    button(actions, "重试", () => this.show(this.tab));
  }

  private async overview(body: HTMLElement, generation: number): Promise<void> {
    const summary = await this.plugin.library.call<Summary>("summary");
    if (generation !== this.generation) return;
    body.empty();
    const metrics = body.createDiv({ cls: "abr-metrics" });
    metric(metrics, "书库", `${summary.totalBooks} 本`);
    metric(metrics, "正在阅读", `${summary.readingBooks} 本`);
    metric(metrics, "留下的摘录", `${summary.annotationCount} 条`);
    metric(metrics, "累计阅读", summary.readingTimeAvailable ? duration(summary.readingSeconds) : "暂不可用");
    if (!summary.readingTimeAvailable) body.createEl("p", { cls: "abr-muted", text: historyStatus(summary.readingTimeError) });
    const review = body.createDiv({ cls: "abr-review" });
    const heading = review.createDiv({ cls: "abr-section-header" });
    heading.createEl("h2", { text: "与过去的想法重逢" });
    const reviewBody = review.createDiv();
    let notesOnly = false;
    const controls = heading.createDiv({ cls: "abr-actions" });
    const label = controls.createEl("label", { cls: "abr-checkbox" });
    const checkbox = label.createEl("input", { type: "checkbox" });
    label.appendText("仅看笔记");
    const loadReview = async (): Promise<void> => {
      try {
        const item = await this.plugin.library.call<Review>("review", { key: randomUUID(), notesOnly });
        if (generation !== this.generation) return;
        reviewBody.empty();
        reviewBody.createEl("blockquote", { text: item.annotation.selectedText || item.annotation.note || "" });
        if (item.annotation.selectedText && item.annotation.note) reviewBody.createEl("p", { cls: "abr-note", text: item.annotation.note });
        button(reviewBody, `${item.book.title} · ${item.book.author || "未知作者"}`, () => this.openBook(item.book));
      } catch (error) {
        if (generation !== this.generation) return;
        reviewBody.empty();
        reviewBody.createEl("p", { text: error instanceof LibraryError && error.code === "not_found" ? "暂时没有可回顾的摘录。在 Apple Books 中留下第一条高亮后，再回来看看。" : errorMessage(error) });
      }
    };
    checkbox.addEventListener("change", () => { notesOnly = checkbox.checked; void loadReview(); });
    button(controls, "再看一条", loadReview);
    await loadReview();
    if (generation !== this.generation) return;
    const reading = body.createDiv({ cls: "abr-section" });
    reading.createEl("h2", { text: "继续阅读" });
    const page = await this.plugin.library.call<Page<Book>>("books", { status: "reading", limit: 6 });
    if (generation !== this.generation) return;
    if (!page.items.length) reading.createEl("p", { cls: "abr-muted", text: "当前没有正在阅读的书。可以到书库选择一本开始。" });
    for (const book of page.items) this.bookRow(reading, book);
  }

  private async books(body: HTMLElement, generation: number): Promise<void> {
    const method = this.bookStatus === "wantToRead" ? "wantToRead" : "books";
    const page = await this.plugin.library.call<Page<Book>>(method, { search: this.query, status: method === "books" ? this.bookStatus : "", limit: 30, offset: this.offset });
    if (generation !== this.generation) return;
    body.empty();
    const form = body.createEl("form", { cls: "abr-toolbar" });
    const input = form.createEl("input", { type: "search", value: this.query, placeholder: "搜索书名或作者", attr: { "aria-label": "搜索书名或作者" } });
    input.disabled = method === "wantToRead";
    const select = form.createEl("select", { attr: { "aria-label": "阅读状态" } });
    for (const [value, text] of [["", "全部书籍"], ["reading", "阅读中"], ["finished", "已读完"], ["unread", "未开始"], ["wantToRead", "欲读清单"]]) select.createEl("option", { value, text });
    select.value = this.bookStatus;
    select.addEventListener("change", () => { this.bookStatus = select.value; this.query = input.value; this.offset = 0; void this.show("books"); });
    form.createEl("button", { type: "submit", text: "搜索" });
    form.addEventListener("submit", event => { event.preventDefault(); this.query = input.value; this.offset = 0; void this.show("books"); });
    const selection = body.createDiv({ cls: "abr-selection" });
    const selectedCount = selection.createSpan({ text: `共 ${page.total} 本 · 已选 ${this.selected.size} 本` });
    button(selection, "同步选中书籍", async () => {
      if (!this.selected.size) { selectedCount.setText("请先勾选要同步的书籍。"); return; }
      await this.plugin.syncBooks([...this.selected.values()]);
    }, true);
    const grid = body.createDiv({ cls: "abr-book-list" });
    if (!page.items.length) grid.createEl("p", { cls: "abr-muted", text: "没有找到符合条件的书籍。" });
    for (const book of page.items) {
      const row = grid.createDiv({ cls: "abr-selectable" });
      const checkbox = row.createEl("input", { type: "checkbox", attr: { "aria-label": `选择 ${book.title}` } });
      checkbox.checked = this.selected.has(book.assetId);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) this.selected.set(book.assetId, book); else this.selected.delete(book.assetId);
        selectedCount.setText(`共 ${page.total} 本 · 已选 ${this.selected.size} 本`);
      });
      this.bookRow(row, book);
    }
    this.pagination(body, page, offset => { this.offset = offset; return this.show("books"); });
  }

  private async search(body: HTMLElement, generation: number): Promise<void> {
    body.empty();
    const form = body.createEl("form", { cls: "abr-toolbar" });
    const input = form.createEl("input", { type: "search", value: this.searchQuery, placeholder: "搜索所有高亮与个人笔记", attr: { "aria-label": "搜索所有高亮与个人笔记" } });
    form.createEl("button", { type: "submit", text: "搜索", cls: "mod-cta" });
    form.addEventListener("submit", event => { event.preventDefault(); this.searchQuery = input.value.trim(); this.searchOffset = 0; void this.show("search"); });
    if (!this.searchQuery) { body.createEl("p", { cls: "abr-empty", text: "输入一个词，找回读过的内容。" }); return; }
    const page = await this.plugin.library.call<Page<Review>>("search", { search: this.searchQuery, limit: 30, offset: this.searchOffset });
    if (generation !== this.generation) return;
    body.createEl("p", { cls: "abr-muted", text: `找到 ${page.total} 条摘录与笔记` });
    for (const item of page.items) {
      const card = body.createDiv({ cls: "abr-search-result" });
      button(card, item.book.title, () => this.openBook(item.book));
      if (item.annotation.selectedText) card.createEl("blockquote", { text: item.annotation.selectedText });
      if (item.annotation.note) card.createEl("p", { cls: "abr-note", text: item.annotation.note });
    }
    this.pagination(body, page, offset => { this.searchOffset = offset; return this.show("search"); });
  }

  private async report(body: HTMLElement, generation: number): Promise<void> {
    const summary = await this.plugin.library.call<Summary>("summary");
    const report = await this.plugin.library.call<YearReport>("report", { year: this.year });
    if (generation !== this.generation) return;
    body.empty();
    const header = body.createDiv({ cls: "abr-section-header" });
    header.createEl("h2", { text: `${this.year}，你的阅读足迹` });
    const years = [...new Set([new Date().getFullYear(), this.year, ...(summary.readingYears ?? []), ...(summary.annotationYears ?? []), ...(summary.finishedYears ?? []).map(value => value.year)])].sort((a, b) => b - a);
    const select = header.createEl("select", { attr: { "aria-label": "报告年份" } });
    for (const year of years) select.createEl("option", { value: String(year), text: `${year} 年` });
    select.value = String(this.year);
    select.addEventListener("change", () => { this.year = Number(select.value); void this.show("report"); });
    const metrics = body.createDiv({ cls: "abr-metrics" });
    metric(metrics, "读完", `${report.finishedBooks} 本`);
    metric(metrics, "阅读时长", report.readingTimeAvailable ? duration(report.readingSeconds) : "暂不可用");
    metric(metrics, "留下批注", `${report.annotationCount} 条`);
    metric(metrics, "批注活跃日", `${report.activeDays} 天`);
    if (!report.readingTimeAvailable) body.createEl("p", { cls: "abr-muted", text: historyStatus(report.readingTimeError) });
    body.createEl("p", { cls: "abr-muted", text: "批注活跃日指创建过批注的日期，不等同于阅读天数。阅读时长来自 Apple Books 阅读历史。" });
    const table = body.createEl("table", { cls: "abr-months" });
    const head = table.createEl("thead").createEl("tr");
    for (const text of ["月份", "阅读时长", "批注数量"]) head.createEl("th", { text });
    const tbody = table.createEl("tbody");
    const maximum = Math.max(1, ...report.months.map(month => month.annotationCount));
    for (const month of report.months) {
      const row = tbody.createEl("tr");
      row.createEl("td", { text: `${month.month} 月` });
      row.createEl("td", { text: report.readingTimeAvailable ? duration(month.readingSeconds) : "—" });
      const count = row.createEl("td");
      count.createEl("meter", { attr: { min: 0, max: maximum, value: month.annotationCount, "aria-label": `${month.month} 月 ${month.annotationCount} 条批注` } });
      count.createSpan({ text: String(month.annotationCount) });
    }
    body.createEl("h2", { text: "这一年，留下最多想法的书" });
    for (const item of report.topBooks ?? []) this.bookRow(body, item.book, `${item.annotationCount} 条年度批注`);
  }

  private bookRow(parent: HTMLElement, book: Book, detail?: string): void {
    const row = parent.createDiv({ cls: "abr-book-row" });
    const icon = row.createDiv({ cls: "abr-book-cover", text: Array.from(book.title || "书")[0] });
    icon.setAttribute("aria-hidden", "true");
    const info = row.createDiv({ cls: "abr-book-info" });
    button(info, book.title || "未命名书籍", () => this.openBook(book));
    info.createDiv({ cls: "abr-muted", text: `${book.author || "未知作者"} · ${statusLabel(book.status)}` });
    info.createDiv({ cls: "abr-book-meta", text: detail ?? `${book.annotationCount} 条批注 · ${book.noteCount} 条笔记` });
  }

  private pagination<T>(body: HTMLElement, page: Page<T>, change: (offset: number) => Promise<void>): void {
    if (page.total <= page.limit) return;
    const controls = body.createDiv({ cls: "abr-pagination" });
    button(controls, "上一页", () => change(Math.max(0, page.offset - page.limit))).disabled = page.offset === 0;
    controls.createSpan({ text: `${Math.floor(page.offset / page.limit) + 1} / ${Math.ceil(page.total / page.limit)}` });
    button(controls, "下一页", () => change(page.offset + page.limit)).disabled = page.offset + page.items.length >= page.total;
  }

  private openBook(book: Book): void {
    this.plugin.openModal(new BookModal(this.app, this.plugin, book));
  }
}

class BookModal extends Modal {
  private closed = false;
  constructor(app: App, private plugin: AppleBooksPlugin, private book: Book) { super(app); }
  async onOpen(): Promise<void> {
    this.setTitle(this.book.title || "未命名书籍");
    this.contentEl.addClass("abr-book-detail");
    this.contentEl.createEl("p", { cls: "abr-muted", text: `${this.book.author || "未知作者"} · ${statusLabel(this.book.status)}` });
    button(this.contentEl, "同步这本书", async () => {
      const result = await this.plugin.syncBooks([this.book]);
      if (result) this.close();
    }, true);
    const notes = this.contentEl.createDiv();
    notes.createEl("p", { text: "正在读取高亮与笔记…" });
    try {
      const snapshot = await this.plugin.library.call<Snapshot>("book", { id: this.book.id });
      if (this.closed) return;
      notes.empty();
      if (!snapshot.annotations.length) notes.createEl("p", { text: "本机尚无这本书的高亮或笔记。" });
      for (const annotation of snapshot.annotations) {
        const card = notes.createDiv({ cls: "abr-search-result" });
        if (annotation.chapter) card.createDiv({ cls: "abr-muted", text: annotation.chapter });
        if (annotation.selectedText) card.createEl("blockquote", { text: annotation.selectedText });
        if (annotation.note) card.createEl("p", { cls: "abr-note", text: annotation.note });
      }
    } catch (error) { if (!this.closed) notes.setText(errorMessage(error)); }
  }
  onClose(): void { this.closed = true; this.contentEl.empty(); this.plugin.releaseModal(this); }
}

export class ResultModal extends Modal {
  constructor(app: App, private plugin: AppleBooksPlugin, private result: SyncResult) { super(app); }
  onOpen(): void {
    this.setTitle(this.result.failures.length ? "同步完成，部分书籍需要处理" : "阅读笔记已同步");
    this.contentEl.createEl("p", { text: `新增 ${this.result.created} 本 · 更新 ${this.result.updated} 本 · 无变化 ${this.result.unchanged} 本 · 未同步 ${this.result.failures.length} 本` });
    this.contentEl.createEl("p", { text: "请在自动生成区域外撰写个人心得。重复同步不会重复添加摘录。" });
    if (this.result.paths.length === 1 && this.result.paths[0]) {
      const path = this.result.paths[0];
      button(this.contentEl, "打开阅读笔记", async () => { await this.plugin.openNote(path); this.close(); }, true);
    }
    for (const failure of this.result.failures) {
      const section = this.contentEl.createDiv({ cls: "abr-search-result" });
      section.createEl("strong", { text: failure.title });
      section.createEl("p", { text: failure.message });
    }
  }
  onClose(): void { this.contentEl.empty(); this.plugin.releaseModal(this); }
}
