const state = {
  limit: 24,
  offset: 0,
  total: 0,
  searchTimer: null,
  finishedYears: [],
  collectionYears: [],
  bookDetail: null,
  language: initialLanguage()
};

const translations = {
  'zh-CN': {
    'page.title': '我的阅读记录',
    'language.label': '语言',
    'brand.home': '我的阅读记录首页',
    'brand.mark': '阅',
    'brand.title': '我的阅读记录',
    'brand.subtitle': 'Apple Books · 本地只读',
    'export.list': '导出列表',
    'hero.eyebrow': '阅读概览',
    'hero.title': '重新遇见读过的每一页',
    'hero.copy': '整理你的进度、高亮与笔记。所有内容只从本机数据库读取，不会上传。',
    'hero.mark': '书',
    'review.eyebrow': '重新发现',
    'review.title': '随机回顾',
    'review.notesOnly': '仅看笔记',
    'review.next': '换一条',
    'review.loading': '正在从旧时光里找一页…',
    'review.empty': '没有可回顾的划线或笔记',
    'stats.label': '阅读统计',
    'stats.allLabel': '查看全部藏书',
    'stats.readingLabel': '查看阅读中的书籍',
    'stats.finishedLabel': '查看已读完的书籍',
    'stats.library': '藏书',
    'unit.books': '本',
    'unit.items': '条',
    'annotation.highlight': '高亮',
    'annotation.note': '笔记',
    'annotation.underline': '下划线',
    'annotation.bookmark': '书签',
    'annotation.mark': '标记',
    'library.eyebrow': '书库',
    'library.title': '我的书库',
    'common.loading': '正在载入…',
    'common.close': '关闭',
    'search.label': '搜索',
    'search.placeholder': '搜索书名、作者或分类…',
    'filter.status': '阅读状态',
    'filter.year': '年份筛选',
    'filter.sort': '排序',
    'status.all': '全部状态',
    'status.finished': '已读完',
    'status.reading': '阅读中',
    'status.unread': '未开始',
    'status.unknown': '未知',
    'year.allFinished': '全部完成年份',
    'year.allCollected': '全部收集年份',
    'year.option': '{year} 年（{count} 本）',
    'year.finishedHint': '当前按完成日期筛选已读完书籍。',
    'year.collectionHint': '收集年份取数据库中购买、书库记录与创建日期的最早值，以减少迁移时间造成的偏差。',
    'sort.recent': '最近打开',
    'sort.progress': '阅读进度',
    'sort.title': '书名',
    'sort.author': '作者',
    'empty.title': '没有找到匹配的书',
    'empty.copy': '换一个关键词或筛选条件试试。',
    'pagination.label': '书库分页',
    'pagination.previous': '上一页',
    'pagination.next': '下一页',
    'duration.title': '关于阅读时长',
    'duration.copy': 'Apple Books 数据库没有保存每本书的累计阅读时长，因此本工具不会展示推测性时长。当前可准确读取进度、最后打开时间及批注历史。',
    'error.read': '读取数据失败',
    'books.loading': '正在整理书架…',
    'books.count': '共 {count} 本',
    'book.untitled': '未命名书籍',
    'book.unknownAuthor': '未知作者',
    'book.progressLabel': '阅读进度 {percent}%',
    'book.annotationCount': '{annotations} 条批注 · {notes} 条笔记',
    'book.lastOpened': '最后打开于 {date}',
    'book.noOpenTime': '没有打开时间',
    'detail.loading': '正在翻开这本书…',
    'detail.progress': '阅读进度',
    'detail.export': '导出本书高亮与笔记',
    'detail.collectedAt': '收集时间',
    'detail.lastOpenedAt': '最后打开',
    'detail.finishedAt': '完成时间',
    'detail.annotations': '批注',
    'detail.annotationsAndNotes': '批注与笔记',
    'detail.notePrefix': '笔记：',
    'detail.emptyTitle': '本机暂未发现这本书的高亮或笔记',
    'detail.emptyCopy': '书籍显示在书库中，并不代表其批注已经从 iCloud 同步到本机。如果这本书尚未下载，请先在 Apple Books 中下载并打开一次，等待同步完成后，再返回此处刷新页面。若仍未显示，请重启本工具后重试。',
    'source.purchase': '购买日期',
    'source.record': '书库记录日期',
    'source.creation': '数据库创建日期',
    'source.database': '数据库日期'
  },
  en: {
    'page.title': 'My Reading Archive',
    'language.label': 'Language',
    'brand.home': 'My Reading Archive home',
    'brand.mark': 'R',
    'brand.title': 'My Reading Archive',
    'brand.subtitle': 'Apple Books · Local, read-only',
    'export.list': 'Export CSV',
    'hero.eyebrow': 'READING OVERVIEW',
    'hero.title': 'Rediscover every page',
    'hero.copy': 'Organize your progress, highlights, and notes. Everything stays on this Mac and is never uploaded.',
    'hero.mark': 'B',
    'review.eyebrow': 'REDISCOVER',
    'review.title': 'Random review',
    'review.notesOnly': 'Notes only',
    'review.next': 'Show another',
    'review.loading': 'Finding a page from your reading past…',
    'review.empty': 'No highlights or notes are available for review',
    'stats.label': 'Reading statistics',
    'stats.allLabel': 'View all books',
    'stats.readingLabel': 'View books in progress',
    'stats.finishedLabel': 'View finished books',
    'stats.library': 'Library',
    'unit.books': 'books',
    'unit.items': 'items',
    'annotation.highlight': 'Highlights',
    'annotation.note': 'Notes',
    'annotation.underline': 'Underline',
    'annotation.bookmark': 'Bookmark',
    'annotation.mark': 'Mark',
    'library.eyebrow': 'LIBRARY',
    'library.title': 'My Library',
    'common.loading': 'Loading…',
    'common.close': 'Close',
    'search.label': 'Search',
    'search.placeholder': 'Search by title, author, or category…',
    'filter.status': 'Reading status',
    'filter.year': 'Year filter',
    'filter.sort': 'Sort order',
    'status.all': 'All statuses',
    'status.finished': 'Finished',
    'status.reading': 'Reading',
    'status.unread': 'Not started',
    'status.unknown': 'Unknown',
    'year.allFinished': 'All completion years',
    'year.allCollected': 'All collection years',
    'year.option': '{year} ({count} books)',
    'year.finishedHint': 'Finished books are currently filtered by their completion date.',
    'year.collectionHint': 'Collection year uses the earliest purchase, library-record, or creation date to reduce distortions caused by database migration.',
    'sort.recent': 'Recently opened',
    'sort.progress': 'Reading progress',
    'sort.title': 'Title',
    'sort.author': 'Author',
    'empty.title': 'No matching books',
    'empty.copy': 'Try a different search term or filter.',
    'pagination.label': 'Library pages',
    'pagination.previous': 'Previous',
    'pagination.next': 'Next',
    'duration.title': 'About reading time',
    'duration.copy': 'Apple Books does not store reliable cumulative reading time for each book, so this tool does not display estimates. It can accurately read progress, last-opened time, and annotation history.',
    'error.read': 'Unable to read data',
    'books.loading': 'Organizing your library…',
    'books.count': '{count} books',
    'book.untitled': 'Untitled book',
    'book.unknownAuthor': 'Unknown author',
    'book.progressLabel': 'Reading progress {percent}%',
    'book.annotationCount': '{annotations} annotations · {notes} notes',
    'book.lastOpened': 'Last opened {date}',
    'book.noOpenTime': 'No last-opened time',
    'detail.loading': 'Opening this book…',
    'detail.progress': 'Reading progress',
    'detail.export': 'Export highlights and notes',
    'detail.collectedAt': 'Collected',
    'detail.lastOpenedAt': 'Last opened',
    'detail.finishedAt': 'Finished',
    'detail.annotations': 'Annotations',
    'detail.annotationsAndNotes': 'Highlights and notes',
    'detail.notePrefix': 'Note: ',
    'detail.emptyTitle': 'No highlights or notes were found on this Mac',
    'detail.emptyCopy': 'A book appearing in your library does not mean its annotations have already synced from iCloud. If the book has not been downloaded, download and open it once in Apple Books, wait for syncing to finish, then refresh this page. If its annotations still do not appear, restart this tool and try again.',
    'source.purchase': 'Purchase date',
    'source.record': 'Library record date',
    'source.creation': 'Database creation date',
    'source.database': 'Database date'
  }
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
  statusFilters: document.querySelectorAll('[data-status-filter]'),
  languageButtons: document.querySelectorAll('[data-language]')
};

