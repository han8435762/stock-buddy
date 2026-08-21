#!/usr/bin/env python3
"""Inventory financial-report Markdown files under a StockBuddy company root."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


DATE_RE = re.compile(r"^(20\d{6})_")
SUPPORTING_TERMS = (
    "审计报告",
    "内部控制",
    "资金占用",
    "关联交易",
    "会计差错",
    "更正公告",
    "问询函",
    "问询回复",
    "会计师事务所",
    "业绩预告",
    "业绩快报",
)


def resolve_company_root(raw: str | None) -> Path:
    start = Path(raw).expanduser() if raw else Path.cwd()
    start = start.resolve()
    if start.is_file():
        start = start.parent
    for candidate in (start, *start.parents):
        if (candidate / "02_转换资料").is_dir():
            return candidate
    raise FileNotFoundError(f"找不到 02_转换资料/: {start}")


def classify(name: str) -> tuple[str, int] | None:
    if "摘要" in name:
        if "年度报告" in name or "半年度报告" in name:
            return ("摘要（仅备用）", 5)
        return None
    if "半年度报告" in name:
        return ("半年度报告", 2)
    if "年度报告" in name and not any(term in name for term in ("社会责任", "履职", "评估")):
        return ("年度报告", 1)
    if re.search(r"第?[一二三四1-4]季度报告|季度报告", name):
        return ("季度报告", 3)
    if any(term in name for term in SUPPORTING_TERMS):
        return ("核查辅助资料", 4)
    return None


def inventory(root: Path) -> list[dict[str, object]]:
    converted = root / "02_转换资料"
    rows: list[dict[str, object]] = []
    for path in converted.rglob("*.md"):
        detected = classify(path.name)
        if not detected:
            continue
        category, priority = detected
        match = DATE_RE.match(path.name)
        rows.append(
            {
                "category": category,
                "priority": priority,
                "document_date": match.group(1) if match else "",
                "size_bytes": path.stat().st_size,
                "path": str(path.resolve()),
            }
        )
    return sorted(rows, key=lambda row: (int(row["priority"]), -int(row["document_date"] or 0), str(row["path"])))


def print_markdown(root: Path, rows: list[dict[str, object]]) -> None:
    print(f"公司目录: {root}")
    print(f"候选资料: {len(rows)} 个\n")
    print("| 类型 | 公告日期 | 大小(KiB) | 路径 |")
    print("|---|---:|---:|---|")
    for row in rows:
        size_kib = int(row["size_bytes"]) / 1024
        print(f"| {row['category']} | {row['document_date'] or '-'} | {size_kib:.1f} | {row['path']} |")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("company_root", nargs="?", help="公司目录；省略时从当前目录向上查找")
    parser.add_argument("--json", action="store_true", help="输出 JSON")
    args = parser.parse_args()
    try:
        root = resolve_company_root(args.company_root)
        rows = inventory(root)
    except (FileNotFoundError, OSError) as exc:
        print(f"错误: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps({"company_root": str(root), "reports": rows}, ensure_ascii=False, indent=2))
    else:
        print_markdown(root, rows)
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
