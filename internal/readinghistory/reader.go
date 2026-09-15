package readinghistory

import (
	"context"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	"net/url"
	"path/filepath"
	"sort"

	_ "modernc.org/sqlite"
)

const (
	crdtHeaderSize = 8
	modelType      = "ReadingHistoryModel"
)

type Month struct {
	Month   int
	Seconds int64
	Days    int
}

type Year struct {
	Year    int
	Seconds int64
	Days    int
	Months  []Month
}

type Reader struct {
	database *sql.DB
}

func Open(path string) (*Reader, error) {
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("resolve reading history database: %w", err)
	}
	dsn := (&url.URL{Scheme: "file", Path: absolutePath, RawQuery: "mode=ro"}).String()
	database, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open reading history database: %w", err)
	}
	if err := database.Ping(); err != nil {
		_ = database.Close()
		return nil, fmt.Errorf("read reading history database: %w", err)
	}
	var count int
	if err := database.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='ZCRDTMODELSYNCENTITY'`).Scan(&count); err != nil || count != 1 {
		_ = database.Close()
		return nil, errors.New("reading history database has an unsupported schema")
	}
	return &Reader{database: database}, nil
}

func (r *Reader) Close() error { return r.database.Close() }

func (r *Reader) Year(ctx context.Context, year int) (Year, error) {
	model, err := r.model(ctx)
	if err != nil {
		return Year{}, err
	}
	return model.year(year)
}

func (r *Reader) Years(ctx context.Context) ([]int, error) {
	model, err := r.model(ctx)
	if err != nil {
		return nil, err
	}
	years := make(map[int]struct{})
	for key := range model.months {
		years[key/100] = struct{}{}
	}
	result := make([]int, 0, len(years))
	for year := range years {
		result = append(result, year)
	}
	sort.Sort(sort.Reverse(sort.IntSlice(result)))
	return result, nil
}

func (r *Reader) model(ctx context.Context) (decodedModel, error) {
	var data []byte
	err := r.database.QueryRowContext(ctx, `
		SELECT ZPROTODATA FROM ZCRDTMODELSYNCENTITY
		WHERE ZTYPE = ? AND COALESCE(ZDELETEDFLAG, 0) = 0
		ORDER BY ZMODIFICATIONDATE DESC LIMIT 1`, modelType).Scan(&data)
	if err != nil {
		return decodedModel{}, fmt.Errorf("load reading history model: %w", err)
	}
	return decode(data)
}

type decodedModel struct {
	months  map[int]*object
	objects map[string]*object
}

func (m decodedModel) year(year int) (Year, error) {
	result := Year{Year: year, Months: make([]Month, 12)}
	for index := range result.Months {
		result.Months[index].Month = index + 1
		monthObject := m.months[year*100+index+1]
		if monthObject == nil {
			continue
		}
		seconds, _ := registerValue(monthObject.fields["totalTime"])
		days := dictionaryReferences(monthObject.fields["days"])
		for _, dayID := range days {
			day := m.objects[dayID]
			if day == nil {
				continue
			}
			readingSeconds, ok := counterValue(day.fields["readingTime"])
			if !ok {
				continue
			}
			seconds += readingSeconds
			if readingSeconds > 0 {
				result.Months[index].Days++
			}
		}
		result.Months[index].Seconds = seconds
		result.Seconds += seconds
		result.Days += result.Months[index].Days
	}
	return result, nil
}

type object struct {
	id     string
	fields map[string]wireField
}

func decode(data []byte) (decodedModel, error) {
	if len(data) < crdtHeaderSize || string(data[:4]) != "crdt" {
		return decodedModel{}, errors.New("reading history data has an unsupported CRDT header")
	}
	version := binary.LittleEndian.Uint32(data[4:8])
	if version != 4 {
		return decodedModel{}, fmt.Errorf("reading history CRDT version %d is unsupported; expected version 4", version)
	}
	root, err := parseMessage(data[crdtHeaderSize:])
	if err != nil {
		return decodedModel{}, fmt.Errorf("decode reading history CRDT: %w", err)
	}
	model := decodedModel{months: make(map[int]*object), objects: make(map[string]*object)}
	for _, field := range root.number(2) {
		candidate, ok := parseObject(field.data)
		if ok {
			model.objects[candidate.id] = candidate
		}
	}
	monthsField, ok := findNamedField(root, "months")
	if !ok {
		return decodedModel{}, errors.New("reading history CRDT does not contain months")
	}
	for key, id := range dictionaryReferences(monthsField) {
		if month := model.objects[id]; month != nil {
			model.months[key] = month
		}
	}
	if len(model.months) == 0 {
		return decodedModel{}, errors.New("reading history CRDT contains no readable months")
	}
	return model, nil
}

func parseObject(data []byte) (*object, bool) {
	message, err := parseMessage(data)
	if err != nil {
		return nil, false
	}
	idField, ok := message.first(1)
	if !ok || len(idField.data) != 16 {
		return nil, false
	}
	fields := make(map[string]wireField)
	if container, ok := message.first(3); ok {
		containerMessage, _ := parseMessage(container.data)
		for _, entriesField := range containerMessage.number(4) {
			entries, err := parseMessage(entriesField.data)
			if err != nil {
				continue
			}
			for _, entryField := range entries.number(1) {
				entry, err := parseMessage(entryField.data)
				if err != nil {
					continue
				}
				name, hasName := entry.first(1)
				value, hasValue := entry.first(2)
				if hasName && hasValue {
					fields[string(name.data)] = value
				}
			}
		}
	}
	return &object{id: string(idField.data), fields: fields}, true
}

func findNamedField(message wireMessage, name string) (wireField, bool) {
	for _, field := range message.fields {
		if field.wireType != 2 {
			continue
		}
		child, err := parseMessage(field.data)
		if err != nil {
			continue
		}
		if nameField, ok := child.first(1); ok && string(nameField.data) == name {
			if value, ok := child.first(2); ok {
				return value, true
			}
		}
		if value, ok := findNamedField(child, name); ok {
			return value, true
		}
	}
	return wireField{}, false
}

func dictionaryReferences(value wireField) map[int]string {
	result := make(map[int]string)
	message, err := parseMessage(value.data)
	if err != nil {
		return result
	}
	visitMessages(message, func(candidate wireMessage) {
		keyWrapper, hasKey := candidate.first(1)
		valueWrapper, hasValue := candidate.first(2)
		if !hasKey || !hasValue {
			return
		}
		keyMessage, err := parseMessage(keyWrapper.data)
		if err != nil {
			return
		}
		key, ok := keyMessage.first(1)
		if !ok || key.wireType != 0 || key.varint > 99999999 {
			return
		}
		if id := referencedObjectID(valueWrapper.data); id != "" {
			result[int(key.varint)] = id
		}
	})
	return result
}

func referencedObjectID(data []byte) string {
	message, err := parseMessage(data)
	if err != nil {
		return ""
	}
	var result string
	visitMessages(message, func(candidate wireMessage) {
		if result != "" {
			return
		}
		for _, field := range candidate.number(6) {
			payload, err := parseMessage(field.data)
			if err != nil {
				continue
			}
			if id, ok := payload.first(1); ok && len(id.data) == 16 {
				result = string(id.data)
				return
			}
		}
	})
	return result
}

func registerValue(value wireField) (int64, bool) {
	message, err := parseMessage(value.data)
	if err != nil {
		return 0, false
	}
	first, ok := message.first(1)
	if !ok {
		return 0, false
	}
	register, err := parseMessage(first.data)
	if err != nil {
		return 0, false
	}
	payload, ok := register.first(3)
	if !ok {
		return 0, false
	}
	decoded, err := parseMessage(payload.data)
	if err != nil {
		return 0, false
	}
	number, ok := decoded.first(1)
	if !ok || number.wireType != 0 || number.varint > uint64(^uint64(0)>>1) {
		return 0, false
	}
	return int64(number.varint), true
}

func counterValue(value wireField) (int64, bool) {
	message, err := parseMessage(value.data)
	if err != nil {
		return 0, false
	}
	counter, ok := message.first(7)
	if !ok {
		return 0, false
	}
	counterMessage, err := parseMessage(counter.data)
	if err != nil {
		return 0, false
	}
	components, ok := counterMessage.first(2)
	if !ok {
		return 0, false
	}
	componentsMessage, err := parseMessage(components.data)
	if err != nil {
		return 0, false
	}
	var total int64
	var found bool
	for _, componentField := range componentsMessage.number(1) {
		component, err := parseMessage(componentField.data)
		if err != nil {
			continue
		}
		identifier, hasIdentifier := component.first(1)
		encoded, hasValue := component.first(2)
		if !hasIdentifier || len(identifier.data) != 16 || !hasValue || len(encoded.data) < 2 {
			continue
		}
		amount, bytesRead := binary.Uvarint(encoded.data[1:])
		if bytesRead <= 0 || amount > uint64(^uint64(0)>>1) {
			continue
		}
		if encoded.data[0] == 0 {
			total += int64(amount)
		} else {
			total -= int64(amount)
		}
		found = true
	}
	return total, found
}

type wireField struct {
	number   int
	wireType int
	varint   uint64
	data     []byte
}

type wireMessage struct{ fields []wireField }

func (m wireMessage) first(number int) (wireField, bool) {
	for _, field := range m.fields {
		if field.number == number {
			return field, true
		}
	}
	return wireField{}, false
}

func (m wireMessage) number(number int) []wireField {
	result := make([]wireField, 0)
	for _, field := range m.fields {
		if field.number == number {
			result = append(result, field)
		}
	}
	return result
}

func parseMessage(data []byte) (wireMessage, error) {
	message := wireMessage{}
	for len(data) > 0 {
		key, size := binary.Uvarint(data)
		if size <= 0 {
			return wireMessage{}, errors.New("invalid protobuf field key")
		}
		data = data[size:]
		field := wireField{number: int(key >> 3), wireType: int(key & 7)}
		if field.number == 0 {
			return wireMessage{}, errors.New("invalid protobuf field number")
		}
		switch field.wireType {
		case 0:
			field.varint, size = binary.Uvarint(data)
			if size <= 0 {
				return wireMessage{}, errors.New("invalid protobuf varint")
			}
			data = data[size:]
		case 1:
			if len(data) < 8 {
				return wireMessage{}, errors.New("truncated protobuf fixed64")
			}
			field.data, data = data[:8], data[8:]
		case 2:
			length, lengthSize := binary.Uvarint(data)
			if lengthSize <= 0 || length > uint64(len(data)-lengthSize) {
				return wireMessage{}, errors.New("invalid protobuf bytes length")
			}
			data = data[lengthSize:]
			field.data, data = data[:int(length)], data[int(length):]
		case 5:
			if len(data) < 4 {
				return wireMessage{}, errors.New("truncated protobuf fixed32")
			}
			field.data, data = data[:4], data[4:]
		default:
			return wireMessage{}, fmt.Errorf("unsupported protobuf wire type %d", field.wireType)
		}
		message.fields = append(message.fields, field)
	}
	return message, nil
}

func visitMessages(message wireMessage, visit func(wireMessage)) {
	visit(message)
	for _, field := range message.fields {
		if field.wireType != 2 {
			continue
		}
		child, err := parseMessage(field.data)
		if err == nil {
			visitMessages(child, visit)
		}
	}
}
