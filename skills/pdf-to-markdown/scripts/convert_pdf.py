#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.8"
# dependencies = ["pdf-inspector>=0.2.6,<0.3"]
# ///
"""Convert native-text PDFs to Markdown with explicit OCR warnings."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from types import SimpleNamespace
from typing import List, Optional, Sequence, Set

import pdf_inspector


PARTIAL_EXIT = 2


def parse_pages(spec: str) -> List[int]:
    """Parse a 1-indexed page specification such as 1,3,5-8."""
    pages: Set[int] = set()
    for raw_part in spec.split(","):
        part = raw_part.strip()
        if not part:
            raise argparse.ArgumentTypeError("empty item in page specification")
        if "-" in part:
            if part.count("-") != 1:
                raise argparse.ArgumentTypeError("invalid page range: {0}".format(part))
            raw_start, raw_end = part.split("-", 1)
            try:
                start, end = int(raw_start), int(raw_end)
            except ValueError:
                raise argparse.ArgumentTypeError("invalid page range: {0}".format(part))
            if start < 1 or end < 1 or start > end:
                raise argparse.ArgumentTypeError("invalid 1-indexed page range: {0}".format(part))
            pages.update(range(start, end + 1))
        else:
            try:
                page = int(part)
            except ValueError:
                raise argparse.ArgumentTypeError("invalid page number: {0}".format(part))
            if page < 1:
                raise argparse.ArgumentTypeError("page numbers are 1-indexed")
            pages.add(page)
    return sorted(pages)


def format_ocr_reasons(result: object, selected: Optional[Set[int]]) -> List[str]:
    formatted: List[str] = []
    for entry in getattr(result, "ocr_reasons_by_page", []) or []:
        page = int(getattr(entry, "page"))
        if selected is not None and page not in selected:
            continue
        reasons = list(getattr(entry, "reasons", []) or [])
        formatted.append("{0} ({1})".format(page, ", ".join(reasons) or "unspecified"))
    return formatted


def warning_comment(ocr_pages: Sequence[int], encoding_issues: bool) -> str:
    details: List[str] = []
    if ocr_pages:
        details.append("pages requiring OCR were omitted or may be incomplete: {0}".format(
            ", ".join(str(page) for page in ocr_pages)
        ))
    if encoding_issues:
        details.append("the PDF text layer has suspected encoding issues")
    return "<!-- pdf-to-markdown: PARTIAL OUTPUT; {0}. -->\n\n".format("; ".join(details))


def process_source(source: Path, pages: Optional[List[int]]) -> object:
    """Use the combined API for full documents and the per-page API for selections."""
    if pages is None:
        return pdf_inspector.process_pdf(str(source))

    detection = pdf_inspector.detect_pdf(str(source))
    page_count = int(detection.page_count)
    out_of_range = [page for page in pages if page > page_count]
    if out_of_range:
        raise ValueError(
            "requested pages exceed document page count {0}: {1}".format(
                page_count, ", ".join(map(str, out_of_range))
            )
        )

    extracted = pdf_inspector.extract_pages_markdown(
        str(source), pages=[page - 1 for page in pages]
    )
    markdown_parts: List[str] = []
    for page in extracted.pages:
        if page.markdown.strip():
            markdown_parts.append(
                "<!-- Page {0} -->\n\n{1}".format(page.page + 1, page.markdown.strip())
            )

    reasons = list(getattr(extracted, "ocr_reasons_by_page", []) or [])
    has_encoding_issues = any(
        "suspected_garbled_text" in (getattr(entry, "reasons", []) or [])
        for entry in reasons
    )
    return SimpleNamespace(
        pdf_type=detection.pdf_type,
        markdown="\n\n".join(markdown_parts),
        page_count=page_count,
        confidence=detection.confidence,
        pages_needing_ocr=list(extracted.pages_needing_ocr),
        ocr_reasons_by_page=reasons,
        has_encoding_issues=has_encoding_issues,
    )


def resolve_output(
    input_path: Path,
    explicit_output: Optional[Path],
    output_dir: Optional[Path],
) -> Path:
    if explicit_output is not None:
        return explicit_output.expanduser().resolve()
    if output_dir is not None:
        return output_dir.expanduser().resolve() / (input_path.stem + ".md")
    return input_path.with_suffix(".md")


def write_markdown(path: Path, markdown: str, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError("output already exists (use --force to overwrite): {0}".format(path))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(markdown, encoding="utf-8")


def convert_one(
    input_path: Path,
    output_path: Optional[Path],
    pages: Optional[List[int]],
    strict: bool,
    force: bool,
    to_stdout: bool,
) -> int:
    source = input_path.expanduser().resolve()
    if not source.is_file():
        print("ERROR: input PDF does not exist: {0}".format(source), file=sys.stderr)
        return 1

    try:
        result = process_source(source, pages)
    except Exception as exc:
        print("ERROR: failed to parse {0}: {1}".format(source, exc), file=sys.stderr)
        return 1

    selected = set(pages) if pages is not None else None
    ocr_pages = [
        int(page)
        for page in (getattr(result, "pages_needing_ocr", []) or [])
        if selected is None or int(page) in selected
    ]
    encoding_issues = bool(getattr(result, "has_encoding_issues", False))
    incomplete = bool(ocr_pages or encoding_issues)
    pdf_type = str(getattr(result, "pdf_type", "unknown"))
    markdown = getattr(result, "markdown", None) or ""

    print(
        "PDF: {0} | type={1} | pages={2} | confidence={3:.2f}".format(
            source,
            pdf_type,
            getattr(result, "page_count", "?"),
            float(getattr(result, "confidence", 0.0)),
        ),
        file=sys.stderr,
    )

    if ocr_pages:
        print("OCR required on pages: {0}".format(", ".join(map(str, ocr_pages))), file=sys.stderr)
        reasons = format_ocr_reasons(result, selected)
        if reasons:
            print("OCR reasons: {0}".format("; ".join(reasons)), file=sys.stderr)
    if encoding_issues:
        print("WARNING: suspected text-layer encoding issues", file=sys.stderr)

    if strict and incomplete:
        print("ERROR: strict mode refused incomplete conversion", file=sys.stderr)
        return PARTIAL_EXIT

    if not markdown.strip():
        if pdf_type in ("scanned", "image_based") or incomplete:
            print("ERROR: no usable Markdown; OCR is required", file=sys.stderr)
            return PARTIAL_EXIT
        print("ERROR: parser returned empty Markdown", file=sys.stderr)
        return 1

    if incomplete:
        markdown = warning_comment(ocr_pages, encoding_issues) + markdown.lstrip()
    if not markdown.endswith("\n"):
        markdown += "\n"

    if to_stdout:
        sys.stdout.write(markdown)
    else:
        assert output_path is not None
        try:
            write_markdown(output_path, markdown, force)
        except (OSError, UnicodeError) as exc:
            print("ERROR: could not write {0}: {1}".format(output_path, exc), file=sys.stderr)
            return 1
        print("Wrote: {0}".format(output_path), file=sys.stderr)

    return PARTIAL_EXIT if incomplete else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Convert native-text PDFs to Markdown using Firecrawl pdf-inspector."
    )
    parser.add_argument("inputs", nargs="+", type=Path, help="one or more input PDF files")
    destination = parser.add_mutually_exclusive_group()
    destination.add_argument("-o", "--output", type=Path, help="output .md path (one input only)")
    destination.add_argument("--output-dir", type=Path, help="directory for generated .md files")
    destination.add_argument("--stdout", action="store_true", help="write Markdown to stdout (one input only)")
    parser.add_argument("--pages", type=parse_pages, help="1-indexed pages, e.g. 1,3,5-8")
    parser.add_argument("--strict", action="store_true", help="refuse output if any selected page needs OCR")
    parser.add_argument("--force", action="store_true", help="overwrite existing Markdown files")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    if len(args.inputs) > 1 and (args.output is not None or args.stdout):
        parser.error("--output and --stdout require exactly one input")

    statuses: List[int] = []
    for input_path in args.inputs:
        output_path = None
        if not args.stdout:
            output_path = resolve_output(input_path.expanduser().resolve(), args.output, args.output_dir)
        statuses.append(
            convert_one(
                input_path=input_path,
                output_path=output_path,
                pages=args.pages,
                strict=args.strict,
                force=args.force,
                to_stdout=args.stdout,
            )
        )

    if any(status == 1 for status in statuses):
        return 1
    if any(status == PARTIAL_EXIT for status in statuses):
        return PARTIAL_EXIT
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
