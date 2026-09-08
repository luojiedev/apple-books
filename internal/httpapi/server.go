package httpapi

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"apple-books/internal/domain"
	"apple-books/internal/store"
	"apple-books/internal/web"

	log "github.com/luojiedev/slogx"
)

type Server struct {
	reader  store.Reader
	handler http.Handler
}

func New(reader store.Reader) (*Server, error) {
	staticFiles, err := fs.Sub(web.Assets, "static")
	if err != nil {
		return nil, fmt.Errorf("prepare static files: %w", err)
	}

	server := &Server{reader: reader}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", server.health)
	mux.HandleFunc("GET /api/summary", server.summary)
	mux.HandleFunc("GET /api/review/random", server.randomReview)
	mux.HandleFunc("GET /api/books/pick", server.randomBook)
	mux.HandleFunc("GET /api/books", server.books)
	mux.HandleFunc("GET /api/want-to-read", server.wantToRead)
	mux.HandleFunc("GET /api/annotations", server.searchAnnotations)
	mux.HandleFunc("GET /api/reports/year", server.yearReport)
	mux.HandleFunc("GET /api/books/{id}", server.book)
	mux.HandleFunc("GET /api/books/{id}/annotations", server.annotations)
	mux.HandleFunc("GET /api/books/{id}/annotations.md", server.exportBookAnnotations)
	mux.HandleFunc("GET /api/export/books.csv", server.exportBooks)
	mux.Handle("GET /", http.FileServerFS(staticFiles))
	server.handler = securityHeaders(localRequestsOnly(requestLogger(mux)))
	return server, nil
}

func (s *Server) Handler() http.Handler {
	return s.handler
}

func (s *Server) health(response http.ResponseWriter, _ *http.Request) {
	writeJSON(response, http.StatusOK, map[string]string{"status": "ok"})
}

func (s *Server) summary(response http.ResponseWriter, request *http.Request) {
	summary, err := s.reader.Summary(request.Context())
	if err != nil {
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, summary)
}

func (s *Server) randomReview(response http.ResponseWriter, request *http.Request) {
	key := strings.TrimSpace(request.URL.Query().Get("key"))
	if key == "" || len(key) > 128 {
		writeClientError(response, "回顾 key 不能为空且不能超过 128 个字符")
		return
	}
	kind := request.URL.Query().Get("kind")
	if kind != "" && kind != "all" && kind != "note" {
		writeClientError(response, "不支持的回顾类型")
		return
	}
	review, err := s.reader.RandomReview(request.Context(), key, kind == "note")
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(response, http.StatusNotFound, errorResponse{Error: "没有可回顾的划线或笔记"})
			return
		}
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, review)
}

func (s *Server) randomBook(response http.ResponseWriter, request *http.Request) {
	key := strings.TrimSpace(request.URL.Query().Get("key"))
	if key == "" || len(key) > 128 {
		writeClientError(response, "选书 key 不能为空且不能超过 128 个字符")
		return
	}
	mode := request.URL.Query().Get("mode")
	if mode == "" {
		mode = "unread"
	}
	if mode != "unread" && mode != "stalled" && mode != "any" {
		writeClientError(response, "不支持的选书模式")
		return
	}
	book, err := s.reader.RandomBook(request.Context(), key, mode)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(response, http.StatusNotFound, errorResponse{Error: "没有符合条件的书"})
			return
		}
		writeError(response, err)
		return
	}
	log.Debug("book picker selected a candidate", "mode", mode, "book_id", book.ID)
	writeJSON(response, http.StatusOK, book)
}

func (s *Server) searchAnnotations(response http.ResponseWriter, request *http.Request) {
	query, err := parseAnnotationQuery(request)
	if err != nil {
		writeClientError(response, err.Error())
		return
	}
	page, err := s.reader.SearchAnnotations(request.Context(), query)
	if err != nil {
		writeError(response, err)
		return
	}
	log.Debug("annotation search completed", "kind", query.Kind, "style", query.Style, "total", page.Total)
	writeJSON(response, http.StatusOK, page)
}

func (s *Server) yearReport(response http.ResponseWriter, request *http.Request) {
	year, err := optionalYear(request.URL.Query().Get("year"))
	if err != nil || year == 0 {
		writeClientError(response, "报告年份必须是 1900 到 3000 之间的整数")
		return
	}
	report, err := s.reader.YearReport(request.Context(), year)
	if err != nil {
		writeError(response, err)
		return
	}
	log.Debug("year report generated", "year", year, "annotations", report.AnnotationCount, "active_days", report.ActiveDays)
	writeJSON(response, http.StatusOK, report)
}

func (s *Server) books(response http.ResponseWriter, request *http.Request) {
	query, err := parseBookQuery(request)
	if err != nil {
		writeClientError(response, err.Error())
		return
	}
	page, err := s.reader.Books(request.Context(), query)
	if err != nil {
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, page)
}

