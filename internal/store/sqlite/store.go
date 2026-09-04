package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"hash/fnv"
	"net/url"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"apple-books/internal/domain"
	"apple-books/internal/store"

	_ "modernc.org/sqlite"
)

const appleEpochOffset = 978307200

type Store struct {
	library    *sql.DB
	annotation *sql.DB
}

func Open(libraryPath, annotationPath string) (*Store, error) {
	library, err := openReadOnly(libraryPath)
	if err != nil {
		return nil, fmt.Errorf("open library database: %w", err)
	}
	annotation, err := openReadOnly(annotationPath)
	if err != nil {
		_ = library.Close()
		return nil, fmt.Errorf("open annotation database: %w", err)
	}

	store := &Store{library: library, annotation: annotation}
	if err := store.validateSchema(context.Background()); err != nil {
		_ = store.Close()
		return nil, err
	}
	return store, nil
}

func openReadOnly(path string) (*sql.DB, error) {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	dsn := (&url.URL{Scheme: "file", Path: absolutePath, RawQuery: "mode=ro"}).String()
	database, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	database.SetMaxOpenConns(4)
	database.SetMaxIdleConns(4)
	if err := database.Ping(); err != nil {
		_ = database.Close()
		return nil, err
	}
	return database, nil
}

func (s *Store) validateSchema(ctx context.Context) error {
	checks := []struct {
		database *sql.DB
		table    string
	}{
		{s.library, "ZBKLIBRARYASSET"},
		{s.annotation, "ZAEANNOTATION"},
	}
	for _, check := range checks {
		var count int
		err := check.database.QueryRowContext(ctx, "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?", check.table).Scan(&count)
		if err != nil {
			return fmt.Errorf("validate table %s: %w", check.table, err)
		}
		if count != 1 {
			return fmt.Errorf("required table %s is missing; this Apple Books database version is not supported", check.table)
		}
	}
	return nil
}

func (s *Store) Close() error {
	return errors.Join(s.library.Close(), s.annotation.Close())
}

func (s *Store) Summary(ctx context.Context) (domain.Summary, error) {
	var summary domain.Summary
	bookQuery := `
		SELECT COUNT(*),
		       COALESCE(SUM(CASE WHEN COALESCE(ZREADINGPROGRESS, 0) > 0 THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN COALESCE(ZREADINGPROGRESS, 0) > 0 AND COALESCE(ZISFINISHED, 0) <> 1 AND ZDATEFINISHED IS NULL THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN COALESCE(ZISFINISHED, 0) = 1 OR ZDATEFINISHED IS NOT NULL THEN 1 ELSE 0 END), 0)
		FROM ZBKLIBRARYASSET`
	if err := s.library.QueryRowContext(ctx, bookQuery).Scan(
		&summary.TotalBooks, &summary.StartedBooks, &summary.ReadingBooks, &summary.FinishedBooks,
	); err != nil {
		return domain.Summary{}, fmt.Errorf("query book summary: %w", err)
	}

	annotationQuery := `
		SELECT COUNT(*),
		       COALESCE(SUM(CASE WHEN COALESCE(ZANNOTATIONSELECTEDTEXT, '') <> '' THEN 1 ELSE 0 END), 0),
		       COALESCE(SUM(CASE WHEN COALESCE(ZANNOTATIONNOTE, '') <> '' THEN 1 ELSE 0 END), 0),
		       COUNT(DISTINCT ZANNOTATIONASSETID)
		FROM ZAEANNOTATION
		WHERE COALESCE(ZANNOTATIONDELETED, 0) = 0
		  AND ZANNOTATIONTYPE IN (1, 2)`
	if err := s.annotation.QueryRowContext(ctx, annotationQuery).Scan(
		&summary.AnnotationCount, &summary.HighlightCount, &summary.NoteCount, &summary.AnnotatedBooks,
	); err != nil {
		return domain.Summary{}, fmt.Errorf("query annotation summary: %w", err)
	}
	finishedYears, err := s.finishedYears(ctx)
	if err != nil {
		return domain.Summary{}, err
	}
	summary.FinishedYears = finishedYears
	collectionYears, err := s.collectionYears(ctx)
	if err != nil {
		return domain.Summary{}, err
	}
	summary.CollectionYears = collectionYears
	return summary, nil
}

