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

	output := renderBookAnnotationsMarkdown(domain.Book{Title: "测试书", Author: "作者"}, annotations, chapters, annotationExportOptions{})
	if !strings.Contains(output, "## 第一章") || !strings.Contains(output, "## 第二章") {
		t.Fatalf("chapter headings are missing:\n%s", output)
	}
	if strings.Index(output, "## 第一章") > strings.Index(output, "## 第二章") {
		t.Fatalf("chapters are not in reading order:\n%s", output)
	}
	if !strings.Contains(output, "第一条摘录") || !strings.Contains(output, "**笔记：** 我的想法") {
		t.Fatalf("annotation content is missing:\n%s", output)
	}
	if !strings.Contains(output, "高亮与笔记：2 条") {
		t.Fatalf("empty bookmark should not be exported:\n%s", output)
	}
}

func TestRenderBookAnnotationsMarkdownMetadataOption(t *testing.T) {
	createdAt := time.Date(2024, time.June, 19, 21, 18, 0, 0, time.Local)
	annotations := []domain.Annotation{
		{SelectedText: "摘录正文", CreatedAt: &createdAt},
		{Note: "笔记正文", CreatedAt: &createdAt},
		{SelectedText: "划线正文", IsUnderline: true},
	}
	for _, showMetadata := range []bool{false, true} {
		output := renderBookAnnotationsMarkdown(domain.Book{Title: "测试书"}, annotations, nil, annotationExportOptions{ShowMetadata: showMetadata})
		for _, metadata := range []string{"### 高亮 · 2024-06-19 21:18", "### 笔记 · 2024-06-19 21:18", "### 下划线\n"} {
			if strings.Contains(output, metadata) != showMetadata {
				t.Fatalf("showMetadata=%v: unexpected metadata %q:\n%s", showMetadata, metadata, output)
			}
		}
		for _, content := range []string{"摘录正文", "**笔记：** 笔记正文", "划线正文"} {
			if !strings.Contains(output, content) {
				t.Fatalf("showMetadata=%v: missing content %q:\n%s", showMetadata, content, output)
			}
		}
	}
}

func TestRenderBookAnnotationsMarkdownLinesOption(t *testing.T) {
	annotations := []domain.Annotation{
		{SelectedText: "第一条摘录\n第二行"},
		{SelectedText: "第二条摘录", Note: "我的想法"},
	}
	for _, showMetadata := range []bool{false, true} {
		for _, showLines := range []bool{false, true} {
			output := renderBookAnnotationsMarkdown(domain.Book{Title: "测试书"}, annotations, nil, annotationExportOptions{ShowMetadata: showMetadata, ShowLines: showLines})
			for _, marker := range []string{"> 第一条摘录\n> 第二行", "\n---\n"} {
				if strings.Contains(output, marker) != showLines {
					t.Fatalf("showMetadata=%v, showLines=%v: unexpected marker %q:\n%s", showMetadata, showLines, marker, output)
				}
			}
			if !showLines && !strings.Contains(output, "第一条摘录\n第二行\n\n") {
				t.Fatalf("plain paragraph or spacing is missing:\n%s", output)
			}
			if !strings.Contains(output, "第二条摘录") || !strings.Contains(output, "**笔记：** 我的想法") {
				t.Fatalf("annotation content is missing:\n%s", output)
			}
		}
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