function initialLanguage() {
  try {
    const saved = window.localStorage.getItem('apple-books-language');
    if (saved === 'zh-CN' || saved === 'en') return saved;
  } catch (_) {
    // Language selection still works when local storage is unavailable.
  }
  return window.navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

function t(key, values = {}) {
  const template = translations[state.language][key] || translations['zh-CN'][key] || key;
  return Object.entries(values).reduce(
    (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
    template
  );
}

function displayLocale() {
  return state.language === 'en' ? 'en-US' : 'zh-CN';
}

function applyStaticTranslations() {
  document.documentElement.lang = state.language;
  document.querySelectorAll('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-aria-label]').forEach((node) => { node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel)); });
  elements.languageButtons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.language === state.language));
  });
}

function saveLanguage(language) {
  try {
    window.localStorage.setItem('apple-books-language', language);
  } catch (_) {
    // Keep the selection for this page even when local storage is unavailable.
  }
}

async function requestJSON(url) {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: t('error.read') }));
    if (state.language === 'en') {
      const message = response.status === 404 && url.startsWith('/api/review/random') ? t('review.empty') : t('error.read');
      throw new Error(message);
    }
    throw new Error(payload.error || t('error.read'));
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
    node.textContent = Number(summary[node.dataset.stat] || 0).toLocaleString(displayLocale());
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
  allYears.textContent = showsFinishedYears ? t('year.allFinished') : t('year.allCollected');
  elements.yearFilter.append(allYears);
  years.forEach(({ year, count }) => {
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = t('year.option', { year, count: count.toLocaleString(displayLocale()) });
    elements.yearFilter.append(option);
  });
  if (years.some(({ year }) => String(year) === previousValue)) elements.yearFilter.value = previousValue;
  elements.yearFilterHint.textContent = showsFinishedYears ? t('year.finishedHint') : t('year.collectionHint');
}

