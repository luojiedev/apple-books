const state = {
  limit: 24,
  offset: 0,
  total: 0,
  searchTimer: null,
  finishedYears: [],
  collectionYears: []
};

const elements = {
  grid: document.querySelector('#book-grid'),
  empty: document.querySelector('#empty-state'),
  count: document.querySelector('#result-count'),
  search: document.querySelector('#search'),
  status: document.querySelector('#status'),
  yearFilter: document.querySelector('#year-filter'),
  yearFilterHint: document.querySelector('#year-filter-hint'),
  sort: document.querySelector('#sort'),
  previous: document.querySelector('#previous'),
  next: document.querySelector('#next'),
  pageLabel: document.querySelector('#page-label'),
  exportLink: document.querySelector('#export-link'),
  reviewContent: document.querySelector('#review-content'),
  reviewNotesOnly: document.querySelector('#review-notes-only'),
  newReview: document.querySelector('#new-review'),
  dialog: document.querySelector('#book-dialog'),
  dialogContent: document.querySelector('#dialog-content'),
  toast: document.querySelector('#toast'),
  statusFilters: document.querySelectorAll('[data-status-filter]')
};

async function requestJSON(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: '读取数据失败' }));
    throw new Error(payload.error || '读取数据失败');
  }
  return response.json();
}

function queryParameters(includePaging = true) {
  const params = new URLSearchParams();
  if (elements.search.value.trim()) params.set('q', elements.search.value.trim());
  if (elements.status.value !== 'all') params.set('status', elements.status.value);
  if (elements.yearFilter.value) {
    const parameter = elements.status.value === 'finished' ? 'finishedYear' : 'collectionYear';
    params.set(parameter, elements.yearFilter.value);
  }
  params.set('sort', elements.sort.value);
  if (includePaging) {
    params.set('limit', state.limit);
    params.set('offset', state.offset);
  }
  return params;
}

async function loadSummary() {
  const summary = await requestJSON('/api/summary');
  document.querySelectorAll('[data-stat]').forEach((node) => {
    node.textContent = Number(summary[node.dataset.stat] || 0).toLocaleString('zh-CN');
  });
  state.finishedYears = summary.finishedYears || [];
  state.collectionYears = summary.collectionYears || [];
  updateYearOptions();
}

function updateYearOptions() {
  const showsFinishedYears = elements.status.value === 'finished';
  const years = showsFinishedYears ? state.finishedYears : state.collectionYears;
  const previousValue = elements.yearFilter.value;
  elements.yearFilter.replaceChildren();

  const allYears = document.createElement('option');
  allYears.value = '';
  allYears.textContent = showsFinishedYears ? '全部完成年份' : '全部收集年份';
  elements.yearFilter.append(allYears);
  years.forEach(({ year, count }) => {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = `${year} 年（${count} 本）`;
    elements.yearFilter.append(option);
  });
  if (years.some(({ year }) => String(year) === previousValue)) elements.yearFilter.value = previousValue;
  elements.yearFilterHint.textContent = showsFinishedYears
    ? '当前按完成日期筛选已读完书籍。'
    : '收集年份取数据库中购买、书库记录与创建日期的最早值，以减少迁移时间造成的偏差。';
}

async function loadReview(key = dailyReviewKey()) {
  elements.newReview.disabled = true;
  elements.reviewContent.innerHTML = '<p class="review-loading">正在从旧时光里找一页…</p>';
  const kind = elements.reviewNotesOnly.checked ? 'note' : 'all';
  try {
    const review = await requestJSON(`/api/review/random?key=${encodeURIComponent(`${key}:${kind}`)}&kind=${kind}`);
    renderReview(review);
  } catch (error) {
    elements.reviewContent.innerHTML = `<p class="review-error">${escapeHTML(error.message)}</p>`;
  } finally {
    elements.newReview.disabled = false;
  }
}

