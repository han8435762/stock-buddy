---
name: pdf-to-markdown
description: Convert local PDF files into structured Markdown with Firecrawl's pdf-inspector, preserving headings, lists, tables, links, formatting, and multi-column reading order. Use when Codex needs to turn one or many .pdf files into .md files, extract selected PDF pages as Markdown, or determine which PDF pages need OCR. Best for native-text PDFs; detect scanned, image-only, mixed, and broken-encoding pages without pretending that incomplete output is complete.
---

# PDF to Markdown

Convert PDFs locally with the bundled script. Treat OCR requirements as a quality signal, not as a successful full conversion.

## Convert

1. Resolve every input and output path before running the script.
2. Run the script directly; its inline dependency declaration lets `uv` provide a compatible `pdf-inspector` release:

```bash
/absolute/path/to/pdf-to-markdown/scripts/convert_pdf.py /absolute/path/to/input.pdf
```

3. Use the relevant options:

```bash
# Choose an output file
convert_pdf.py input.pdf --output output.md

# Convert several files into one directory
convert_pdf.py one.pdf two.pdf --output-dir ./markdown

# Convert selected 1-indexed pages
convert_pdf.py input.pdf --pages 1,3,5-8

# Print one conversion to stdout
convert_pdf.py input.pdf --stdout

# Refuse any document that has pages requiring OCR
convert_pdf.py input.pdf --strict
```

4. Do not add `--force` unless overwriting the resolved output is explicitly intended.
5. Report the created Markdown path and any OCR-required pages to the user.

If direct execution reports that `uv` is unavailable, install `uv` or run the script with a Python environment that already contains `pdf-inspector>=0.2.6,<0.3`.

## Interpret Results

- Exit `0`: complete native-text conversion succeeded.
- Exit `2`: partial Markdown was written, or the PDF needs OCR and no usable Markdown could be written. Read stderr and inspect the output warning comment.
- Exit `1`: invalid input, dependency failure, parse error, or unsafe output collision.

For mixed PDFs, keep the partial Markdown by default and retain the leading HTML warning comment. For scanned or image-only PDFs, do not create an empty `.md`; tell the user that OCR is required. Use another OCR-capable tool only when the user asks to continue beyond this skill's local extraction boundary.

Selected-page output includes `<!-- Page N -->` markers so that the source page remains traceable.

## Verify

After conversion:

1. Confirm the output exists and is non-empty.
2. Check the first lines for `pdf-to-markdown: PARTIAL OUTPUT`.
3. Spot-check headings, table pipes, list indentation, and reading order when layout matters.
4. Warn that charts and raster images are not transcribed because pdf-inspector has no OCR or vision model.

Read [references/pdf-inspector.md](references/pdf-inspector.md) when debugging extraction behavior, page numbering, encrypted PDFs, or upstream limitations.
