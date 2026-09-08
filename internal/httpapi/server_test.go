package httpapi

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLocalRequestsOnlyRejectsNonLoopbackHost(t *testing.T) {
	handler := localRequestsOnly(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	}))

	request := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/", nil)
	request.Host = "attacker.example"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusMisdirectedRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusMisdirectedRequest)
	}

	request = httptest.NewRequest(http.MethodGet, "http://127.0.0.1/", nil)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("loopback status = %d, want %d", response.Code, http.StatusNoContent)
	}
}

func TestSafeCSVCellPreventsFormulaExecution(t *testing.T) {
	for _, value := range []string{"=HYPERLINK(\"https://example.com\")", "+1", "-1", "@SUM(A1:A2)"} {
		if protected := safeCSVCell(value); protected != "'"+value {
			t.Fatalf("safeCSVCell(%q) = %q", value, protected)
		}
	}
	if protected := safeCSVCell("普通书名"); protected != "普通书名" {
		t.Fatalf("ordinary value changed to %q", protected)
	}
}

func TestParseBookQuery(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/books?q=%E9%98%85%E8%AF%BB&status=finished&finishedYear=2024&sort=progress&limit=20&offset=40", nil)
	query, err := parseBookQuery(request)
	if err != nil {
		t.Fatalf("parseBookQuery() error = %v", err)
	}
	if query.Search != "阅读" || query.Status != "finished" || query.FinishedYear != 2024 || query.Sort != "progress" || query.Limit != 20 || query.Offset != 40 {
		t.Fatalf("unexpected query: %+v", query)
	}
}

func TestParseBookQueryRejectsInvalidFinishedYear(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/books?finishedYear=not-a-year", nil)
	if _, err := parseBookQuery(request); err == nil {
		t.Fatal("parseBookQuery() should reject an invalid finished year")
	}
}

func TestParseBookQueryReadsCollectionYear(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/books?collectionYear=2025", nil)
	query, err := parseBookQuery(request)
	if err != nil {
		t.Fatalf("parseBookQuery() error = %v", err)
	}
	if query.CollectionYear != 2025 {
		t.Fatalf("collection year = %d, want 2025", query.CollectionYear)
	}
}

func TestParseBookQueryRejectsBothYearFilters(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/books?finishedYear=2024&collectionYear=2025", nil)
	if _, err := parseBookQuery(request); err == nil {
		t.Fatal("parseBookQuery() should reject simultaneous year filters")
	}
}

func TestParseBookQueryRejectsUnsupportedStatus(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/books?status=archived", nil)
	if _, err := parseBookQuery(request); err == nil {
		t.Fatal("parseBookQuery() should reject an unsupported status")
	}
}

func TestParsePagination(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/want-to-read?limit=16&offset=32", nil)
	limit, offset, err := parsePagination(request, 24)
	if err != nil {
		t.Fatalf("parsePagination() error = %v", err)
	}
	if limit != 16 || offset != 32 {
		t.Fatalf("pagination = (%d, %d), want (16, 32)", limit, offset)
	}
}

func TestParseAnnotationQuery(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/annotations?q=%E6%91%98%E5%BD%95&kind=note&style=3&limit=12&offset=24", nil)
	query, err := parseAnnotationQuery(request)
	if err != nil {
		t.Fatalf("parseAnnotationQuery() error = %v", err)
	}
	if query.Search != "摘录" || query.Kind != "note" || query.Style != 3 || query.Limit != 12 || query.Offset != 24 {
		t.Fatalf("unexpected query: %+v", query)
	}
}

func TestParseAnnotationQueryUsesAllStylesByDefault(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/annotations", nil)
	query, err := parseAnnotationQuery(request)
	if err != nil {
		t.Fatalf("parseAnnotationQuery() error = %v", err)
	}
	if query.Style != -1 {
		t.Fatalf("style = %d, want -1", query.Style)
	}
}

func TestParseAnnotationQueryRejectsUnsupportedKind(t *testing.T) {
	request := httptest.NewRequest("GET", "/api/annotations?kind=drawing", nil)
	if _, err := parseAnnotationQuery(request); err == nil {
		t.Fatal("parseAnnotationQuery() should reject an unsupported kind")
	}
}