function renderReview(review) {
  const annotation = review.annotation;
  const quote = annotation.selectedText || annotation.note;
  elements.reviewContent.innerHTML = `
    <blockquote class="review-quote">“${escapeHTML(quote)}”</blockquote>
    ${annotation.note && annotation.note !== quote ? `<p class="review-note">${escapeHTML(annotation.note)}</p>` : ''}
    <p class="review-source">
      <button class="review-book-button" type="button">${escapeHTML(review.book.title || '未命名书籍')}</button>
      <span>·</span><span>${escapeHTML(review.book.author || '未知作者')}</span>
      ${annotation.createdAt ? `<span>·</span><span>${formatDate(annotation.createdAt)}</span>` : ''}
    </p>`;
  elements.reviewContent.querySelector('.review-book-button').addEventListener('click', () => openBook(review.book.id));
}

function dailyReviewKey() {
  const today = new Date();
  return `daily:${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

function newReviewKey() {
  return window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

async function loadBooks() {
  elements.grid.innerHTML = '<div class="loading">正在整理书架…</div>';
  elements.empty.hidden = true;
  try {
    const page = await requestJSON(`/api/books?${queryParameters()}`);
    state.total = page.total;
    renderBooks(page.items);
    updatePagination();
    elements.count.textContent = `共 ${page.total.toLocaleString('zh-CN')} 本`;
    elements.exportLink.href = `/api/export/books.csv?${queryParameters(false)}`;
  } catch (error) {
    elements.grid.innerHTML = '';
    showToast(error.message);
  }
}

function renderBooks(books) {
  elements.grid.innerHTML = '';
  elements.empty.hidden = books.length > 0;
  books.forEach((book) => {
    const card = document.createElement('article');
    card.className = 'book-card';
    card.tabIndex = 0;
    card.dataset.id = book.id;
    const percent = Math.max(0, Math.min(100, book.progress * 100));
    card.innerHTML = `
      <span class="book-number">NO. ${String(book.id).padStart(4, '0')}</span>
      <h3>${escapeHTML(book.title || '未命名书籍')}</h3>
      <p class="book-author">${escapeHTML(book.author || '未知作者')}</p>
      <div class="book-bottom">
        <div class="book-meta"><span class="status">${statusText(book.status)}</span><span>${percent.toFixed(1)}%</span></div>
        <progress class="progress-track" max="100" value="${percent}" aria-label="阅读进度 ${percent.toFixed(1)}%"></progress>
        <div class="annotation-count">${book.annotationCount ? `${book.annotationCount} 条批注 · ${book.noteCount} 条笔记` : formatLastOpened(book.lastOpenedAt)}</div>
      </div>`;
    card.addEventListener('click', () => openBook(book.id));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openBook(book.id); }
    });
    elements.grid.append(card);
  });
}

function updatePagination() {
  const page = Math.floor(state.offset / state.limit) + 1;
  const pages = Math.max(1, Math.ceil(state.total / state.limit));
  elements.pageLabel.textContent = `${page} / ${pages}`;
  elements.previous.disabled = state.offset === 0;
  elements.next.disabled = state.offset + state.limit >= state.total;
}

function updateStatusFilterState() {
  elements.statusFilters.forEach((button) => {
    const active = button.dataset.statusFilter === elements.status.value;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function applyStatusFilter(status) {
  elements.status.value = status;
  elements.yearFilter.value = '';
  updateYearOptions();
  state.offset = 0;
  updateStatusFilterState();
  loadBooks();
  scrollToLibrary();
}

async function openBook(id) {
  elements.dialogContent.innerHTML = '<div class="loading">正在翻开这本书…</div>';
  elements.dialog.showModal();
  try {
    const [book, annotations] = await Promise.all([
      requestJSON(`/api/books/${id}`), requestJSON(`/api/books/${id}/annotations`)
    ]);
    renderBookDetail(book, annotations.items);
  } catch (error) {
    elements.dialog.close();
    showToast(error.message);
  }
}

function renderBookDetail(book, annotations) {
  const percent = Math.max(0, Math.min(100, book.progress * 100));
  const annotationHTML = annotations.length
    ? annotations.map((annotation) => `
      <article class="annotation">
        ${annotation.selectedText ? `<blockquote>“${escapeHTML(annotation.selectedText)}”</blockquote>` : '<blockquote>书签</blockquote>'}
        ${annotation.note ? `<p class="annotation-note">笔记：${escapeHTML(annotation.note)}</p>` : ''}
        <p class="annotation-time">${annotationTypeText(annotation)} · ${formatDate(annotation.createdAt)}</p>
      </article>`).join('')
    : `<div class="annotation-empty" role="status">
        <strong>本机暂未发现这本书的高亮或笔记</strong>
        <p>书籍显示在书库中，并不代表其批注已经从 iCloud 同步到本机。如果这本书尚未下载，请先在 Apple Books 中下载并打开一次，等待同步完成后，再返回此处刷新页面。若仍未显示，请重启本工具后重试。</p>
      </div>`;
  elements.dialogContent.innerHTML = `
    <header class="detail-header">
      <p class="eyebrow">${statusText(book.status)}</p>
      <h2>${escapeHTML(book.title || '未命名书籍')}</h2>
      <p class="detail-author">${escapeHTML(book.author || '未知作者')}</p>
      <div class="detail-progress"><span>阅读进度</span><strong>${percent.toFixed(1)}%</strong>
        <progress class="progress-track" max="100" value="${percent}" aria-label="阅读进度 ${percent.toFixed(1)}%"></progress>
      </div>
      <a class="detail-export" href="/api/books/${book.id}/annotations.md" download>导出本书高亮与笔记</a>
    </header>
    <div class="detail-facts">
      <div><span>收集时间</span>${formatDate(book.collectedAt)}${book.collectionSource ? ` · ${collectionSourceText(book.collectionSource)}` : ''}</div>
      <div><span>最后打开</span>${formatDate(book.lastOpenedAt)}</div>
      <div><span>完成时间</span>${formatDate(book.finishedAt)}</div>
      <div><span>批注</span>${book.annotationCount} 条</div>
    </div>
    ${book.description ? `<p class="detail-description">${escapeHTML(book.description)}</p>` : ''}
    <section class="annotations"><h3>批注与笔记</h3>${annotationHTML}</section>`;
}

function statusText(status) {
  return ({ finished: '已读完', reading: '阅读中', unread: '未开始' })[status] || '未知';
}

function annotationTypeText(annotation) {
  if (annotation.note) return '笔记';
  if (annotation.isUnderline) return '下划线';
  return ({ highlight: '高亮', bookmark: '书签', other: '标记' })[annotation.type] || '标记';
}

function collectionSourceText(source) {
  return ({ purchase: '购买日期', record: '书库记录日期', creation: '数据库创建日期' })[source] || '数据库日期';
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatLastOpened(value) {
  return value ? `最后打开于 ${formatDate(value)}` : '没有打开时间';
}

function escapeHTML(value) {
  const node = document.createElement('span');
  node.textContent = value;
  return node.innerHTML;
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.hidden = false;
  window.setTimeout(() => { elements.toast.hidden = true; }, 3500);
}

elements.search.addEventListener('input', () => {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => { state.offset = 0; loadBooks(); }, 250);
});
elements.status.addEventListener('change', () => {
  state.offset = 0;
  elements.yearFilter.value = '';
  updateYearOptions();
  updateStatusFilterState();
  loadBooks();
});
elements.yearFilter.addEventListener('change', () => {
  state.offset = 0;
  loadBooks();
});
elements.sort.addEventListener('change', () => { state.offset = 0; loadBooks(); });
elements.statusFilters.forEach((button) => button.addEventListener('click', () => applyStatusFilter(button.dataset.statusFilter)));
elements.newReview.addEventListener('click', () => loadReview(newReviewKey()));
elements.reviewNotesOnly.addEventListener('change', () => loadReview());
elements.previous.addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadBooks(); scrollToLibrary(); });
elements.next.addEventListener('click', () => { state.offset += state.limit; loadBooks(); scrollToLibrary(); });
document.querySelector('#dialog-close').addEventListener('click', () => elements.dialog.close());
elements.dialog.addEventListener('click', (event) => { if (event.target === elements.dialog) elements.dialog.close(); });

function scrollToLibrary() { document.querySelector('.library-section').scrollIntoView({ behavior: 'smooth' }); }

Promise.all([loadSummary(), loadReview(), loadBooks()]).catch((error) => showToast(error.message));
