# pdf-inspector reference

## Upstream

- Repository: <https://github.com/firecrawl/pdf-inspector>
- Studied revision: `a15ec2d68d51dbe6a39d1da688ec7a3f642d846c` (2026-08-01 UTC)
- Python package observed: `pdf-inspector` 0.2.6
- License: MIT

The Rust parser loads the PDF once, classifies pages, extracts positioned text and drawing rectangles, determines reading order, detects tables, and then emits Markdown. It is local and does not call an LLM, OCR engine, or hosted service.

## Preserved structures

- Heading levels inferred from clustered font sizes
- Bold, italic, underline, and strikeout metadata where encoded
- Bulleted, numbered, and lettered lists
- Monospace code blocks
- Rectangle-based and alignment-based tables, including financial tables
- Multi-column and right-to-left reading order
- Hyperlinks, captions, hyphenation repair, and page-number filtering

## Classification and OCR boundary

The result classifies a document as `text_based`, `scanned`, `image_based`, or `mixed`. `pages_needing_ocr` and `ocr_reasons_by_page` identify unusable text layers, scanned pages, blank/unreachable text, or vector-outline text. `has_encoding_issues` flags suspicious font decoding.

`process_pdf(..., pages=[...])` accepts 1-indexed pages. The separate `extract_pages_markdown` Python API accepts 0-indexed pages. The bundled script exposes a consistent 1-indexed `--pages` option, converts it internally for `extract_pages_markdown`, and adds page markers to selected-page output.

## Limitations

- Do not expect text from raster images, scans, charts, or outlined/vector glyphs.
- Treat mixed documents as partial unless all OCR-required pages are handled elsewhere.
- Encrypted PDF passwords are supported by the Rust CLI but are not exposed by the studied Python `process_pdf` binding. Use the upstream `pdf2md --password` CLI or decrypt an authorized copy before conversion.
- Rare font encodings and unusual layouts can still produce omissions or poor order. Spot-check high-value documents.
- At the studied revision, upstream issue #200 reports that isolated digit-only text runs can be dropped. Verify numeric-heavy documents carefully.

## Output behavior used by this skill

The bundled wrapper writes ordinary Markdown from `result.markdown`. When OCR pages or encoding issues exist, it prepends an HTML warning comment. It refuses to overwrite existing files unless `--force` is supplied and never writes an empty file for fully scanned/image-only input.
