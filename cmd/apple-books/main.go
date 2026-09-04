package main

import (
	"context"
	"errors"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"apple-books/internal/config"
	"apple-books/internal/httpapi"
	booksdb "apple-books/internal/store/sqlite"

	log "github.com/luojiedev/slogx"
)

func main() {
	configuration, err := config.Parse()
	if err != nil {
		log.Fatal("configuration validation failed", "error", err)
	}
	log.Debug("Apple Books databases selected", "library_db", filepath.Base(configuration.LibraryDB), "annotation_db", filepath.Base(configuration.AnnotationDB))

	reader, err := booksdb.Open(configuration.LibraryDB, configuration.AnnotationDB)
	if err != nil {
		log.Fatal("open Apple Books databases failed", "error", err)
	}
	defer func() {
		if err := reader.Close(); err != nil {
			log.Error("close databases failed", "error", err)
		}
	}()

	api, err := httpapi.New(reader)
	if err != nil {
		log.Fatal("create HTTP server failed", "error", err)
	}
	server := &http.Server{
		Addr:              configuration.Address,
		Handler:           api.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		log.Info("Apple Books viewer started", "url", "http://"+configuration.Address)
		serverErrors <- server.ListenAndServe()
	}()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	select {
	case signalValue := <-signals:
		log.Info("shutdown signal received", "signal", signalValue.String())
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			log.Fatal("HTTP server stopped unexpectedly", "error", err)
		}
	}

	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		log.Error("graceful shutdown failed", "error", err)
	}
}
