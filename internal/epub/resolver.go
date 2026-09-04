package epub

import (
	"archive/zip"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path"
	"regexp"
	"strconv"
	"strings"
)

var spineLocationPattern = regexp.MustCompile(`^epubcfi\(/6/(\d+)(?:\[([^\]]+)\])?`)

type Chapter struct {
	Title string
	Order int
}

type Resolver struct {
	byID    map[string]Chapter
	byOrder map[int]Chapter
}

func Open(sourcePath string) (*Resolver, error) {
	if strings.TrimSpace(sourcePath) == "" {
		return nil, errors.New("book source path is empty")
	}
	info, err := os.Stat(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("inspect EPUB: %w", err)
	}
	if info.IsDir() {
		return load(os.DirFS(sourcePath))
	}

	archive, err := zip.OpenReader(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("open EPUB archive: %w", err)
	}
	defer archive.Close()
	return load(&archive.Reader)
}

func (r *Resolver) Lookup(location string) (Chapter, bool) {
	matches := spineLocationPattern.FindStringSubmatch(location)
	if len(matches) == 0 {
		return Chapter{}, false
	}
	if matches[2] != "" {
		if chapter, exists := r.byID[matches[2]]; exists {
			return chapter, true
		}
	}
	spineStep, err := strconv.Atoi(matches[1])
	if err != nil || spineStep < 2 || spineStep%2 != 0 {
		return Chapter{}, false
	}
	chapter, exists := r.byOrder[spineStep/2-1]
	return chapter, exists
}

type containerDocument struct {
	RootFiles []struct {
		FullPath string `xml:"full-path,attr"`
	} `xml:"rootfiles>rootfile"`
}

type packageDocument struct {
	Manifest struct {
		Items []manifestItem `xml:"item"`
	} `xml:"manifest"`
	Spine struct {
		TOC      string      `xml:"toc,attr"`
		ItemRefs []spineItem `xml:"itemref"`
	} `xml:"spine"`
}

type manifestItem struct {
	ID         string `xml:"id,attr"`
	Href       string `xml:"href,attr"`
	MediaType  string `xml:"media-type,attr"`
	Properties string `xml:"properties,attr"`
}

type spineItem struct {
	ID    string `xml:"id,attr"`
	IDRef string `xml:"idref,attr"`
}

func load(files fs.FS) (*Resolver, error) {
	opfPath, err := packagePath(files)
	if err != nil {
		return nil, err
	}
	var publication packageDocument
	if err := readXML(files, opfPath, &publication); err != nil {
		return nil, fmt.Errorf("read EPUB package: %w", err)
	}

	manifest := make(map[string]manifestItem, len(publication.Manifest.Items))
	var navigation manifestItem
	for _, item := range publication.Manifest.Items {
		manifest[item.ID] = item
		if item.ID == publication.Spine.TOC || item.MediaType == "application/x-dtbncx+xml" || hasWord(item.Properties, "nav") {
			navigation = item
		}
	}
	if navigation.Href == "" {
		return nil, errors.New("EPUB table of contents is missing")
	}

	opfDirectory := path.Dir(opfPath)
	navigationPath := resolvePath(opfDirectory, navigation.Href)
	titles, err := navigationTitles(files, navigationPath, hasWord(navigation.Properties, "nav"))
	if err != nil {
		return nil, err
	}

	resolver := &Resolver{byID: make(map[string]Chapter), byOrder: make(map[int]Chapter)}
	var currentTitle string
	for order, reference := range publication.Spine.ItemRefs {
		item, exists := manifest[reference.IDRef]
		if !exists {
			continue
		}
		itemPath := resolvePath(opfDirectory, item.Href)
		if title := titles[itemPath]; title != "" {
			currentTitle = title
		}
		if currentTitle == "" {
			continue
		}
		chapter := Chapter{Title: currentTitle, Order: order}
		resolver.byID[reference.IDRef] = chapter
		if reference.ID != "" {
			resolver.byID[reference.ID] = chapter
		}
		resolver.byOrder[order] = chapter
	}
	if len(resolver.byOrder) == 0 {
		return nil, errors.New("EPUB chapters could not be mapped to its spine")
	}
	return resolver, nil
}