func (s *Store) finishedYears(ctx context.Context) ([]domain.FinishedYear, error) {
	rows, err := s.library.QueryContext(ctx, "SELECT ZDATEFINISHED FROM ZBKLIBRARYASSET WHERE ZDATEFINISHED IS NOT NULL")
	if err != nil {
		return nil, fmt.Errorf("query finished years: %w", err)
	}
	defer rows.Close()

	counts := make(map[int]int64)
	for rows.Next() {
		var rawDate sql.NullFloat64
		if err := rows.Scan(&rawDate); err != nil {
			return nil, fmt.Errorf("scan finished year: %w", err)
		}
		if finishedAt := appleTime(rawDate); finishedAt != nil {
			counts[finishedAt.Year()]++
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate finished years: %w", err)
	}

	years := make([]domain.FinishedYear, 0, len(counts))
	for year, count := range counts {
		years = append(years, domain.FinishedYear{Year: year, Count: count})
	}
	sort.Slice(years, func(left, right int) bool { return years[left].Year > years[right].Year })
	return years, nil
}

func (s *Store) collectionYears(ctx context.Context) ([]domain.CollectionYear, error) {
	rows, err := s.library.QueryContext(ctx, `
		SELECT ZPURCHASEDATE, ZUPDATEDATE, ZCREATIONDATE
		FROM ZBKLIBRARYASSET
		WHERE ZPURCHASEDATE IS NOT NULL OR ZUPDATEDATE IS NOT NULL OR ZCREATIONDATE IS NOT NULL`)
	if err != nil {
		return nil, fmt.Errorf("query collection years: %w", err)
	}
	defer rows.Close()

	counts := make(map[int]domain.CollectionYear)
	for rows.Next() {
		var purchaseDate, recordDate, creationDate sql.NullFloat64
		if err := rows.Scan(&purchaseDate, &recordDate, &creationDate); err != nil {
			return nil, fmt.Errorf("scan collection year: %w", err)
		}
		collectedAt, source := earliestCollectionTime(purchaseDate, recordDate, creationDate)
		if collectedAt == nil {
			continue
		}
		year := counts[collectedAt.Year()]
		year.Year = collectedAt.Year()
		year.Count++
		switch source {
		case "record":
			year.RecordCount++
		case "purchase":
			year.PurchaseCount++
		case "creation":
			year.CreationCount++
		}
		counts[year.Year] = year
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate collection years: %w", err)
	}

	years := make([]domain.CollectionYear, 0, len(counts))
	for _, year := range counts {
		years = append(years, year)
	}
	sort.Slice(years, func(left, right int) bool { return years[left].Year > years[right].Year })
	return years, nil
}

const collectionDateExpression = `(CASE
	WHEN ZPURCHASEDATE > 0
	 AND (ZUPDATEDATE IS NULL OR ZUPDATEDATE <= 0 OR ZPURCHASEDATE <= ZUPDATEDATE)
	 AND (ZCREATIONDATE IS NULL OR ZCREATIONDATE <= 0 OR ZPURCHASEDATE <= ZCREATIONDATE)
	THEN ZPURCHASEDATE
	WHEN ZUPDATEDATE > 0
	 AND (ZCREATIONDATE IS NULL OR ZCREATIONDATE <= 0 OR ZUPDATEDATE <= ZCREATIONDATE)
	THEN ZUPDATEDATE
	ELSE ZCREATIONDATE
END)`

func (s *Store) Books(ctx context.Context, query domain.BookQuery) (domain.BookPage, error) {
	where, arguments := bookFilters(query)
	var total int64
	if err := s.library.QueryRowContext(ctx, "SELECT COUNT(*) FROM ZBKLIBRARYASSET "+where, arguments...).Scan(&total); err != nil {
		return domain.BookPage{}, fmt.Errorf("count books: %w", err)
	}

	orderBy := map[string]string{
		"recent":   "ZLASTOPENDATE DESC, ZTITLE COLLATE NOCASE",
		"progress": "ZREADINGPROGRESS DESC, ZTITLE COLLATE NOCASE",
		"title":    "ZTITLE COLLATE NOCASE, ZAUTHOR COLLATE NOCASE",
		"author":   "ZAUTHOR COLLATE NOCASE, ZTITLE COLLATE NOCASE",
	}[query.Sort]
	if orderBy == "" {
		orderBy = "ZLASTOPENDATE DESC, ZTITLE COLLATE NOCASE"
	}

	arguments = append(arguments, query.Limit, query.Offset)
	rows, err := s.library.QueryContext(ctx, bookSelect+" "+where+" ORDER BY "+orderBy+" LIMIT ? OFFSET ?", arguments...)
	if err != nil {
		return domain.BookPage{}, fmt.Errorf("query books: %w", err)
	}
	defer rows.Close()

	books := make([]domain.Book, 0, query.Limit)
	for rows.Next() {
		book, err := scanBook(rows)
		if err != nil {
			return domain.BookPage{}, err
		}
		books = append(books, book)
	}
	if err := rows.Err(); err != nil {
		return domain.BookPage{}, fmt.Errorf("iterate books: %w", err)
	}
	if err := s.addAnnotationCounts(ctx, books); err != nil {
		return domain.BookPage{}, err
	}
	return domain.BookPage{Items: books, Total: total, Limit: query.Limit, Offset: query.Offset}, nil
}

func bookFilters(query domain.BookQuery) (string, []any) {
	clauses := make([]string, 0, 2)
	arguments := make([]any, 0, 3)
	if search := strings.TrimSpace(query.Search); search != "" {
		pattern := "%" + search + "%"
		clauses = append(clauses, "(ZTITLE LIKE ? OR ZAUTHOR LIKE ? OR ZGENRE LIKE ?)")
		arguments = append(arguments, pattern, pattern, pattern)
	}
	switch query.Status {
	case "unread":
		clauses = append(clauses, "COALESCE(ZREADINGPROGRESS, 0) = 0 AND COALESCE(ZISFINISHED, 0) <> 1 AND ZDATEFINISHED IS NULL")
	case "reading":
		clauses = append(clauses, "COALESCE(ZREADINGPROGRESS, 0) > 0 AND COALESCE(ZISFINISHED, 0) <> 1 AND ZDATEFINISHED IS NULL")
	case "finished":
		clauses = append(clauses, "(COALESCE(ZISFINISHED, 0) = 1 OR ZDATEFINISHED IS NOT NULL)")
	}
	if query.FinishedYear > 0 {
		start := time.Date(query.FinishedYear, time.January, 1, 0, 0, 0, 0, time.Local).Unix() - appleEpochOffset
		end := time.Date(query.FinishedYear+1, time.January, 1, 0, 0, 0, 0, time.Local).Unix() - appleEpochOffset
		clauses = append(clauses, "ZDATEFINISHED >= ? AND ZDATEFINISHED < ?")
		arguments = append(arguments, start, end)
	}
	if query.CollectionYear > 0 {
		start := time.Date(query.CollectionYear, time.January, 1, 0, 0, 0, 0, time.Local).Unix() - appleEpochOffset
		end := time.Date(query.CollectionYear+1, time.January, 1, 0, 0, 0, 0, time.Local).Unix() - appleEpochOffset
		clauses = append(clauses, collectionDateExpression+" >= ? AND "+collectionDateExpression+" < ?")
		arguments = append(arguments, start, end)
	}
	if len(clauses) == 0 {
		return "", arguments
	}
	return "WHERE " + strings.Join(clauses, " AND "), arguments
}

const bookSelect = `
	SELECT Z_PK, COALESCE(ZASSETID, ''), COALESCE(ZTITLE, ''), COALESCE(ZAUTHOR, ''),
	       COALESCE(ZGENRE, ''), COALESCE(ZLANGUAGE, ''), COALESCE(ZBOOKDESCRIPTION, ''),
	       COALESCE(ZREADINGPROGRESS, 0), COALESCE(ZISFINISHED, 0),
	       ZLASTOPENDATE, ZLASTENGAGEDDATE, ZDATEFINISHED, COALESCE(ZPAGECOUNT, 0),
	       ZPURCHASEDATE, ZUPDATEDATE, ZCREATIONDATE, COALESCE(ZPATH, '')
	FROM ZBKLIBRARYASSET`

type scanner interface {
	Scan(dest ...any) error
}

func scanBook(row scanner) (domain.Book, error) {
	var book domain.Book
	var finished int64
	var lastOpened, lastEngaged, finishedAt, purchaseDate, recordDate, creationDate sql.NullFloat64
	err := row.Scan(
		&book.ID, &book.AssetID, &book.Title, &book.Author, &book.Genre, &book.Language,
		&book.Description, &book.Progress, &finished, &lastOpened, &lastEngaged, &finishedAt, &book.PageCount,
		&purchaseDate, &recordDate, &creationDate, &book.SourcePath,
	)
	if err != nil {
		return domain.Book{}, fmt.Errorf("scan book: %w", err)
	}
	book.LastOpenedAt = appleTime(lastOpened)
	book.LastEngagedAt = appleTime(lastEngaged)
	book.FinishedAt = appleTime(finishedAt)
	book.CollectedAt, book.CollectionSource = earliestCollectionTime(purchaseDate, recordDate, creationDate)
	switch {
	case finished == 1 || finishedAt.Valid:
		book.Status = "finished"
	case book.Progress > 0:
		book.Status = "reading"
	default:
		book.Status = "unread"
	}
	return book, nil
}

func earliestCollectionTime(purchaseDate, recordDate, creationDate sql.NullFloat64) (*time.Time, string) {
	candidates := []struct {
		date   sql.NullFloat64
		source string
	}{
		{date: purchaseDate, source: "purchase"},
		{date: recordDate, source: "record"},
		{date: creationDate, source: "creation"},
	}

	var earliest *time.Time
	var source string
	for _, candidate := range candidates {
		candidateTime := appleTime(candidate.date)
		if candidateTime != nil && (earliest == nil || candidateTime.Before(*earliest)) {
			earliest = candidateTime
			source = candidate.source
		}
	}
	return earliest, source
}

func (s *Store) Book(ctx context.Context, id int64) (domain.Book, error) {
	book, err := scanBook(s.library.QueryRowContext(ctx, bookSelect+" WHERE Z_PK = ?", id))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return domain.Book{}, store.ErrNotFound
		}
		return domain.Book{}, err
	}
	books := []domain.Book{book}
	if err := s.addAnnotationCounts(ctx, books); err != nil {
		return domain.Book{}, err
	}
	return books[0], nil
}

