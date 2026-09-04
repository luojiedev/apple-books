package config

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestNewestSQLiteSelectsLatestDatabase(t *testing.T) {
	directory := t.TempDir()
	olderPath := filepath.Join(directory, "older.sqlite")
	newerPath := filepath.Join(directory, "newer.sqlite")
	ignoredPath := filepath.Join(directory, "newer.sqlite-wal")
	for _, path := range []string{olderPath, newerPath, ignoredPath} {
		if err := os.WriteFile(path, nil, 0o600); err != nil {
			t.Fatalf("write fixture: %v", err)
		}
	}
	olderTime := time.Date(2024, time.January, 1, 0, 0, 0, 0, time.Local)
	newerTime := olderTime.Add(time.Hour)
	if err := os.Chtimes(olderPath, olderTime, olderTime); err != nil {
		t.Fatalf("set older modification time: %v", err)
	}
	if err := os.Chtimes(newerPath, newerTime, newerTime); err != nil {
		t.Fatalf("set newer modification time: %v", err)
	}

	selected, err := newestSQLite(directory)
	if err != nil {
		t.Fatalf("newestSQLite() error = %v", err)
	}
	if selected != newerPath {
		t.Fatalf("newestSQLite() = %q, want %q", selected, newerPath)
	}
}

func TestNewestSQLiteRejectsDirectoryWithoutDatabase(t *testing.T) {
	if _, err := newestSQLite(t.TempDir()); err == nil {
		t.Fatal("newestSQLite() should reject a directory without a database")
	}
}

func TestValidateLoopbackAddress(t *testing.T) {
	for _, address := range []string{"127.0.0.1:8787", "[::1]:8787"} {
		if err := validateLoopbackAddress(address); err != nil {
			t.Fatalf("validateLoopbackAddress(%q) error = %v", address, err)
		}
	}
	for _, address := range []string{"0.0.0.0:8787", "[::]:8787"} {
		if err := validateLoopbackAddress(address); err == nil {
			t.Fatalf("validateLoopbackAddress(%q) should reject a non-loopback address", address)
		}
	}
}