async function loadReview(key = dailyReviewKey()) {
  elements.newReview.disabled = true;
  elements.reviewContent.innerHTML = `<p class="review-loading">${t('review.loading')}</p>`;
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
      <button class="review-book-button" type="button">${escapeHTML(review.book.title || t('book.untitled'))}</button>
      <span>·</span><span>${escapeHTML(review.book.author || t('book.unknownAuthor'))}</span>
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
  elements.grid.innerHTML = `<div class="loading">${t('books.loading')}</div>`;
  elements.empty.hidden = true;
  try {
    const page = await requestJSON(`/api/books?${queryParameters()}`);
    state.total = page.total;
    renderBooks(page.items);
    updatePagination();
    elements.count.textContent = t('books.count', { count: page.total.toLocaleString(displayLocale()) });
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
      <h3>${escapeHTML(book.title || t('book.untitled'))}</h3>
      <p class="book-author">${escapeHTML(book.author || t('book.unknownAuthor'))}</p>
      <div class="book-bottom">
        <div class="book-meta"><span class="status">${statusText(book.status)}</span><span>${percent.toFixed(1)}%</span></div>
        <progress class="progress-track" max="100" value="${percent}" aria-label="${t('book.progressLabel', { percent: percent.toFixed(1) })}"></progress>
        <div class="annotation-count">${book.annotationCount ? t('book.annotationCount', { annotations: book.annotationCount, notes: book.noteCount }) : formatLastOpened(book.lastOpenedAt)}</div>
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
  elements.dialogContent.innerHTML = `<div class="loading">${t('detail.loading')}</div>`;
  if (!elements.dialog.open) elements.dialog.showModal();
  try {
    const [book, annotations] = await Promise.all([
      requestJSON(`/api/books/${id}`), requestJSON(`/api/books/${id}/annotations`)
    ]);
    state.bookDetail = { book, annotations: annotations.items };
    renderBookDetail(book, annotations.items);
  } catch (error) {
    state.bookDetail = null;
    elements.dialog.close();
    showToast(error.message);
  }
}

function renderBookDetail(book, annotations) {
  const percent = Math.max(0, Math.min(100, book.progress * 100));
  const annotationHTML = annotations.length
    ? annotations.map((annotation) => `
      <article class="annotation">
        ${annotation.selectedText ? `<blockquote>“${escapeHTML(annotation.selectedText)}”</blockquote>` : `<blockquote>${t('annotation.bookmark')}</blockquote>`}
        ${annotation.note ? `<p class="annotation-note">${t('detail.notePrefix')}${escapeHTML(annotation.note)}</p>` : ''}
        <p class="annotation-time">${annotationTypeText(annotation)} · ${formatDate(annotation.createdAt)}</p>
      </article>`).join('')
    : `<div class="annotation-empty" role="status">
        <strong>${t('detail.emptyTitle')}</strong>
        <p>${t('detail.emptyCopy')}</p>
      </div>`;
  elements.dialogContent.innerHTML = `
    <header class="detail-header">
      <p class="eyebrow">${statusText(book.status)}</p>
      <h2>${escapeHTML(book.title || t('book.untitled'))}</h2>
      <p class="detail-author">${escapeHTML(book.author || t('book.unknownAuthor'))}</p>
      <div class="detail-progress"><span>${t('detail.progress')}</span><strong>${percent.toFixed(1)}%</strong>
        <progress class="progress-track" max="100" value="${percent}" aria-label="${t('book.progressLabel', { percent: percent.toFixed(1) })}"></progress>
      </div>
      <a class="detail-export" href="/api/books/${book.id}/annotations.md" download>${t('detail.export')}</a>
    </header>
    <div class="detail-facts">
      <div><span>${t('detail.collectedAt')}</span>${formatDate(book.collectedAt)}${book.collectionSource ? ` · ${collectionSourceText(book.collectionSource)}` : ''}</div>
      <div><span>${t('detail.lastOpenedAt')}</span>${formatDate(book.lastOpenedAt)}</div>
      <div><span>${t('detail.finishedAt')}</span>${formatDate(book.finishedAt)}</div>
      <div><span>${t('detail.annotations')}</span>${book.annotationCount.toLocaleString(displayLocale())}</div>
    </div>
    ${book.description ? `<p class="detail-description">${escapeHTML(book.description)}</p>` : ''}
    <section class="annotations"><h3>${t('detail.annotationsAndNotes')}</h3>${annotationHTML}</section>`;
}

function statusText(status) {
  return ({ finished: t('status.finished'), reading: t('status.reading'), unread: t('status.unread') })[status] || t('status.unknown');
}

function annotationTypeText(annotation) {
  if (annotation.note) return t('annotation.note');
  if (annotation.isUnderline) return t('annotation.underline');
  return ({ highlight: t('annotation.highlight'), bookmark: t('annotation.bookmark'), other: t('annotation.mark') })[annotation.type] || t('annotation.mark');
}

function collectionSourceText(source) {
  return ({ purchase: t('source.purchase'), record: t('source.record'), creation: t('source.creation') })[source] || t('source.database');
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(displayLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function formatLastOpened(value) {
  return value ? t('book.lastOpened', { date: formatDate(value) }) : t('book.noOpenTime');
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

function changeLanguage(language) {
  if (language !== 'zh-CN' && language !== 'en') return;
  state.language = language;
  saveLanguage(language);
  applyStaticTranslations();
  updateYearOptions();
  if (elements.dialog.open && state.bookDetail) {
    renderBookDetail(state.bookDetail.book, state.bookDetail.annotations);
  }
  Promise.all([loadSummary(), loadReview(), loadBooks()]).catch((error) => showToast(error.message));
}

function closeBookDialog() {
  state.bookDetail = null;
  elements.dialog.close();
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
elements.languageButtons.forEach((button) => button.addEventListener('click', () => changeLanguage(button.dataset.language)));
elements.newReview.addEventListener('click', () => loadReview(newReviewKey()));
elements.reviewNotesOnly.addEventListener('change', () => loadReview());
elements.previous.addEventListener('click', () => { state.offset = Math.max(0, state.offset - state.limit); loadBooks(); scrollToLibrary(); });
elements.next.addEventListener('click', () => { state.offset += state.limit; loadBooks(); scrollToLibrary(); });
document.querySelector('#dialog-close').addEventListener('click', closeBookDialog);
elements.dialog.addEventListener('click', (event) => { if (event.target === elements.dialog) closeBookDialog(); });

function scrollToLibrary() { document.querySelector('.library-section').scrollIntoView({ behavior: 'smooth' }); }

applyStaticTranslations();
Promise.all([loadSummary(), loadReview(), loadBooks()]).catch((error) => showToast(error.message));
