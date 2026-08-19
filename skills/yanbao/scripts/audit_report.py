#!/usr/bin/env python3
"""Fail fast when a generated A-share research report is structurally incomplete."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


REQUIRED_GROUPS = {
    "核心摘要": r"核心摘要",
    "产业链与行业供需": r"产业链.*(?:供需|竞争)|供需.*(?:产业链|行业)",
    "成本定价与价格周期": r"成本.*定价|定价.*价格周期|成本.*价格周期",
    "政策贸易与ESG": r"政策.*(?:贸易|ESG)|贸易.*(?:政策|ESG)",
    "公司业务与商业模式": r"业务结构.*商业模式|商业模式.*业务结构",
    "产能产量与产销": r"产能.*(?:产量|产销)|产销.*产能",
    "利润表": r"利润表",
    "资产负债表": r"资产负债表",
    "现金流量表": r"现金流量表",
    "量价归因与杜邦": r"量价.*杜邦|杜邦.*量价",
    "自由现金流": r"自由现金流|\bFCF\b",
    "财务与治理排雷": r"(?:财务|治理).*排雷|排雷.*(?:财务|治理)",
    "审计核查": r"审计(?:信息|意见|机构|核查|排雷)",
    "竞争与护城河": r"竞争.*护城河|护城河.*竞争",
    "十大流通股东": r"十大流通股东",
    "未来三年预测": r"未来三年|未来3年|三年预测|3年预测",
    "估值快照与历史分位": r"估值快照.*历史分位|历史分位.*估值",
    "多方法三情景估值": r"(?:多方法|可比公司|历史估值|DCF|SOTP|正常化盈利).*(?:三情景|悲观.*中性.*乐观)",
    "敏感性与压力测试": r"敏感性.*压力测试|压力测试.*敏感性",
    "操作策略": r"操作策略|操作区间",
    "风险提示": r"风险(?:提示|反证|失效条件)",
    "催化剂时间轴": r"催化剂.*时间轴|时间轴.*催化剂",
    "跟踪指标": r"跟踪指标",
    "关键数据核对": r"关键数据核对",
    "资料来源与口径": r"资料来源.*口径|口径.*资料来源",
    "重要声明": r"重要声明|不构成.*投资建议",
}


def visible_char_count(text: str) -> int:
    stripped = re.sub(r"```.*?```", "", text, flags=re.S)
    stripped = re.sub(r"[#>*_`|\-\s]", "", stripped)
    return len(stripped)


def audit(path: Path, brief: bool) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    compact = re.sub(r"\s+", "", text)
    min_chars = 3000 if brief else 8000
    min_tables = 6 if brief else 12
    table_count = len(re.findall(r"^\s*\|?(?:\s*:?-{3,}:?\s*\|){2,}", text, flags=re.M))
    chars = visible_char_count(text)
    missing = [name for name, pattern in REQUIRED_GROUPS.items() if not re.search(pattern, compact, re.I)]
    unresolved = sorted(set(re.findall(r"\[(?:待补充|TBD|TODO)[^\]]*\]", text, re.I)))
    failures = []
    if chars < min_chars:
        failures.append(f"有效字符数 {chars} < {min_chars}")
    if table_count < min_tables:
        failures.append(f"Markdown表格数 {table_count} < {min_tables}")
    if missing:
        failures.append("缺少模块：" + "、".join(missing))
    if unresolved:
        failures.append("存在未解释占位符：" + "、".join(unresolved[:10]))
    return {
        "path": str(path),
        "mode": "brief" if brief else "full",
        "visible_characters": chars,
        "markdown_tables": table_count,
        "missing_groups": missing,
        "unresolved_placeholders": unresolved,
        "passed": not failures,
        "failures": failures,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="生成的Markdown研报")
    parser.add_argument("--brief", action="store_true", help="仅用于用户明确要求的简报")
    parser.add_argument("--json", action="store_true", help="以JSON输出结果")
    args = parser.parse_args()
    if not args.report.is_file():
        parser.error(f"文件不存在：{args.report}")
    result = audit(args.report, args.brief)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        status = "PASS" if result["passed"] else "FAIL"
        print(f"[{status}] {result['path']}")
        print(f"模式={result['mode']} 有效字符={result['visible_characters']} 表格={result['markdown_tables']}")
        for failure in result["failures"]:
            print(f"- {failure}")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
