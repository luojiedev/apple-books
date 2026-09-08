# Apple Books Reading Archive

[简体中文](README.md) · **English**

A local reading archive and export tool for Apple Books. It never modifies the Apple Books databases or uploads your books, highlights, notes, or reading history.

The project focuses first on its most important job: giving you a complete, portable copy of your reading data from Apple Books.

## Key Features

- **Export highlights and notes from each book to Markdown**: includes the title, author, annotation type, and timestamps; when the original EPUB is available locally, entries are grouped by chapter and arranged in reading order
- Export the currently filtered library as a UTF-8 CSV file
- View the reading progress, highlights, notes, and bookmarks for an individual book
- Search the entire library by title, author, or category
- Filter books by not started, reading, or finished
- Browse the library by collection year and finished books by completion year
- Sort by recently opened, reading progress, title, or author
- Rediscover a random historical highlight, with an option to show only excerpts that include a personal note
- Search highlight text and notes across the library, with annotation-type and highlight-color filters
- Browse the Apple Books Want to Read collection below annotation search
- Set independent page sizes for annotations, Want to Read, and the library, with choices remembered in the browser
- Generate annual reports covering collected and finished books, annotation days, monthly activity, and most-annotated books
- Pick the next book from unread, stalled, or all books with the book picker
- Restore Apple Books highlight colors in annotation lists and book details
- Switch the interface between Chinese and English, with the preference remembered in the browser
- Process everything locally without loading third-party resources in the page

Apple Books does not store reliable cumulative reading time or a complete history of reading sessions, so this tool does not display estimated reading duration.

## Requirements

- Go 1.25 or later
- macOS is recommended so the tool can read the latest Apple Books data and local EPUB files directly
- Windows and Linux are supported after the SQLite databases have been copied manually from a Mac

## macOS: Read the Latest Data Automatically

Run the application directly on macOS:

```bash
go run ./cmd/apple-books
```

The application automatically finds the newest `.sqlite` files in:

```text
~/Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary/
~/Library/Containers/com.apple.iBooksX/Data/Documents/AEAnnotation/
```

Then open:

<http://127.0.0.1:8787>

Automatic discovery is recommended because recent Apple Books changes may still be stored in SQLite WAL files. The databases are opened in read-only mode, so the application can read those records without writing data or running migrations.

### iCloud Books and Annotation Sync

Apple Books may sync book metadata, ebook files, and annotations separately. A book appearing in your library or Reading Now list does not necessarily mean its highlights and notes have already been written to the local `AEAnnotation` database. For a book that exists only in iCloud and has not been downloaded, this tool may report that no local highlights or notes were found, and its exported Markdown may contain no annotation body.

If this happens:

1. Find the book in Apple Books and download it to the Mac.
2. Open the book once and wait for its highlights and notes to finish syncing.
3. Return to this tool, refresh the page, or reopen the book details.
4. If the annotations still do not appear, restart the tool so it establishes a new database connection.

This tool does not call private Apple APIs to force an iCloud download. Apple Books must perform the initial download and annotation sync. Access to the original EPUB mainly determines whether chapter titles can be resolved; exporting the highlight and note text depends on whether the corresponding records have reached the local `AEAnnotation` database.

The application does not load a permanent in-memory snapshot at startup. Every page request runs fresh read-only SQL queries. If Apple Books commits new annotations to the same SQLite database, refreshing the page or reopening the details will usually reveal them. The tool does not currently poll for changes or watch database files, however. If Apple Books replaces the database or WAL file during sync, an existing connection may continue to reference the old file, and the tool must be restarted.

### macOS Permissions

macOS may request permission the first time the Apple Books container is accessed. Grant access to the application that launches the tool, such as Terminal, iTerm, your IDE, or Codex.

If no prompt appears but the logs contain `operation not permitted` or `permission denied`:

1. Open System Settings.
2. Go to Privacy & Security → Full Disk Access.
3. Enable access for the Terminal, IDE, or Codex instance that launches the tool.
4. Quit that application completely, reopen it, and run the tool again.

The tool only needs read access and never needs permission to modify Apple Books data.

## Copy the Databases Manually

If direct access is unavailable or you prefer not to grant it, you can work from database snapshots. Quit Apple Books completely before copying the main databases and their matching `-wal` and `-shm` files:

```bash
mkdir -p BKLibrary AEAnnotation

cp ~/Library/Containers/com.apple.iBooksX/Data/Documents/BKLibrary/*.sqlite* \
  ./BKLibrary/

cp ~/Library/Containers/com.apple.iBooksX/Data/Documents/AEAnnotation/*.sqlite* \
  ./AEAnnotation/
```

