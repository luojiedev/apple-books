package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	"apple-books/internal/domain"
)

func TestAppleTime(t *testing.T) {
	converted := appleTime(sql.NullFloat64{Float64: 0, Valid: true})
	if converted != nil {
		t.Fatalf("zero Apple timestamp should be nil, got %v", converted)
	}

	converted = appleTime(sql.NullFloat64{Float64: 60.5, Valid: true})
	if converted == nil {
		t.Fatal("valid Apple timestamp should not be nil")
	}
	want := time.Unix(appleEpochOffset+60, int64(500*time.Millisecond)).Local()
	if !converted.Equal(want) {
		t.Fatalf("appleTime() = %v, want %v", converted, want)
	}
}

func TestStoreReadsBooksAndUserAnnotations(t *testing.T) {
	directory := t.TempDir()
	libraryPath := filepath.Join(directory, "library.sqlite")
	annotationPath := filepath.Join(directory, "annotations.sqlite")
	createLibraryFixture(t, libraryPath)
	createAnnotationFixture(t, annotationPath)

	reader, err := Open(libraryPath, annotationPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = reader.Close() })

	summary, err := reader.Summary(context.Background())
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	if summary.TotalBooks != 2 || summary.ReadingBooks != 1 || summary.FinishedBooks != 1 {
		t.Fatalf("unexpected book summary: %+v", summary)
	}
	if summary.AnnotationCount != 1 || summary.AnnotatedBooks != 1 {
		t.Fatalf("system reading position must not count as an annotation: %+v", summary)
	}
	if len(summary.FinishedYears) != 1 || summary.FinishedYears[0].Count != 1 {
		t.Fatalf("unexpected finished years: %+v", summary.FinishedYears)
	}
	if len(summary.CollectionYears) != 2 {
		t.Fatalf("unexpected collection years: %+v", summary.CollectionYears)
	}
	var collectedBooks, recordedBooks, purchasedBooks, createdBooks int64
	for _, year := range summary.CollectionYears {
		collectedBooks += year.Count
		recordedBooks += year.RecordCount
		purchasedBooks += year.PurchaseCount
		createdBooks += year.CreationCount
	}
	if collectedBooks != 2 || recordedBooks != 1 || purchasedBooks != 0 || createdBooks != 1 {
		t.Fatalf("unexpected collection year sources: %+v", summary.CollectionYears)
	}

	page, err := reader.Books(context.Background(), domain.BookQuery{Status: "reading", Sort: "recent", Limit: 10})
	if err != nil {
		t.Fatalf("Books() error = %v", err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].Title != "测试书" {
		t.Fatalf("unexpected page: %+v", page)
	}
	if page.Items[0].AnnotationCount != 1 || page.Items[0].NoteCount != 1 {
		t.Fatalf("unexpected annotation counts: %+v", page.Items[0])
	}
	if page.Items[0].CollectionSource != "record" {
		t.Fatalf("collection source = %q, want record", page.Items[0].CollectionSource)
	}

	finishedPage, err := reader.Books(context.Background(), domain.BookQuery{
		Status: "finished", FinishedYear: summary.FinishedYears[0].Year, Sort: "recent", Limit: 10,
	})
	if err != nil {
		t.Fatalf("Books() by finished year error = %v", err)
	}
	if finishedPage.Total != 1 || len(finishedPage.Items) != 1 || finishedPage.Items[0].Title != "读完的书" {
		t.Fatalf("unexpected finished year page: %+v", finishedPage)
	}

	collectionPage, err := reader.Books(context.Background(), domain.BookQuery{
		CollectionYear: summary.CollectionYears[0].Year, Sort: "recent", Limit: 10,
	})
	if err != nil {
		t.Fatalf("Books() by collection year error = %v", err)
	}
	if collectionPage.Total != 1 || len(collectionPage.Items) != 1 {
		t.Fatalf("unexpected collection year page: %+v", collectionPage)
	}

	wantToReadPage, err := reader.WantToRead(context.Background(), 10, 0)
	if err != nil {
		t.Fatalf("WantToRead() error = %v", err)
	}
	if wantToReadPage.Total != 1 || len(wantToReadPage.Items) != 1 || wantToReadPage.Items[0].Title != "测试书" {
		t.Fatalf("unexpected want-to-read page: %+v", wantToReadPage)
	}
	if wantToReadPage.Items[0].AnnotationCount != 1 {
		t.Fatalf("want-to-read annotation count = %d, want 1", wantToReadPage.Items[0].AnnotationCount)
	}

	annotations, err := reader.Annotations(context.Background(), "asset-1")
	if err != nil {
		t.Fatalf("Annotations() error = %v", err)
	}
	if len(annotations) != 1 || annotations[0].Type != "highlight" || annotations[0].Note != "想法" {
		t.Fatalf("unexpected annotations: %+v", annotations)
	}

	firstReview, err := reader.RandomReview(context.Background(), "stable-key", true)
	if err != nil {
		t.Fatalf("RandomReview() error = %v", err)
	}
	secondReview, err := reader.RandomReview(context.Background(), "stable-key", true)
	if err != nil {
		t.Fatalf("RandomReview() repeated error = %v", err)
	}
	if firstReview.Annotation.UUID != "highlight-1" || firstReview.Annotation.UUID != secondReview.Annotation.UUID {
		t.Fatalf("random review must be deterministic for the same key: first=%+v second=%+v", firstReview, secondReview)
	}
	if firstReview.Book.Title != "测试书" {
		t.Fatalf("unexpected review book: %+v", firstReview.Book)
	}

	annotationPage, err := reader.SearchAnnotations(context.Background(), domain.AnnotationQuery{
		Search: "摘录", Kind: "note", Style: 3, Limit: 10,
	})
	if err != nil {
		t.Fatalf("SearchAnnotations() error = %v", err)
	}
	if annotationPage.Total != 1 || len(annotationPage.Items) != 1 || annotationPage.Items[0].Book.Title != "测试书" {
		t.Fatalf("unexpected annotation search page: %+v", annotationPage)
	}

	pickedBook, err := reader.RandomBook(context.Background(), "stable-book-key", "any")
	if err != nil {
		t.Fatalf("RandomBook() error = %v", err)
	}
	repeatedPick, err := reader.RandomBook(context.Background(), "stable-book-key", "any")
	if err != nil {
		t.Fatalf("RandomBook() repeated error = %v", err)
	}
	if pickedBook.ID == 0 || pickedBook.ID != repeatedPick.ID {
		t.Fatalf("random book must be deterministic for the same key: first=%+v second=%+v", pickedBook, repeatedPick)
	}

	reportYear := annotations[0].CreatedAt.Year()
	report, err := reader.YearReport(context.Background(), reportYear)
	if err != nil {
		t.Fatalf("YearReport() error = %v", err)
	}
	if report.AnnotationCount != 1 || report.NoteCount != 1 || report.ActiveDays != 1 {
		t.Fatalf("unexpected year report totals: %+v", report)
	}
	if len(report.TopBooks) != 1 || report.TopBooks[0].Book.Title != "测试书" {
		t.Fatalf("unexpected year report ranking: %+v", report.TopBooks)
	}
}

