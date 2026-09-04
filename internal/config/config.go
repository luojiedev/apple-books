package config

import (
	"errors"
	"flag"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

type Config struct {
	LibraryDB    string
	AnnotationDB string
	Address      string
}

type databaseCandidate struct {
	name          string
	libraryDir    string
	annotationDir string
}

func Parse() (Config, error) {
	workingDirectory, err := os.Getwd()
	if err != nil {
		return Config{}, fmt.Errorf("get working directory: %w", err)
	}

	config := Config{}
	flag.StringVar(&config.LibraryDB, "library-db", "", "BKLibrary SQLite database path (overrides automatic discovery)")
	flag.StringVar(&config.AnnotationDB, "annotation-db", "", "AEAnnotation SQLite database path (overrides automatic discovery)")
	flag.StringVar(&config.Address, "addr", "127.0.0.1:8787", "HTTP listen address")
	flag.Parse()
	if (config.LibraryDB == "") != (config.AnnotationDB == "") {
		return Config{}, errors.New("library-db and annotation-db must be specified together")
	}
	if config.LibraryDB == "" {
		config.LibraryDB, config.AnnotationDB, err = discoverDatabases(workingDirectory)
		if err != nil {
			return Config{}, err
		}
	}

	if err := validateFile(config.LibraryDB); err != nil {
		return Config{}, fmt.Errorf("library database: %w", err)
	}
	if err := validateFile(config.AnnotationDB); err != nil {
		return Config{}, fmt.Errorf("annotation database: %w", err)
	}
	if err := validateLoopbackAddress(config.Address); err != nil {
		return Config{}, err
	}
	return config, nil
}

func validateLoopbackAddress(address string) error {
	resolvedAddress, err := net.ResolveTCPAddr("tcp", address)
	if err != nil {
		return fmt.Errorf("invalid listen address: %w", err)
	}
	if resolvedAddress.IP == nil || !resolvedAddress.IP.IsLoopback() {
		return errors.New("listen address must use a loopback IP such as 127.0.0.1 or ::1")
	}
	return nil
}

func discoverDatabases(workingDirectory string) (string, string, error) {
	candidates := make([]databaseCandidate, 0, 2)
	if runtime.GOOS == "darwin" {
		homeDirectory, err := os.UserHomeDir()
		if err != nil {
			return "", "", fmt.Errorf("find home directory: %w", err)
		}
		booksDocuments := filepath.Join(homeDirectory, "Library", "Containers", "com.apple.iBooksX", "Data", "Documents")
		candidates = append(candidates, databaseCandidate{
			name:          "macOS Apple Books container",
			libraryDir:    filepath.Join(booksDocuments, "BKLibrary"),
			annotationDir: filepath.Join(booksDocuments, "AEAnnotation"),
		})
	}
	candidates = append(candidates, databaseCandidate{
		name:          "working directory",
		libraryDir:    filepath.Join(workingDirectory, "BKLibrary"),
		annotationDir: filepath.Join(workingDirectory, "AEAnnotation"),
	})

	failures := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		libraryPath, libraryErr := newestSQLite(candidate.libraryDir)
		annotationPath, annotationErr := newestSQLite(candidate.annotationDir)
		if libraryErr == nil && annotationErr == nil {
			return libraryPath, annotationPath, nil
		}
		failures = append(failures, fmt.Sprintf("%s: BKLibrary: %v; AEAnnotation: %v", candidate.name, libraryErr, annotationErr))
	}
	return "", "", fmt.Errorf("could not discover Apple Books databases; copy them into BKLibrary/ and AEAnnotation/ or specify both database flags (%s)", strings.Join(failures, "; "))
}

func newestSQLite(directory string) (string, error) {
	entries, err := os.ReadDir(directory)
	if err != nil {
		return "", err
	}
	var newestPath string
	var newestTime time.Time
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(strings.ToLower(entry.Name()), ".sqlite") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return "", err
		}
		if newestPath == "" || info.ModTime().After(newestTime) {
			newestPath = filepath.Join(directory, entry.Name())
			newestTime = info.ModTime()
		}
	}
	if newestPath == "" {
		return "", errors.New("no .sqlite file found")
	}
	return newestPath, nil
}

func validateFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() {
		return errors.New("path is a directory")
	}
	return nil
}
