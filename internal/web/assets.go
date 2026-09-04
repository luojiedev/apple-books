package web

import "embed"

// Assets contains the self-contained browser interface.
//
//go:embed static/*
var Assets embed.FS