func TestStoreDoesNotTreatFinishedDateAsFinishedStatus(t *testing.T) {
	directory := t.TempDir()
	libraryPath := filepath.Join(directory, "library.sqlite")
	annotationPath := filepath.Join(directory, "annotations.sqlite")
	createLibraryFixture(t, libraryPath)
	createAnnotationFixture(t, annotationPath)

	database := openFixture(t, libraryPath)
	mustExec(t, database, `INSERT INTO ZBKLIBRARYASSET VALUES
		(3, 'asset-3', '存在完成日期的在读书', '作者丙', '', 'zh', '', 0.2, 0, 700000000, 700000100, 700000100, 0, NULL, 700000000, NULL, '')`)
	if err := database.Close(); err != nil {
		t.Fatalf("close library fixture: %v", err)
	}

	reader, err := Open(libraryPath, annotationPath)
	if err != nil {
		t.Fatalf("Open() error = %v", err)
	}
	t.Cleanup(func() { _ = reader.Close() })

	summary, err := reader.Summary(context.Background())
	if err != nil {
		t.Fatalf("Summary() error = %v", err)
	}
	if summary.FinishedBooks != 1 || summary.ReadingBooks != 2 {
		t.Fatalf("unexpected summary for unfinished book with finished date: %+v", summary)
	}
	if len(summary.FinishedYears) != 1 || summary.FinishedYears[0].Count != 1 {
		t.Fatalf("unexpected finished years: %+v", summary.FinishedYears)
	}

	book, err := reader.Book(context.Background(), 3)
	if err != nil {
		t.Fatalf("Book() error = %v", err)
	}
	if book.Status != "reading" || book.FinishedAt != nil {
		t.Fatalf("book with unset finished flag = %+v, want reading without finished time", book)
	}

	finishedPage, err := reader.Books(context.Background(), domain.BookQuery{
		FinishedYear: summary.FinishedYears[0].Year, Limit: 10,
	})
	if err != nil {
		t.Fatalf("Books() by finished year error = %v", err)
	}
	if finishedPage.Total != 1 || len(finishedPage.Items) != 1 || finishedPage.Items[0].Title != "读完的书" {
		t.Fatalf("unexpected finished books: %+v", finishedPage)
	}

	report, err := reader.YearReport(context.Background(), summary.FinishedYears[0].Year)
	if err != nil {
		t.Fatalf("YearReport() error = %v", err)
	}
	if report.FinishedBooks != 1 {
		t.Fatalf("finished books in year report = %d, want 1", report.FinishedBooks)
	}
}

