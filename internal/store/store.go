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
	RandomReview(ctx context.Context, key string, notesOnly bool) (domain.Review, error)
	Close() error
}