func (s *Store) RandomReview(ctx context.Context, key string, notesOnly bool) (domain.Review, error) {
	filter := reviewFilter(notesOnly)
	var count int64
	if err := s.annotation.QueryRowContext(ctx, "SELECT COUNT(*) FROM ZAEANNOTATION "+filter).Scan(&count); err != nil {
		return domain.Review{}, fmt.Errorf("count review annotations: %w", err)
	}
	if count == 0 {
		return domain.Review{}, store.ErrNotFound
	}

	hasher := fnv.New64a()
	_, _ = hasher.Write([]byte(key))
	startOffset := int64(hasher.Sum64() % uint64(count))
	for attempt := int64(0); attempt < count; attempt++ {
		offset := (startOffset + attempt) % count
		annotation, assetID, err := s.reviewAnnotation(ctx, filter, offset)
		if err != nil {
			return domain.Review{}, err
		}
		book, err := s.bookByAssetID(ctx, assetID)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return domain.Review{}, err
		}
		return domain.Review{Book: book, Annotation: annotation}, nil
	}
	return domain.Review{}, store.ErrNotFound
}

func reviewFilter(notesOnly bool) string {
	filter := `WHERE COALESCE(ZANNOTATIONDELETED, 0) = 0
		AND ZANNOTATIONTYPE IN (1, 2)
		AND (COALESCE(ZANNOTATIONSELECTEDTEXT, '') <> '' OR COALESCE(ZANNOTATIONNOTE, '') <> '')`
	if notesOnly {
		filter += " AND COALESCE(ZANNOTATIONNOTE, '') <> ''"
	}
	return filter
}