func (s *Server) wantToRead(response http.ResponseWriter, request *http.Request) {
	limit, offset, err := parsePagination(request, 24)
	if err != nil {
		writeClientError(response, err.Error())
		return
	}
	page, err := s.reader.WantToRead(request.Context(), limit, offset)
	if err != nil {
		writeError(response, err)
		return
	}
	log.Debug("want-to-read collection loaded", "total", page.Total, "limit", limit, "offset", offset)
	writeJSON(response, http.StatusOK, page)
}

func (s *Server) book(response http.ResponseWriter, request *http.Request) {
	id, err := parseID(request.PathValue("id"))
	if err != nil {
		writeClientError(response, "无效的书籍 ID")
		return
	}
	book, err := s.reader.Book(request.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(response, http.StatusNotFound, errorResponse{Error: "没有找到这本书"})
			return
		}
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, book)
}

func (s *Server) annotations(response http.ResponseWriter, request *http.Request) {
	id, err := parseID(request.PathValue("id"))
	if err != nil {
		writeClientError(response, "无效的书籍 ID")
		return
	}
	book, err := s.reader.Book(request.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeJSON(response, http.StatusNotFound, errorResponse{Error: "没有找到这本书"})
			return
		}
		writeError(response, err)
		return
	}
	annotations, err := s.reader.Annotations(request.Context(), book.AssetID)
	if err != nil {
		writeError(response, err)
		return
	}
	writeJSON(response, http.StatusOK, map[string]any{"items": annotations, "total": len(annotations)})
}

func (s *Server) exportBooks(response http.ResponseWriter, request *http.Request) {
	query, err := parseBookQuery(request)
	if err != nil {
		writeClientError(response, err.Error())
		return
	}
	query.Limit = 10000
	query.Offset = 0
	page, err := s.reader.Books(request.Context(), query)
	if err != nil {
		writeError(response, err)
		return
	}

	response.Header().Set("Content-Type", "text/csv; charset=utf-8")
	response.Header().Set("Content-Disposition", `attachment; filename="apple-books.csv"`)
	_, _ = response.Write([]byte{0xEF, 0xBB, 0xBF})
	writer := csv.NewWriter(response)
	if err := writer.Write([]string{"书名", "作者", "状态", "进度", "收集时间", "收集时间来源", "最后打开", "完成时间", "批注数", "笔记数", "分类", "语言"}); err != nil {
		log.Error("write CSV header failed", "error", err)
		return
	}
	for _, book := range page.Items {
		record := []string{
			book.Title, book.Author, localizedStatus(book.Status), fmt.Sprintf("%.2f%%", book.Progress*100),
			formatTime(book.CollectedAt), localizedCollectionSource(book.CollectionSource),
			formatTime(book.LastOpenedAt), formatTime(book.FinishedAt), strconv.FormatInt(book.AnnotationCount, 10),
			strconv.FormatInt(book.NoteCount, 10), book.Genre, book.Language,
		}
		for index := range record {
			record[index] = safeCSVCell(record[index])
		}
		if err := writer.Write(record); err != nil {
			log.Error("write CSV record failed", "error", err, "book_id", book.ID)
			return
		}
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		log.Error("flush CSV failed", "error", err)
	}
}

func parseBookQuery(request *http.Request) (domain.BookQuery, error) {
	values := request.URL.Query()
	limit, offset, err := parsePagination(request, 24)
	if err != nil {
		return domain.BookQuery{}, err
	}
	status := values.Get("status")
	if status != "" && status != "all" && status != "unread" && status != "reading" && status != "finished" {
		return domain.BookQuery{}, fmt.Errorf("不支持的阅读状态")
	}
	sort := values.Get("sort")
	if sort != "" && sort != "recent" && sort != "progress" && sort != "title" && sort != "author" {
		return domain.BookQuery{}, fmt.Errorf("不支持的排序方式")
	}
	finishedYear, err := optionalYear(values.Get("finishedYear"))
	if err != nil {
		return domain.BookQuery{}, fmt.Errorf("完成年份必须是 1900 到 3000 之间的整数")
	}
	collectionYear, err := optionalYear(values.Get("collectionYear"))
	if err != nil {
		return domain.BookQuery{}, fmt.Errorf("收集年份必须是 1900 到 3000 之间的整数")
	}
	if finishedYear > 0 && collectionYear > 0 {
		return domain.BookQuery{}, fmt.Errorf("完成年份和收集年份不能同时筛选")
	}
	return domain.BookQuery{
		Search: strings.TrimSpace(values.Get("q")), Status: status, Sort: sort,
		FinishedYear: finishedYear, CollectionYear: collectionYear, Limit: limit, Offset: offset,
	}, nil
}

func parsePagination(request *http.Request, defaultLimit int) (int, int, error) {
	values := request.URL.Query()
	limit, err := boundedInt(values.Get("limit"), defaultLimit, 1, 100)
	if err != nil {
		return 0, 0, fmt.Errorf("limit 必须是 1 到 100 之间的整数")
	}
	offset, err := boundedInt(values.Get("offset"), 0, 0, 1_000_000)
	if err != nil {
		return 0, 0, fmt.Errorf("offset 必须是非负整数")
	}
	return limit, offset, nil
}