On macOS, automatic discovery prefers the latest system databases when they remain accessible. To explicitly use the snapshots you copied, provide both database flags:

```bash
go run ./cmd/apple-books \
  -library-db "./BKLibrary/BKLibrary-1-091020131601.sqlite" \
  -annotation-db "./AEAnnotation/AEAnnotation_v10312011_1727_local.sqlite"
```

File names may vary between Apple Books versions, so use the actual `.sqlite` file names you copied. Both flags must be provided together.

You can also change the local listening port. To keep reading data off the local network, only loopback addresses are accepted:

```bash
go run ./cmd/apple-books \
  -library-db "/path/to/BKLibrary.sqlite" \
  -annotation-db "/path/to/AEAnnotation.sqlite" \
  -addr "127.0.0.1:9000"
```

## Windows and Linux

Windows and Linux cannot access the macOS Apple Books container directly. First quit Apple Books on a Mac, copy the databases as described above, and transfer the `BKLibrary` and `AEAnnotation` directories to the computer that will run this application.

From the project root, run:

```bash
go run ./cmd/apple-books \
  -library-db "/path/to/BKLibrary.sqlite" \
  -annotation-db "/path/to/AEAnnotation.sqlite"
```

Highlight and note text can still be exported from the SQLite databases, but chapter detection is usually limited. Stored book paths point to iCloud or Apple Books locations on the source Mac, so Windows and Linux cannot access those EPUB files. Markdown export will still include the annotations, label unresolved entries as `Unresolved chapter`, and preserve their original EPUB locations.

## Usage

### Export Highlights and Notes from a Book

1. Search for or locate the book in the library.
2. Select its card to open the detail view.
3. Select “Export highlights and notes”.
4. The browser downloads a Markdown file named after the book.

If the original EPUB is locally accessible and not restricted by DRM, the export uses its table of contents for chapter headings. When a chapter spans multiple HTML files, the application groups them under the correct chapter as well.

### Export the Library List

Set the search, reading status, year, and sort options, then select “Export current list” in the upper-right corner. The CSV contains only the currently filtered results.

### Random Review

The home page selects an entry from your historical highlights. Enable “Notes only” to review only excerpts that have a personal note attached. Select the book title to open its detail view.

### Search All Annotations

Use the annotation search area to find text in highlights and notes across the entire library. Results can be narrowed by annotation type and Apple Books highlight color. Select a book title in the results to open its full details.

### Annual Reports and Book Picker

Annual reports show monthly activity and annotation-active days based on annotation creation dates; an active day means an annotation was created and does not represent a complete reading day. The book picker can choose from unread books, in-progress books not opened for more than 90 days, or the whole library.

## Data Notes

- `BKLibrary` stores library metadata, reading progress, and related dates.
- `AEAnnotation` stores highlights, notes, bookmarks, and EPUB CFI locations.
- `ZANNOTATIONTYPE=3` represents a system-maintained reading position rather than a user annotation, so the application excludes it.
- Collection time uses the earliest valid value among the purchase date, the library record date (`ZUPDATEDATE`), and the database object creation date to reduce distortions caused by database migration.
- Apple Books uses a private database schema that Apple may change in a future macOS release.

## Chapter Detection Limitations

The annotation database does not store human-readable chapter titles. It stores EPUB CFI locations, which the application maps to chapters by reading the original EPUB package, spine, and table-of-contents files.

Chapter detection may fail when:

- The original EPUB has been deleted or has not been downloaded from iCloud
- The Apple Books databases came from another Mac
- The tool runs on Windows or Linux and cannot access the Mac paths recorded in the database
- The book is DRM-protected or its EPUB structure is incomplete
- The content is a PDF or another format that does not use EPUB CFI locations

A chapter detection failure does not prevent highlight and note text from being exported.

Keep in mind that access to the original EPUB only affects chapter detection. Highlight and note text comes from the `AEAnnotation` database. If Apple Books has not synced cloud annotations to the local database, that text cannot be exported either. Download and open the corresponding book in Apple Books first.

## Privacy and Security

- SQLite databases are always opened in read-only mode.
- The web server listens on `127.0.0.1` by default and is not exposed to the local network.
- The page does not upload books, annotations, or reading history.
- The page does not load remote covers, fonts, or analytics scripts.
- SQLite databases, WAL files, and runtime logs are excluded by `.gitignore`.

## Tests

```bash
go test ./...
```

Tests use the system Go build cache and do not create a `.cache` directory inside the project.

## Logs

Following the `slogx` convention, logs are written to `logs/` under the directory where the program runs. Check these logs first when investigating database permissions, schema compatibility, or EPUB chapter parsing errors.
