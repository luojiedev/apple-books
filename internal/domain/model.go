package domain

import "time"

type Summary struct {
	TotalBooks      int64            `json:"totalBooks"`
	StartedBooks    int64            `json:"startedBooks"`
	ReadingBooks    int64            `json:"readingBooks"`
	FinishedBooks   int64            `json:"finishedBooks"`
	AnnotationCount int64            `json:"annotationCount"`
	HighlightCount  int64            `json:"highlightCount"`
	NoteCount       int64            `json:"noteCount"`
	AnnotatedBooks  int64            `json:"annotatedBooks"`
	FinishedYears   []FinishedYear   `json:"finishedYears"`
	CollectionYears []CollectionYear `json:"collectionYears"`
}

type FinishedYear struct {
	Year  int   `json:"year"`
	Count int64 `json:"count"`
}

type CollectionYear struct {
	Year          int   `json:"year"`
	Count         int64 `json:"count"`
	RecordCount   int64 `json:"recordCount"`
	PurchaseCount int64 `json:"purchaseCount"`
	CreationCount int64 `json:"creationCount"`
}

type Book struct {
	ID               int64      `json:"id"`
	AssetID          string     `json:"assetId"`
	Title            string     `json:"title"`
	Author           string     `json:"author"`
	Genre            string     `json:"genre,omitempty"`
	Language         string     `json:"language,omitempty"`
	Description      string     `json:"description,omitempty"`
	Progress         float64    `json:"progress"`
	Status           string     `json:"status"`
	LastOpenedAt     *time.Time `json:"lastOpenedAt,omitempty"`
	LastEngagedAt    *time.Time `json:"lastEngagedAt,omitempty"`
	FinishedAt       *time.Time `json:"finishedAt,omitempty"`
	CollectedAt      *time.Time `json:"collectedAt,omitempty"`
	CollectionSource string     `json:"collectionSource,omitempty"`
	SourcePath       string     `json:"-"`
	PageCount        int64      `json:"pageCount,omitempty"`
	AnnotationCount  int64      `json:"annotationCount"`
	NoteCount        int64      `json:"noteCount"`
}

type Annotation struct {
	ID           int64      `json:"id"`
	UUID         string     `json:"uuid"`
	Type         string     `json:"type"`
	Style        int64      `json:"style"`
	IsUnderline  bool       `json:"isUnderline"`
	SelectedText string     `json:"selectedText,omitempty"`
	Note         string     `json:"note,omitempty"`
	Location     string     `json:"location,omitempty"`
	CreatedAt    *time.Time `json:"createdAt,omitempty"`
	ModifiedAt   *time.Time `json:"modifiedAt,omitempty"`
}

type Review struct {
	Book       Book       `json:"book"`
	Annotation Annotation `json:"annotation"`
}

type BookQuery struct {
	Search         string
	Status         string
	Sort           string
	FinishedYear   int
	CollectionYear int
	Limit          int
	Offset         int
}

type BookPage struct {
	Items  []Book `json:"items"`
	Total  int64  `json:"total"`
	Limit  int    `json:"limit"`
	Offset int    `json:"offset"`
}
