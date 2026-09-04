package httpapi

import (
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"apple-books/internal/domain"
	"apple-books/internal/epub"
	"apple-books/internal/store"

	log "github.com/luojiedev/slogx"
)

func (s *Server) exportBookAnnotations(response http.ResponseWriter, request *http.Request) {
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

	var chapters chapterResolver
	if book.SourcePath != "" {
		resolver, resolveErr := epub.Open(book.SourcePath)
		err = resolveErr
		if err != nil {
			log.Debug("EPUB chapter lookup unavailable", "book_id", book.ID, "error", err)
		} else {
			chapters = resolver
		}
	}
	content := renderBookAnnotationsMarkdown(book, annotations, chapters)
	filename := url.PathEscape(exportFilename(book.Title, book.ID))
	response.Header().Set("Content-Type", "text/markdown; charset=utf-8")
	response.Header().Set("Content-Disposition", "attachment; filename*=UTF-8''"+filename)
	if _, err := response.Write([]byte(content)); err != nil {
		log.Error("write book annotation export failed", "book_id", book.ID, "error", err)
	}
}

type exportAnnotation struct {
	annotation domain.Annotation
	chapter    epub.Chapter
	resolved   bool
}

type chapterResolver interface {
	Lookup(location string) (epub.Chapter, bool)
}

func renderBookAnnotationsMarkdown(book domain.Book, annotations []domain.Annotation, chapters chapterResolver) string {
	items := make([]exportAnnotation, 0, len(annotations))
	for _, annotation := range annotations {
		if strings.TrimSpace(annotation.SelectedText) == "" && strings.TrimSpace(annotation.Note) == "" {
			continue
		}
		item := exportAnnotation{annotation: annotation}
		if chapters != nil {
			item.chapter, item.resolved = chapters.Lookup(annotation.Location)
		}
		items = append(items, item)
	}
	sort.SliceStable(items, func(left, right int) bool {
		if items[left].resolved != items[right].resolved {
			return items[left].resolved
		}
		if items[left].chapter.Order != items[right].chapter.Order {
			return items[left].chapter.Order < items[right].chapter.Order
		}
		return items[left].annotation.Location < items[right].annotation.Location
	})

	var output strings.Builder
	fmt.Fprintf(&output, "# %s\n\n", markdownInline(book.Title))
	fmt.Fprintf(&output, "- 作者：%s\n", markdownInline(valueOrFallback(book.Author, "未知作者")))
	fmt.Fprintf(&output, "- 导出时间：%s\n", time.Now().Format("2006-01-02 15:04:05"))
	fmt.Fprintf(&output, "- 高亮与笔记：%d 条\n", len(items))
	if chapters == nil {
		output.WriteString("- 章节信息：原始 EPUB 不可用，无法解析章节标题\n")
	} else {
		output.WriteString("- 章节信息：从本机 EPUB 目录解析\n")
	}

	currentChapter := ""
	for _, item := range items {
		chapterTitle := "未识别章节"
		if item.resolved {
			chapterTitle = item.chapter.Title
		}
		if chapterTitle != currentChapter {
			fmt.Fprintf(&output, "\n## %s\n\n", markdownInline(chapterTitle))
			currentChapter = chapterTitle
		}

		annotation := item.annotation
		fmt.Fprintf(&output, "### %s", annotationExportType(annotation))
		if annotation.CreatedAt != nil {
			fmt.Fprintf(&output, " · %s", annotation.CreatedAt.Format("2006-01-02 15:04"))
		}
		output.WriteString("\n\n")
		if strings.TrimSpace(annotation.SelectedText) != "" {
			output.WriteString(markdownQuote(annotation.SelectedText))
			output.WriteString("\n\n")
		}
		if strings.TrimSpace(annotation.Note) != "" {
			fmt.Fprintf(&output, "**笔记：** %s\n\n", markdownText(strings.TrimSpace(annotation.Note)))
		}
		if !item.resolved && annotation.Location != "" {
			fmt.Fprintf(&output, "`位置：%s`\n\n", strings.ReplaceAll(annotation.Location, "`", ""))
		}
		output.WriteString("---\n")
	}
	return output.String()
}

func annotationExportType(annotation domain.Annotation) string {
	if annotation.Note != "" && annotation.SelectedText == "" {
		return "笔记"
	}
	if annotation.IsUnderline {
		return "下划线"
	}
	if annotation.Note != "" {
		return "高亮与笔记"
	}
	return "高亮"
}

func markdownQuote(value string) string {
	lines := strings.Split(strings.ReplaceAll(strings.TrimSpace(value), "\r\n", "\n"), "\n")
	for index, line := range lines {
		lines[index] = "> " + markdownText(line)
	}
	return strings.Join(lines, "\n")
}

func markdownInline(value string) string {
	value = markdownText(strings.Join(strings.Fields(value), " "))
	replacer := strings.NewReplacer("\\", "\\\\", "*", "\\*", "_", "\\_", "[", "\\[", "]", "\\]", "#", "\\#")
	return replacer.Replace(value)
}

func markdownText(value string) string {
	replacer := strings.NewReplacer("&", "&amp;", "<", "&lt;", ">", "&gt;")
	return replacer.Replace(value)
}

func valueOrFallback(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func exportFilename(title string, id int64) string {
	title = strings.TrimSpace(title)
	if title == "" {
		title = fmt.Sprintf("book-%d", id)
	}
	for _, character := range []string{"/", "\\", ":", "\n", "\r", "\t"} {
		title = strings.ReplaceAll(title, character, "-")
	}
	if len([]rune(title)) > 80 {
		title = string([]rune(title)[:80])
	}
	return title + "-高亮与笔记.md"
}
