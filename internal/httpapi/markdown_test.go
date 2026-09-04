package httpapi

import (
	"strings"
	"testing"
	"time"

	"apple-books/internal/domain"
	"apple-books/internal/epub"
)

type chapterFixture map[string]epub.Chapter

func (fixture chapterFixture) Lookup(location string) (epub.Chapter, bool) {
	chapter, exists := fixture[location]
	return chapter, exists
}

func TestRenderBookAnnotationsMarkdownGroupsAnnotationsByChapter(t *testing.T) {
	createdAt := time.Date(2024, time.July, 1, 12, 30, 0, 0, time.Local)
	annotations := []domain.Annotation{
		{Location: "later", SelectedText: "第二条摘录", CreatedAt: &createdAt},
		{Location: "earlier", SelectedText: "第一条摘录", Note: "我的想法", CreatedAt: &createdAt},
		{Location: "bookmark", Type: "bookmark"},
	}
	chapters := chapterFixture{
		"earlier": {Title: "第一章", Order: 1},
		"later":   {Title: "第二章", Order: 2},
	}

	output := renderBookAnnotationsMarkdown(domain.Book{Title: "测试书", Author: "作者"}, annotations, chapters)
	if !strings.Contains(output, "## 第一章") || !strings.Contains(output, "## 第二章") {
		t.Fatalf("chapter headings are missing:\n%s", output)
	}
	if strings.Index(output, "## 第一章") > strings.Index(output, "## 第二章") {
		t.Fatalf("chapters are not in reading order:\n%s", output)
	}
	if !strings.Contains(output, "> 第一条摘录") || !strings.Contains(output, "**笔记：** 我的想法") {
		t.Fatalf("annotation content is missing:\n%s", output)
	}
	if !strings.Contains(output, "高亮与笔记：2 条") {
		t.Fatalf("empty bookmark should not be exported:\n%s", output)
	}
}

func TestExportFilenameIsSafe(t *testing.T) {
	filename := exportFilename("目录/书名\n测试", 1)
	if strings.ContainsAny(filename, "/\n\r\t") || !strings.HasSuffix(filename, ".md") {
		t.Fatalf("unexpected filename: %q", filename)
	}
}

func TestMarkdownTextEscapesEmbeddedHTML(t *testing.T) {
	output := markdownText(`<img src="https://example.com/track">`)
	if strings.Contains(output, "<img") || !strings.Contains(output, "&lt;img") {
		t.Fatalf("embedded HTML was not escaped: %q", output)
	}
}
