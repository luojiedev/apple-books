package store

import (
	"context"
	"errors"

	"apple-books/internal/domain"
)

var ErrNotFound = errors.New("not found")

type Reader interface {
	Summary(ctx context.Context) (domain.Summary, error)
	Books(ctx context.Context, query domain.BookQuery) (domain.BookPage, error)
	Book(ctx context.Context, id int64) (domain.Book, error)
	Annotations(ctx context.Context, assetID string) ([]domain.Annotation, error)
	SearchAnnotations(ctx context.Context, query domain.AnnotationQuery) (domain.AnnotationPage, error)
	RandomReview(ctx context.Context, key string, notesOnly bool) (domain.Review, error)
	RandomBook(ctx context.Context, key, mode string) (domain.Book, error)
	YearReport(ctx context.Context, year int) (domain.YearReport, error)
	Close() error
}