func (s *Store) reviewAnnotation(ctx context.Context, filter string, offset int64) (domain.Annotation, string, error) {
	row := s.annotation.QueryRowContext(ctx, `
		SELECT Z_PK, COALESCE(ZANNOTATIONUUID, ''), COALESCE(ZANNOTATIONTYPE, 0),
		       COALESCE(ZANNOTATIONSTYLE, 0), COALESCE(ZANNOTATIONISUNDERLINE, 0),
		       COALESCE(ZANNOTATIONSELECTEDTEXT, ''), COALESCE(ZANNOTATIONNOTE, ''),
		       COALESCE(ZANNOTATIONLOCATION, ''), ZANNOTATIONCREATIONDATE, ZANNOTATIONMODIFICATIONDATE,
		       COALESCE(ZANNOTATIONASSETID, '')
		FROM ZAEANNOTATION `+filter+`
		ORDER BY Z_PK
		LIMIT 1 OFFSET ?`, offset)

	var annotation domain.Annotation
	var assetID string
	var annotationType, underline int64
	var createdAt, modifiedAt sql.NullFloat64
	if err := row.Scan(
		&annotation.ID, &annotation.UUID, &annotationType, &annotation.Style, &underline,
		&annotation.SelectedText, &annotation.Note, &annotation.Location, &createdAt, &modifiedAt, &assetID,
	); err != nil {
		return domain.Annotation{}, "", fmt.Errorf("scan review annotation: %w", err)
	}
	annotation.Type = annotationTypeName(annotationType)
	annotation.IsUnderline = underline == 1
	annotation.CreatedAt = appleTime(createdAt)
	annotation.ModifiedAt = appleTime(modifiedAt)
	return annotation, assetID, nil
}

