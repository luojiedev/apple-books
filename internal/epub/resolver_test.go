package epub

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolverMapsSpineLocationsToChapterTitles(t *testing.T) {
	directory := t.TempDir()
	writeFixture(t, filepath.Join(directory, "META-INF", "container.xml"), `
		<container><rootfiles><rootfile full-path="OPS/content.opf"/></rootfiles></container>`)
	writeFixture(t, filepath.Join(directory, "OPS", "content.opf"), `
		<package><manifest>
			<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
			<item id="chapter-one" href="one.xhtml" media-type="application/xhtml+xml"/>
			<item id="chapter-one-cont" href="one-continued.xhtml" media-type="application/xhtml+xml"/>
			<item id="chapter-two" href="two.xhtml" media-type="application/xhtml+xml"/>
		</manifest><spine toc="toc">
			<itemref idref="chapter-one"/><itemref idref="chapter-one-cont"/><itemref idref="chapter-two"/>
		</spine></package>`)
	writeFixture(t, filepath.Join(directory, "OPS", "toc.ncx"), `
		<ncx><navMap>
			<navPoint><navLabel><text>第一章 开始</text></navLabel><content src="one.xhtml"/></navPoint>
			<navPoint><navLabel><text>第二章 继续</text></navLabel><content src="two.xhtml"/></navPoint>
		</navMap></ncx>`)

	resolver, err := Open(directory)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	tests := []struct {
		location string
		want     string
	}{
		{location: "epubcfi(/6/2[chapter-one]!/4/2:0)", want: "第一章 开始"},
		{location: "epubcfi(/6/4[chapter-one-cont]!/4/2:0)", want: "第一章 开始"},
		{location: "epubcfi(/6/6!/4/2:0)", want: "第二章 继续"},
	}
	for _, test := range tests {
		chapter, exists := resolver.Lookup(test.location)
		if !exists || chapter.Title != test.want {
			t.Fatalf("Lookup(%q) = %+v, %v; want %q", test.location, chapter, exists, test.want)
		}
	}
}

func writeFixture(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("create fixture directory: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
}