func createLibraryFixture(t *testing.T, path string) {
	t.Helper()
	database := openFixture(t, path)
	defer database.Close()
	mustExec(t, database, `CREATE TABLE ZBKLIBRARYASSET (
		Z_PK INTEGER PRIMARY KEY, ZASSETID TEXT, ZTITLE TEXT, ZAUTHOR TEXT, ZGENRE TEXT,
		ZLANGUAGE TEXT, ZBOOKDESCRIPTION TEXT, ZREADINGPROGRESS REAL, ZISFINISHED INTEGER,
		ZLASTOPENDATE REAL, ZLASTENGAGEDDATE REAL, ZDATEFINISHED REAL, ZPAGECOUNT INTEGER,
		ZPURCHASEDATE REAL, ZCREATIONDATE REAL, ZUPDATEDATE REAL, ZPATH TEXT
	)`)
	mustExec(t, database, `INSERT INTO ZBKLIBRARYASSET VALUES
		(1, 'asset-1', '测试书', '作者甲', '文学', 'zh', '简介', 0.5, 0, 800000000, 800000000, NULL, 200, 800000000, 800000050, 650000000, '/books/test.epub'),
		(2, 'asset-2', '读完的书', '作者乙', '', 'zh', '', 0.9, 1, 700000000, NULL, 700000100, 0, NULL, 700000000, NULL, '')`)
	mustExec(t, database, `CREATE TABLE ZBKCOLLECTION (
		Z_PK INTEGER PRIMARY KEY, ZCOLLECTIONID TEXT
	)`)
	mustExec(t, database, `CREATE TABLE ZBKCOLLECTIONMEMBER (
		Z_PK INTEGER PRIMARY KEY, ZSORTKEY INTEGER, ZASSET INTEGER, ZCOLLECTION INTEGER
	)`)
	mustExec(t, database, `INSERT INTO ZBKCOLLECTION VALUES (1, 'Want_To_Read_Collection_ID')`)
	mustExec(t, database, `INSERT INTO ZBKCOLLECTIONMEMBER VALUES (1, 10000, 1, 1)`)
}

func createAnnotationFixture(t *testing.T, path string) {
	t.Helper()
	database := openFixture(t, path)
	defer database.Close()
	mustExec(t, database, `CREATE TABLE ZAEANNOTATION (
		Z_PK INTEGER PRIMARY KEY, ZANNOTATIONUUID TEXT, ZANNOTATIONTYPE INTEGER,
		ZANNOTATIONSTYLE INTEGER, ZANNOTATIONISUNDERLINE INTEGER, ZANNOTATIONSELECTEDTEXT TEXT,
		ZANNOTATIONNOTE TEXT, ZANNOTATIONLOCATION TEXT, ZANNOTATIONCREATIONDATE REAL,
		ZANNOTATIONMODIFICATIONDATE REAL, ZANNOTATIONASSETID TEXT, ZANNOTATIONDELETED INTEGER
	)`)
	mustExec(t, database, `INSERT INTO ZAEANNOTATION VALUES
		(1, 'highlight-1', 2, 3, 0, '摘录', '想法', 'loc-1', 800000000, 800000010, 'asset-1', 0),
		(2, 'position-1', 3, 0, 0, '', '', 'loc-2', 800000020, 800000020, 'asset-1', 0),
		(3, 'deleted-1', 2, 1, 0, '已删除', '', 'loc-3', 800000030, 800000030, 'asset-1', 1)`)
}

func openFixture(t *testing.T, path string) *sql.DB {
	t.Helper()
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatalf("open fixture: %v", err)
	}
	return database
}

func mustExec(t *testing.T, database *sql.DB, statement string) {
	t.Helper()
	if _, err := database.Exec(statement); err != nil {
		t.Fatalf("execute fixture SQL: %v", err)
	}
}