func packagePath(files fs.FS) (string, error) {
	var container containerDocument
	if err := readXML(files, "META-INF/container.xml", &container); err == nil && len(container.RootFiles) > 0 {
		return path.Clean(container.RootFiles[0].FullPath), nil
	}
	var found string
	err := fs.WalkDir(files, ".", func(filePath string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if !entry.IsDir() && strings.EqualFold(path.Ext(filePath), ".opf") {
			found = filePath
			return fs.SkipAll
		}
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("search EPUB package: %w", err)
	}
	if found == "" {
		return "", errors.New("EPUB package document is missing")
	}
	return found, nil
}

func navigationTitles(files fs.FS, navigationPath string, htmlNavigation bool) (map[string]string, error) {
	data, err := fs.ReadFile(files, navigationPath)
	if err != nil {
		return nil, fmt.Errorf("read EPUB table of contents: %w", err)
	}
	if htmlNavigation {
		return parseHTMLNavigation(data, path.Dir(navigationPath))
	}
	return parseNCXNavigation(data, path.Dir(navigationPath))
}

type ncxDocument struct {
	Points []ncxPoint `xml:"navMap>navPoint"`
}

type ncxPoint struct {
	Label struct {
		Text string `xml:"text"`
	} `xml:"navLabel"`
	Content struct {
		Source string `xml:"src,attr"`
	} `xml:"content"`
	Children []ncxPoint `xml:"navPoint"`
}

func parseNCXNavigation(data []byte, directory string) (map[string]string, error) {
	var document ncxDocument
	if err := xml.Unmarshal(data, &document); err != nil {
		return nil, fmt.Errorf("parse EPUB NCX: %w", err)
	}
	titles := make(map[string]string)
	var addPoints func([]ncxPoint)
	addPoints = func(points []ncxPoint) {
		for _, point := range points {
			filePath := resolvePath(directory, point.Content.Source)
			if _, exists := titles[filePath]; !exists {
				titles[filePath] = cleanText(point.Label.Text)
			}
			addPoints(point.Children)
		}
	}
	addPoints(document.Points)
	return titles, nil
}

func parseHTMLNavigation(data []byte, directory string) (map[string]string, error) {
	decoder := xml.NewDecoder(strings.NewReader(string(data)))
	titles := make(map[string]string)
	insideTOC := false
	var anchorHref string
	var anchorText strings.Builder
	for {
		token, err := decoder.Token()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("parse EPUB navigation: %w", err)
		}
		switch value := token.(type) {
		case xml.StartElement:
			if value.Name.Local == "nav" && navigationIsTOC(value.Attr) {
				insideTOC = true
			}
			if insideTOC && value.Name.Local == "a" {
				anchorHref = attribute(value.Attr, "href")
				anchorText.Reset()
			}
		case xml.CharData:
			if anchorHref != "" {
				anchorText.Write(value)
			}
		case xml.EndElement:
			if insideTOC && value.Name.Local == "a" && anchorHref != "" {
				filePath := resolvePath(directory, anchorHref)
				if _, exists := titles[filePath]; !exists {
					titles[filePath] = cleanText(anchorText.String())
				}
				anchorHref = ""
			}
			if value.Name.Local == "nav" {
				insideTOC = false
			}
		}
	}
	return titles, nil
}

func readXML(files fs.FS, filePath string, destination any) error {
	data, err := fs.ReadFile(files, filePath)
	if err != nil {
		return err
	}
	return xml.Unmarshal(data, destination)
}

func resolvePath(directory, href string) string {
	filePath := strings.SplitN(href, "#", 2)[0]
	if decoded, err := url.PathUnescape(filePath); err == nil {
		filePath = decoded
	}
	return path.Clean(path.Join(directory, filePath))
}

func navigationIsTOC(attributes []xml.Attr) bool {
	for _, item := range attributes {
		if (item.Name.Local == "type" || item.Name.Local == "role") && strings.Contains(item.Value, "toc") {
			return true
		}
	}
	return false
}

func attribute(attributes []xml.Attr, name string) string {
	for _, item := range attributes {
		if item.Name.Local == name {
			return item.Value
		}
	}
	return ""
}

func hasWord(value, word string) bool {
	for _, item := range strings.Fields(value) {
		if item == word {
			return true
		}
	}
	return false
}

func cleanText(value string) string {
	return strings.Join(strings.Fields(value), " ")
}