func (s *Store) bookByAssetID(ctx context.Context, assetID string) (domain.Book, error) {
	book, err := scanBook(s.library.QueryRowContext(ctx, bookSelect+" WHERE ZASSETID = ? LIMIT 1", assetID))
	if errors.Is(err, sql.ErrNoRows) {
		return domain.Book{}, store.ErrNotFound
	}
	if err != nil {
		return domain.Book{}, err
	}
	books := []domain.Book{book}
	if err := s.addAnnotationCounts(ctx, books); err != nil {
		return domain.Book{}, err
	}
	return books[0], nil
}

func (s *Store) addAnnotationCounts(ctx context.Context, books []domain.Book) error {
	if len(books) == 0 {
		return nil
	}
	index := make(map[string]int, len(books))
	placeholders := make([]string, 0, len(books))
	arguments := make([]any, 0, len(books))
	for position, book := range books {
		if book.AssetID == "" {
			continue
		}
		index[book.AssetID] = position
		placeholders = append(placeholders, "?")
		arguments = append(arguments, book.AssetID)
	}
	if len(arguments) == 0 {
		return nil
	}
	query := `SELECT ZANNOTATIONASSETID, COUNT(*),
	                 COALESCE(SUM(CASE WHEN COALESCE(ZANNOTATIONNOTE, '') <> '' THEN 1 ELSE 0 END), 0)
	          FROM ZAEANNOTATION
	          WHERE COALESCE(ZANNOTATIONDELETED, 0) = 0
	            AND ZANNOTATIONTYPE IN (1, 2)
	            AND ZANNOTATIONASSETID IN (` + strings.Join(placeholders, ",") + `)
	          GROUP BY ZANNOTATIONASSETID`
	rows, err := s.annotation.QueryContext(ctx, query, arguments...)
	if err != nil {
		return fmt.Errorf("query annotation counts: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var assetID string
		var count, noteCount int64
		if err := rows.Scan(&assetID, &count, &noteCount); err != nil {
			return fmt.Errorf("scan annotation counts: %w", err)
		}
		if position, exists := index[assetID]; exists {
			books[position].AnnotationCount = count
			books[position].NoteCount = noteCount
		}
	}
	return rows.Err()
}

func (s *Store) Annotations(ctx context.Context, assetID string) ([]domain.Annotation, error) {
	rows, err := s.annotation.QueryContext(ctx, `
		SELECT Z_PK, COALESCE(ZANNOTATIONUUID, ''), COALESCE(ZANNOTATIONTYPE, 0),
		       COALESCE(ZANNOTATIONSTYLE, 0), COALESCE(ZANNOTATIONISUNDERLINE, 0),
		       COALESCE(ZANNOTATIONSELECTEDTEXT, ''), COALESCE(ZANNOTATIONNOTE, ''),
		       COALESCE(ZANNOTATIONLOCATION, ''), ZANNOTATIONCREATIONDATE, ZANNOTATIONMODIFICATIONDATE
		FROM ZAEANNOTATION
		WHERE ZANNOTATIONASSETID = ?
		  AND COALESCE(ZANNOTATIONDELETED, 0) = 0
		  AND ZANNOTATIONTYPE IN (1, 2)
		ORDER BY ZANNOTATIONCREATIONDATE DESC`, assetID)
	if err != nil {
		return nil, fmt.Errorf("query annotations: %w", err)
	}
	defer rows.Close()

	annotations := make([]domain.Annotation, 0)
	for rows.Next() {
		var annotation domain.Annotation
		var annotationType, underline int64
		var createdAt, modifiedAt sql.NullFloat64
		if err := rows.Scan(
			&annotation.ID, &annotation.UUID, &annotationType, &annotation.Style, &underline,
			&annotation.SelectedText, &annotation.Note, &annotation.Location, &createdAt, &modifiedAt,
		); err != nil {
			return nil, fmt.Errorf("scan annotation: %w", err)
		}
		annotation.Type = annotationTypeName(annotationType)
		annotation.IsUnderline = underline == 1
		annotation.CreatedAt = appleTime(createdAt)
		annotation.ModifiedAt = appleTime(modifiedAt)
		annotations = append(annotations, annotation)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate annotations: %w", err)
	}
	return annotations, nil
}

func annotationTypeName(value int64) string {
	switch value {
	case 2:
		return "highlight"
	case 3:
		return "reading-position"
	case 1:
		return "bookmark"
	default:
		return "other"
	}
}

func appleTime(value sql.NullFloat64) *time.Time {
	if !value.Valid || value.Float64 <= 0 {
		return nil
	}
	seconds := int64(value.Float64)
	nanoseconds := int64((value.Float64 - float64(seconds)) * float64(time.Second))
	converted := time.Unix(seconds+appleEpochOffset, nanoseconds).Local()
	return &converted
}