func parseAnnotationQuery(request *http.Request) (domain.AnnotationQuery, error) {
	values := request.URL.Query()
	limit, err := boundedInt(values.Get("limit"), 20, 1, 100)
	if err != nil {
		return domain.AnnotationQuery{}, fmt.Errorf("limit 必须是 1 到 100 之间的整数")
	}
	offset, err := boundedInt(values.Get("offset"), 0, 0, 1_000_000)
	if err != nil {
		return domain.AnnotationQuery{}, fmt.Errorf("offset 必须是非负整数")
	}
	kind := values.Get("kind")
	if kind != "" && kind != "all" && kind != "highlight" && kind != "note" && kind != "bookmark" {
		return domain.AnnotationQuery{}, fmt.Errorf("不支持的批注类型")
	}
	style := -1
	if rawStyle := values.Get("style"); rawStyle != "" {
		style, err = boundedInt(rawStyle, -1, 0, 20)
		if err != nil {
			return domain.AnnotationQuery{}, fmt.Errorf("高亮样式必须是 0 到 20 之间的整数")
		}
	}
	search := strings.TrimSpace(values.Get("q"))
	if len(search) > 200 {
		return domain.AnnotationQuery{}, fmt.Errorf("搜索内容不能超过 200 个字符")
	}
	return domain.AnnotationQuery{Search: search, Kind: kind, Style: style, Limit: limit, Offset: offset}, nil
}

func optionalYear(raw string) (int, error) {
	if raw == "" {
		return 0, nil
	}
	year, err := strconv.Atoi(raw)
	if err != nil || year < 1900 || year > 3000 {
		return 0, errors.New("invalid year")
	}
	return year, nil
}

func boundedInt(raw string, defaultValue, minimum, maximum int) (int, error) {
	if raw == "" {
		return defaultValue, nil
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < minimum || value > maximum {
		return 0, errors.New("value is outside the allowed range")
	}
	return value, nil
}

func parseID(value string) (int64, error) {
	id, err := strconv.ParseInt(value, 10, 64)
	if err != nil || id <= 0 {
		return 0, errors.New("invalid ID")
	}
	return id, nil
}

type errorResponse struct {
	Error string `json:"error"`
}

func writeClientError(response http.ResponseWriter, message string) {
	writeJSON(response, http.StatusBadRequest, errorResponse{Error: message})
}

func writeError(response http.ResponseWriter, err error) {
	log.Error("HTTP request failed", "error", err)
	writeJSON(response, http.StatusInternalServerError, errorResponse{Error: "读取 Apple Books 数据失败，请查看日志"})
}

func writeJSON(response http.ResponseWriter, status int, value any) {
	response.Header().Set("Content-Type", "application/json; charset=utf-8")
	response.WriteHeader(status)
	if err := json.NewEncoder(response).Encode(value); err != nil {
		log.Error("encode JSON response failed", "error", err)
	}
}

func requestLogger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		startedAt := time.Now()
		next.ServeHTTP(response, request)
		log.Debug("HTTP request completed", "method", request.Method, "path", request.URL.Path, "duration", time.Since(startedAt))
	})
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.Header().Set("Cache-Control", "no-store")
		response.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
		response.Header().Set("Referrer-Policy", "no-referrer")
		response.Header().Set("X-Content-Type-Options", "nosniff")
		response.Header().Set("X-Frame-Options", "DENY")
		next.ServeHTTP(response, request)
	})
}

func localRequestsOnly(next http.Handler) http.Handler {
	return http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		host := request.Host
		if parsedHost, _, err := net.SplitHostPort(request.Host); err == nil {
			host = parsedHost
		}
		host = strings.Trim(host, "[]")
		address := net.ParseIP(host)
		if !strings.EqualFold(host, "localhost") && (address == nil || !address.IsLoopback()) {
			writeJSON(response, http.StatusMisdirectedRequest, errorResponse{Error: "只接受来自本机回环地址的请求"})
			return
		}
		next.ServeHTTP(response, request)
	})
}

func safeCSVCell(value string) string {
	if value == "" {
		return value
	}
	first := value[0]
	if first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r' {
		return "'" + value
	}
	return value
}

func localizedStatus(status string) string {
	switch status {
	case "finished":
		return "已读完"
	case "reading":
		return "阅读中"
	default:
		return "未开始"
	}
}

func localizedCollectionSource(source string) string {
	switch source {
	case "purchase":
		return "购买日期"
	case "record":
		return "书库记录日期（估算）"
	case "creation":
		return "数据库创建日期（估算）"
	default:
		return ""
	}
}

func formatTime(value *time.Time) string {
	if value == nil {
		return ""
	}
	return value.Format("2006-01-02 15:04:05")
}
