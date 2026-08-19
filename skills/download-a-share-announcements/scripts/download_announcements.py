#!/usr/bin/env python
# -*- coding: UTF-8 -*-

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import requests

SCRIPT_DIR = Path(__file__).parent
STOCK_LIST_PATH = SCRIPT_DIR / "stockList.json"
CONFIG_PATH = SCRIPT_DIR / "config.json"

BASE_URL = "https://www.cninfo.com.cn/new/hisAnnouncement/query"
PDF_BASE_URL = "https://static.cninfo.com.cn/"

HEADERS = {
    "Accept": "*/*",
    "Accept-Encoding": "gzip, deflate",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6",
    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
    "Host": "www.cninfo.com.cn",
    "Origin": "http://www.cninfo.com.cn",
    "Referer": "http://www.cninfo.com.cn/new/commonUrl/pageOfSearch?url=disclosure/list/search&checkedCategory=category_ndbg_szsh",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/113.0.0.0 Safari/537.36",
    "X-Requested-With": "XMLHttpRequest",
}

MAX_RETRIES = 3
RETRY_DELAY = 3
TIMEOUT = 15


def load_stock_list() -> List[Dict]:
    with open(STOCK_LIST_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data["stockList"]


def load_categories() -> List[Dict]:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data["szse"]["category"]


def find_company(query: str, stock_list: List[Dict]) -> Dict:
    """查找公司，返回单个匹配结果。多个结果时交互式选择。"""
    # 1. 精确匹配代码
    exact_code = [s for s in stock_list if s["code"] == query]
    if len(exact_code) == 1:
        return exact_code[0]

    # 2. 精确匹配简称
    exact_name = [s for s in stock_list if s["zwjc"] == query]
    if len(exact_name) == 1:
        return exact_name[0]

    # 3. 模糊匹配简称
    fuzzy = [s for s in stock_list if query in s["zwjc"]]
    candidates = exact_code + exact_name + fuzzy
    # 去重（保持顺序）
    seen = set()
    unique = []
    for c in candidates:
        key = c["code"]
        if key not in seen:
            seen.add(key)
            unique.append(c)

    if not unique:
        print(f"错误：未找到匹配 '{query}' 的公司。", file=sys.stderr)
        sys.exit(1)

    if len(unique) == 1:
        return unique[0]

    # 多个候选，让用户选择
    print(f"找到 {len(unique)} 个匹配结果，请选择：")
    for i, s in enumerate(unique, 1):
        print(f"  {i}. {s['code']} {s['zwjc']}")

    while True:
        try:
            choice = int(input("请输入序号: ").strip())
            if 1 <= choice <= len(unique):
                return unique[choice - 1]
            print(f"请输入 1 到 {len(unique)} 之间的数字。")
        except (ValueError, EOFError):
            print("输入无效，请重试。")


def resolve_category(category_name: str, categories: List[Dict]) -> str:
    """从中文名称解析 category key，找不到时打印可用列表并退出。"""
    for cat in categories:
        if cat["value"] == category_name:
            return cat["key"]
    print(f"错误：未找到公告类型 '{category_name}'。可用类型：", file=sys.stderr)
    for cat in categories:
        print(f"  {cat['value']}", file=sys.stderr)
    sys.exit(1)


def derive_column(org_id: str) -> str:
    if org_id.startswith("gssz"):
        return "szse"
    if org_id.startswith("gssh"):
        return "sse"
    return "szse"


def build_date_range(year: Optional[int], start_date: Optional[str], end_date: Optional[str]) -> str:
    if start_date and end_date:
        return f"{start_date}~{end_date}"
    if start_date:
        return f"{start_date}~{datetime.now().strftime('%Y-%m-%d')}"
    y = year or (datetime.now().year - 1)
    return f"{y}-01-01~{y}-12-31"


def clean_filename(title: str) -> str:
    """清理标题作为文件名。"""
    title = re.sub(r"<.*?>", "", title).strip()
    # 替换文件名非法字符
    title = re.sub(r'[/\\:*?"<>|]', "_", title)
    return title[:100]


def fetch_announcements(
    session: requests.Session,
    stock: str,
    column: str,
    category: str,
    date_range: str,
) -> List[Dict]:
    """分页获取所有公告。"""
    all_results = []

    request_data = {
        "pageNum": 1,
        "pageSize": 30,
        "column": column,
        "tabName": "fulltext",
        "plate": "",
        "stock": stock,
        "searchkey": "",
        "secid": "",
        "category": category,
        "trade": "",
        "seDate": date_range,
        "sortName": "",
        "sortType": "",
        "isHLtitle": "true",
    }
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.post(
                BASE_URL,
                data={**request_data},
                timeout=TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            break
        except Exception as e:
            if attempt == MAX_RETRIES:
                print(f"错误：获取公告列表失败: {e}", file=sys.stderr)
                return []
            time.sleep(RETRY_DELAY)
    else:
        return []

    total_pages = data.get("totalpages", 0)

    announcements = data.get("announcements") or []
    all_results.extend(announcements)

    if total_pages <= 1:
        return all_results

    for page_num in range(2, total_pages + 1):
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = session.post(
                    BASE_URL,
                    data={
                        "pageNum": page_num,
                        "pageSize": 30,
                        "column": column,
                        "tabName": "fulltext",
                        "plate": "",
                        "stock": stock,
                        "searchkey": "",
                        "secid": "",
                        "category": category,
                        "trade": "",
                        "seDate": date_range,
                        "sortName": "",
                        "sortType": "",
                        "isHLtitle": "true",
                    },
                    timeout=TIMEOUT,
                )
                resp.raise_for_status()
                page_data = resp.json()
                page_announcements = page_data.get("announcements") or []
                all_results.extend(page_announcements)
                break
            except Exception as e:
                if attempt == MAX_RETRIES:
                    print(f"警告：第 {page_num} 页获取失败: {e}", file=sys.stderr)
                else:
                    time.sleep(RETRY_DELAY)

    return all_results


def download_pdf(session: requests.Session, url: str, dest_path: Path) -> bool:
    """下载单个 PDF，失败重试3次，返回是否成功。"""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            resp = session.get(url, stream=True, timeout=TIMEOUT,
                               headers={"Host": "static.cninfo.com.cn"})
            resp.raise_for_status()
            with open(dest_path, "wb") as f:
                for chunk in resp.iter_content(chunk_size=8192):
                    f.write(chunk)
            return True
        except Exception as e:
            if attempt == MAX_RETRIES:
                print(f"  错误：下载失败 ({e})", file=sys.stderr)
                return False
            time.sleep(RETRY_DELAY)
    return False


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="从巨潮资讯网下载指定公司的公告 PDF"
    )
    parser.add_argument("company", help="公司名称或股票代码（如 000001 或 平安银行）")
    parser.add_argument("--category", default="年报", help="公告类型（默认：年报）")
    parser.add_argument("--year", type=int, default=None, help="指定年份（默认：当前年份 -1）")
    parser.add_argument("--start-date", dest="start_date", default=None, help="自定义开始日期 YYYY-MM-DD（与 --year 互斥）")
    parser.add_argument("--end-date", dest="end_date", default=None, help="自定义结束日期 YYYY-MM-DD")
    parser.add_argument("--output-dir", dest="output_dir", default=".", help="输出目录（默认：当前目录）")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.start_date and args.year:
        print("错误：--start-date 和 --year 不能同时使用。", file=sys.stderr)
        sys.exit(1)

    stock_list = load_stock_list()
    categories = load_categories()

    company = find_company(args.company, stock_list)
    code = company["code"]
    org_id = company["orgId"]
    zwjc = company["zwjc"]
    print(f"公司: {code} {zwjc}  (orgId: {org_id})")

    category_key = resolve_category(args.category, categories)
    column = derive_column(org_id)
    stock = f"{code},{org_id}"
    date_range = build_date_range(args.year, args.start_date, args.end_date)
    print(f"查询: {args.category}  日期范围: {date_range}")

    session = requests.Session()
    session.headers.update(HEADERS)

    print("正在获取公告列表...")
    announcements = fetch_announcements(session, stock, column, category_key, date_range)

    if not announcements:
        print("未找到符合条件的公告。")
        return

    print(f"共找到 {len(announcements)} 条公告。")

    # 创建输出目录
    output_dir = Path(args.output_dir) / f"{code}_{zwjc}"
    output_dir.mkdir(parents=True, exist_ok=True)
    print(f"保存到: {output_dir}")

    success_count = 0
    skip_count = 0
    fail_count = 0

    for i, item in enumerate(announcements, 1):
        adjunct_url = item.get("adjunctUrl", "")
        raw_title = item.get("announcementTitle", f"公告_{i}")

        if not adjunct_url:
            print(f"[{i}/{len(announcements)}] 跳过（无附件URL）: {raw_title}")
            skip_count += 1
            continue

        filename = clean_filename(raw_title) + ".pdf"
        dest_path = output_dir / filename
        pdf_url = PDF_BASE_URL + adjunct_url

        if dest_path.exists():
            print(f"[{i}/{len(announcements)}] 已存在，跳过: {filename}")
            skip_count += 1
            continue

        print(f"[{i}/{len(announcements)}] 下载: {filename}")
        ok = download_pdf(session, pdf_url, dest_path)
        if ok:
            success_count += 1
        else:
            fail_count += 1

    print(f"\n完成: 下载 {success_count} 个，跳过 {skip_count} 个，失败 {fail_count} 个。")
    print(f"文件保存在: {output_dir.resolve()}")


if __name__ == "__main__":
    main()
