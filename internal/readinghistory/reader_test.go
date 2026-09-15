package readinghistory

import (
	"encoding/binary"
	"strings"
	"testing"
)

func TestDecodeAnnualReadingTime(t *testing.T) {
	monthID := testID(1)
	dayID := testID(2)
	actorID := testID(3)
	readingTime := testBytesField(7, testMessage(
		testBytesField(2, testMessage(
			testBytesField(1, testMessage(
				testBytesField(1, actorID),
				testBytesField(2, append([]byte{0}, testVarintBytes(120)...)),
			)),
		)),
	))
	totalTime := testBytesField(1, testMessage(
		testBytesField(3, testMessage(testVarintField(1, 3600))),
	))
	days := testDictionary(15, dayID)
	months := testDictionary(202601, monthID)
	payload := testMessage(
		testNamedField("months", months),
		testBytesField(2, testObject(monthID, map[string][]byte{"days": days, "totalTime": totalTime})),
		testBytesField(2, testObject(dayID, map[string][]byte{"readingTime": readingTime})),
	)
	data := append([]byte("crdt\x04\x00\x00\x00"), payload...)

	model, err := decode(data)
	if err != nil {
		t.Fatalf("decode() error = %v", err)
	}
	year, err := model.year(2026)
	if err != nil {
		t.Fatalf("year() error = %v", err)
	}
	if year.Seconds != 3720 || year.Days != 1 {
		t.Fatalf("year = %+v, want 3720 seconds and 1 day", year)
	}
	if year.Months[0].Seconds != 3720 || year.Months[0].Days != 1 {
		t.Fatalf("January = %+v, want 3720 seconds and 1 day", year.Months[0])
	}
}

func TestDecodeRejectsUnknownCRDTVersion(t *testing.T) {
	_, err := decode([]byte("crdt\x06\x00\x00\x00"))
	if err == nil || !strings.Contains(err.Error(), "version 6") {
		t.Fatalf("decode() error = %v, want explicit version error", err)
	}
}

func testObject(id []byte, fields map[string][]byte) []byte {
	entries := make([]byte, 0)
	for name, value := range fields {
		entries = append(entries, testBytesField(1, testMessage(
			testBytesField(1, []byte(name)),
			testBytesField(2, value),
		))...)
	}
	return testMessage(
		testBytesField(1, id),
		testBytesField(3, testMessage(testBytesField(4, entries))),
	)
}

func testNamedField(name string, value []byte) []byte {
	return testBytesField(1, testMessage(
		testBytesField(1, []byte(name)),
		testBytesField(2, value),
	))
}

func testDictionary(key uint64, id []byte) []byte {
	candidate := testMessage(
		testBytesField(1, testMessage(testVarintField(1, key))),
		testBytesField(2, testMessage(testBytesField(6, testMessage(testBytesField(1, id))))),
	)
	return testMessage(testBytesField(1, candidate))
}

func testID(seed byte) []byte {
	id := make([]byte, 16)
	for index := range id {
		id[index] = seed
	}
	return id
}

func testMessage(fields ...[]byte) []byte {
	var result []byte
	for _, field := range fields {
		result = append(result, field...)
	}
	return result
}

func testBytesField(number int, data []byte) []byte {
	result := testVarintBytes(uint64(number<<3 | 2))
	result = append(result, testVarintBytes(uint64(len(data)))...)
	return append(result, data...)
}

func testVarintField(number int, value uint64) []byte {
	result := testVarintBytes(uint64(number << 3))
	return append(result, testVarintBytes(value)...)
}

func testVarintBytes(value uint64) []byte {
	var buffer [binary.MaxVarintLen64]byte
	size := binary.PutUvarint(buffer[:], value)
	return append([]byte(nil), buffer[:size]...)
}
