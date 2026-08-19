#!/usr/bin/env python3
# -*- coding: UTF-8 -*-
"""
A-share data API for StockBuddy (extracted from the a-stock-data skill).
CLI that prints JSON to stdout so the Electron main process can call it:

  astock_api.py stock-info <code>
  astock_api.py financial <code> [--num N]
  astock_api.py announcements <code> [--start-date YYYY-MM-DD] [--end-date YYYY-MM-DD] [--page-size N]

All endpoints are free and require no API key. Eastmoney calls go through
em_get() which throttles requests to avoid IP bans.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

# cninfo/eastmoney/sina are domestic CN services — a local Clash-style system
# proxy (which requests auto-discovers on Windows) can rewrite or block their
# responses and turn JSON into an HTML/empty body. Pin these calls to direct.
NO_PROXY = {"http": None, "https": None}

# ── Eastmoney throttle helper ────────────────────────────────────────────
# Uses the stdlib urllib instead of requests: macOS's system Python (LibreSSL)
# breaks urllib3's TLS on eastmoney (RemoteDisconnected), while urllib works.
EM_MIN_INTERVAL = 1.0
_em_last_call = [0.0]


def http_get_json(url: str, params=None, headers=None, timeout: int = 15) -> dict:
    """Stdlib GET -> parsed JSON dict (no requests/urllib3 dependency)."""
    if params:
        sep = "&" if "?" in url else "?"
        url = url + sep + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers=headers or {"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body)


def em_get(url: str, params=None, headers=None, timeout: int = 15) -> dict:
    wait = EM_MIN_INTERVAL - (time.time() - _em_last_call[0])
    if wait > 0:
        time.sleep(wait + random.uniform(0.1, 0.5))
    try:
        return http_get_json(url, params=params, headers=headers, timeout=timeout)
    finally:
        _em_last_call[0] = time.time()


# ── Stock basic info (Eastmoney push2) ───────────────────────────────────
def stock_info(code: str) -> dict:
    market_code = 1 if code.startswith("6") else 0
    url = "https://push2.eastmoney.com/api/qt/stock/get"
    params = {
        "fltt": "2", "invt": "2",
        "fields": "f57,f58,f84,f85,f127,f116,f117,f189,f43",
        "secid": f"{market_code}.{code}",
    }
    d = em_get(url, params=params, headers={"User-Agent": UA}, timeout=10).get("data", {})
    return {
        "code": d.get("f57", ""),
        "name": d.get("f58", ""),
        "industry": d.get("f127", ""),
        "total_shares": d.get("f84", 0),
        "float_shares": d.get("f85", 0),
        "mcap": d.get("f116", 0),
        "float_mcap": d.get("f117", 0),
        "list_date": str(d.get("f189", "")),
        "price": d.get("f43", 0),
    }


# ── Batch industry lookup (with disk cache) ─────────────────────────────
# Used by the "Add Company" search so every result carries a real industry.
# A separate lighter throttle (0.4s/req) is safe here: 20 codes ≈ 8s, well
# below eastmoney's ~200 req/min ban threshold.
INDUSTRY_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "industry_cache.json")
INDUSTRY_INTERVAL = 0.4
_industry_last = [0.0]


def _industry_get_sina(code: str) -> dict:
    """新浪 F10「所属行业板块」— 东财不可用时的降级源（新浪不封 IP）。"""
    url = f"http://vip.stock.finance.sina.com.cn/corp/go.php/vCI_CorpOtherInfo/stockid/{code}/menu_num/2.phtml"
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://finance.sina.com.cn"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        html = resp.read().decode("gbk", errors="ignore")
    m = re.search(r"所属行业板块</td>.*?<td[^>]*>([^<]+)</td>", html, re.S)
    industry = re.sub(r"\s+", "", m.group(1)) if m else ""
    return {"name": "", "industry": industry}


def _industry_get(code: str) -> dict:
    """行业查询：优先东财 stock/get (f127)，失败降级新浪 F10。带轻限流。"""
    wait = INDUSTRY_INTERVAL - (time.time() - _industry_last[0])
    if wait > 0:
        time.sleep(wait)
    _industry_last[0] = time.time()

    market_code = 1 if code.startswith("6") else 0
    url = "https://push2.eastmoney.com/api/qt/stock/get"
    params = {"fltt": "2", "invt": "2", "fields": "f57,f58,f127", "secid": f"{market_code}.{code}"}
    try:
        d = http_get_json(url, params=params, headers={"User-Agent": UA}, timeout=6).get("data", {})
        industry = d.get("f127", "")
        if industry:
            return {"name": d.get("f58", ""), "industry": industry}
    except Exception as e:
        print(f"[WARN] 东财行业失败 {code}: {e}", file=sys.stderr)

    try:
        return _industry_get_sina(code)
    except Exception as e:
        print(f"[WARN] 新浪行业失败 {code}: {e}", file=sys.stderr)
        return {"name": "", "industry": ""}


def load_industry_cache() -> dict:
    try:
        with open(INDUSTRY_CACHE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def save_industry_cache(cache: dict) -> None:
    try:
        with open(INDUSTRY_CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def industries(codes: list[str]) -> dict:
    """Batch industry lookup -> {code: {name, industry}}. Reads/writes a disk
    cache so repeat searches return instantly; only misses hit the API."""
    cache = load_industry_cache()
    result: dict = {}
    for code in codes:
        cached = cache.get(code)
        if cached and cached.get("industry"):
            result[code] = cached
            continue
        try:
            info = _industry_get(code)
        except Exception as e:
            print(f"[WARN] 行业拉取失败 {code}: {e}", file=sys.stderr)
            info = {"name": "", "industry": ""}
        cache[code] = info
        result[code] = info
    save_industry_cache(cache)
    return result


def prewarm_industry(limit: int = 500) -> dict:
    """预填行业缓存：读同目录 stockList.json 的全量 A 股代码，优先补全未缓存
    的公司，单批最多处理 limit 家。由主进程每天调用，搜索只读缓存、不实时拉取。"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    stock_list_path = os.path.join(script_dir, "stockList.json")
    try:
        with open(stock_list_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        all_codes = [s.get("code") for s in data.get("stockList", []) if s.get("code")]
    except Exception as e:
        print(f"[WARN] 读取 stockList.json 失败: {e}", file=sys.stderr)
        return {"processed": 0, "cached_now": 0, "remaining": 0, "total_cached": 0}

    cache = load_industry_cache()
    missing = [c for c in all_codes if not (cache.get(c) or {}).get("industry")]
    todo = missing[:limit]
    if not todo:
        return {"processed": 0, "cached_now": 0, "remaining": 0,
                "total_cached": len(cache)}
    result = industries(todo)  # 复用批量拉取 + 缓存写入
    cache = load_industry_cache()
    return {
        "processed": len(todo),
        "cached_now": len(result),
        "remaining": max(0, len(missing) - len(todo)),
        "total_cached": len(cache),
    }


# ── Financial statements (Sina) ─────────────────────────────────────────
def financial_report(code: str, report_type: str = "lrb", num: int = 8) -> list[dict]:
    prefix = "sh" if code.startswith("6") else "sz"
    paper_code = f"{prefix}{code}"
    url = "https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022"
    params = {
        "paperCode": paper_code,
        "source": report_type,
        "type": "0",
        "page": "1",
        "num": str(num),
    }
    r = requests.get(url, params=params, headers={"User-Agent": UA}, timeout=15)
    report_list = r.json().get("result", {}).get("data", {}).get("report_list", {}) or {}

    rows = []
    for period in sorted(report_list.keys(), reverse=True)[:num]:
        obj = report_list[period]
        rec = {"报告期": f"{period[:4]}-{period[4:6]}-{period[6:8]}"}
        for item in obj.get("data", []) or []:
            title = item.get("item_title", "")
            if not title or item.get("item_value") is None:
                continue
            rec[title] = item.get("item_value")
            tongbi = item.get("item_tongbi")
            if tongbi not in (None, ""):
                rec[title + "_同比"] = tongbi
        rows.append(rec)
    return rows


def _parse_num(value):
    """宽松数字解析：兼容字符串/千分位/空值。"""
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)
    try:
        return float(str(value).replace(",", ""))
    except Exception:
        return None


def _tencent_quote_raw(code: str) -> str:
    """腾讯行情原始 `~` 分隔串（腾讯不封 IP，作为股本/估值降级源）。"""
    prefix = "sh" if code.startswith("6") else "sz"
    url = f"https://qt.gtimg.cn/q={prefix}{code}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as resp:
        return resp.read().decode("gbk", errors="ignore")


def tencent_equity(code: str) -> dict:
    """股本与市值快照（腾讯行情）。总股本/流通股由市值反算。"""
    raw = _tencent_quote_raw(code)
    m = re.search(r'"([^"]+)"', raw)
    if not m:
        return {"total_shares": None, "float_shares": None, "total_mcap": None, "float_mcap": None}
    f = m.group(1).split("~")
    price = _parse_num(f[3]) if len(f) > 3 else None
    total_mcap = _parse_num(f[45]) if len(f) > 45 else None  # 总市值（亿元）
    float_mcap = _parse_num(f[44]) if len(f) > 44 else None  # 流通市值（亿元）
    return {
        "total_shares": round(total_mcap * 1e8 / price) if price and total_mcap else None,
        "float_shares": round(float_mcap * 1e8 / price) if price and float_mcap else None,
        "total_mcap": total_mcap * 1e8 if total_mcap else None,
        "float_mcap": float_mcap * 1e8 if float_mcap else None,
    }


def tencent_valuation(code: str) -> dict:
    """估值快照（腾讯行情：现价 / PE / 总市值）。"""
    raw = _tencent_quote_raw(code)
    m = re.search(r'"([^"]+)"', raw)
    if not m:
        return {"price": None, "pe": None, "total_mcap": None}
    f = m.group(1).split("~")
    total_mcap = _parse_num(f[45]) if len(f) > 45 else None
    return {
        "price": _parse_num(f[3]) if len(f) > 3 else None,
        "pe": _parse_num(f[39]) if len(f) > 39 else None,
        "total_mcap": total_mcap * 1e8 if total_mcap else None,
    }


def holder_num(code: str, num: int = 8) -> list[dict]:
    """股东户数历史（东财 datacenter RPT_HOLDERNUMLATEST）。"""
    url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    params = {
        "reportName": "RPT_HOLDERNUMLATEST", "columns": "ALL",
        "filter": f'(SECURITY_CODE="{code}")',
        "pageNumber": "1", "pageSize": str(num),
        "sortColumns": "END_DATE", "sortTypes": "-1",
        "source": "WEB", "client": "WEB",
    }
    try:
        d = http_get_json(url, params=params, timeout=15)
    except Exception as e:
        print(f"[WARN] 股东户数失败 {code}: {e}", file=sys.stderr)
        return []
    rows = []
    for x in (d.get("result") or {}).get("data") or []:
        rows.append({
            "end_date": str(x.get("END_DATE", ""))[:10],
            "holder_num": x.get("HOLDER_NUM"),
            "change_pct": x.get("HOLDER_NUM_RATIO"),
        })
    return rows


def dividend_history(code: str, num: int = 5) -> list[dict]:
    """分红送转历史（东财 datacenter RPT_SHAREBONUS_DET）。"""
    url = "https://datacenter-web.eastmoney.com/api/data/v1/get"
    params = {
        "reportName": "RPT_SHAREBONUS_DET", "columns": "ALL",
        "filter": f'(SECURITY_CODE="{code}")',
        "pageNumber": "1", "pageSize": str(num),
        "sortColumns": "NOTICE_DATE", "sortTypes": "-1",
        "source": "WEB", "client": "WEB",
    }
    try:
        d = http_get_json(url, params=params, timeout=15)
    except Exception as e:
        print(f"[WARN] 分红失败 {code}: {e}", file=sys.stderr)
        return []
    rows = []
    for x in (d.get("result") or {}).get("data") or []:
        rows.append({
            "report_date": str(x.get("REPORT_DATE", ""))[:10],
            "notice_date": str(x.get("NOTICE_DATE", ""))[:10],
            "bonus_rmb": _parse_num(x.get("PRETAX_BONUS_RMB")),
            "send_stock": _parse_num(x.get("SEND_STOCK")),
            "transfer_stock": _parse_num(x.get("TRANSFER_STOCK")),
        })
    return rows


def financial_indicators(code: str, num: int = 5) -> list[dict]:
    """近 N 年财务指标：净利率 / ROE / 资产负债率，由新浪三表计算。"""
    income = financial_report(code, "lrb", num)
    balance = financial_report(code, "fzb", num)
    by_year_income = {r.get("报告期", "")[:4]: r for r in income if r.get("报告期")}
    by_year_balance = {r.get("报告期", "")[:4]: r for r in balance if r.get("报告期")}
    out = []
    for year in sorted(set(by_year_income) & set(by_year_balance), reverse=True)[:num]:
        i = by_year_income[year]
        b = by_year_balance[year]
        revenue = _parse_num(i.get("营业收入") or i.get("营业总收入"))
        net_profit = _parse_num(i.get("净利润") or i.get("归母净利润"))
        equity = _parse_num(b.get("归属于母公司股东权益合计") or b.get("所有者权益(或股东权益)合计"))
        assets = _parse_num(b.get("资产总计"))
        out.append({
            "year": int(year),
            "net_margin": round(net_profit / revenue * 100, 2) if revenue and net_profit else None,
            "roe": round(net_profit / equity * 100, 2) if equity and net_profit else None,
            "asset_liability_ratio": round((1 - equity / assets) * 100, 2) if assets and equity else None,
        })
    return out


# ── CNINFO announcements (巨潮) ─────────────────────────────────────────
_CNINFO_ORGID_MAP = {}


def _cninfo_orgid(code: str) -> str:
    global _CNINFO_ORGID_MAP
    if not _CNINFO_ORGID_MAP:
        try:
            r = requests.get("https://www.cninfo.com.cn/new/data/szse_stock.json",
                             headers={"User-Agent": UA}, timeout=15, proxies=NO_PROXY)
            _CNINFO_ORGID_MAP = {s["code"]: s["orgId"] for s in r.json().get("stockList", [])}
        except Exception:
            pass
    org = _CNINFO_ORGID_MAP.get(code)
    if org:
        return org
    if code.startswith("6"):
        return f"gssh0{code}"
    if code.startswith(("8", "4")):
        return f"gsbj0{code}"
    return f"gssz0{code}"


def _ts_to_date(ts):
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d")
    return str(ts)[:10] if ts else ""


def announcements(code: str, page_size: int = 50, start_date: str = "", end_date: str = "",
                  page_num: int = 1) -> list[dict]:
    """CNINFO announcement list with PDF URLs (paginated; server caps ~30/page)."""
    url = "https://www.cninfo.com.cn/new/hisAnnouncement/query"
    org_id = _cninfo_orgid(code)
    se_date = ""
    if start_date or end_date:
        end = end_date or datetime.now().strftime("%Y-%m-%d")
        se_date = f"{start_date}~{end}"
    payload = {
        "stock": f"{code},{org_id}",
        "tabName": "fulltext",
        "pageSize": str(page_size),
        "pageNum": str(page_num),
        "column": "szse",
        "category": "",
        "plate": "",
        "seDate": se_date,
        "searchkey": "",
        "secid": "",
        "sortName": "time",
        "sortType": "desc",
        "isHLtitle": "true",
    }
    headers = {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.cninfo.com.cn/new/disclosure",
        "Origin": "https://www.cninfo.com.cn",
    }
    # cninfo can transiently answer with an anti-bot page or a non-200 (a bare
    # HTML body, a 5xx during peak hours) — observed as a JSONDecodeError in
    # the field. Retry a few times with a short backoff so one flaky page does
    # not kill the whole discover run; if it still fails, raise a diagnosable
    # error with the HTTP status + Content-Type + a body excerpt.
    last_error: str | None = None
    for attempt in range(3):
        if attempt > 0:
            time.sleep(1 + attempt)
        try:
            r = requests.post(url, data=payload, headers=headers, timeout=15, proxies=NO_PROXY)
            if r.status_code != 200:
                last_error = f"HTTP {r.status_code}: {r.text[:200]}"
                continue
            try:
                data = r.json()
            except ValueError as e:
                ctype = r.headers.get("Content-Type", "?")
                last_error = f"non-JSON (HTTP {r.status_code}, {ctype}): {r.text[:200]}"
                continue
            rows = []
            for item in data.get("announcements", []) or []:
                rows.append({
                    "title": item.get("announcementTitle", ""),
                    "type": item.get("announcementTypeName", ""),
                    "date": _ts_to_date(item.get("announcementTime")),
                    "pdf_url": ("https://static.cninfo.com.cn/" + item["adjunctUrl"])
                    if item.get("adjunctUrl") else "",
                })
            return rows
        except requests.RequestException as e:
            last_error = f"{type(e).__name__}: {e}"
    raise RuntimeError(f"cninfo query failed after 3 attempts: {last_error}")


# ── Discover materials (filtered announcements) ─────────────────────────
# 资料发现规则：
#   · 近 5 年含「年度报告」的定期报告（按年度发布窗口精准拉取，避免被海量公告淹没）；
#   · 近 1 年全部公告（年报之外的半年报/季报/重要公告/日常公告都纳入）。
ANNUAL_REPORT_RE = re.compile(r"年年度报告")


def discover(code: str, max_pages: int = 40) -> list[dict]:
    """发现符合资料补充范围的公告（降序：最新的在前）。

    分页拉取近 5 年全部公告（巨潮单页上限 30 条，公告大户需要翻多页），再按规则
    过滤：近 5 年年度报告 + 近 1 年全部公告。
    """
    now = datetime.now()
    cutoff_annual = now - timedelta(days=365 * 5)
    cutoff_periodic = now - timedelta(days=365)
    start_date = cutoff_annual.strftime("%Y-%m-%d")

    rows: list[dict] = []
    for page in range(1, max_pages + 1):
        page_rows = announcements(code, 30, start_date=start_date, page_num=page)
        if not page_rows:
            break
        rows.extend(page_rows)
        try:
            last_date = page_rows[-1].get("date", "")
            if last_date and datetime.strptime(last_date, "%Y-%m-%d") < cutoff_annual:
                break
        except ValueError:
            break

    matched: list[dict] = []
    for r in rows:
        title = r.get("title", "") or ""
        date_str = r.get("date", "") or ""
        try:
            day = datetime.strptime(date_str, "%Y-%m-%d") if date_str else None
        except ValueError:
            day = None
        if not day:
            continue

        # 近 5 年年度报告（排除"提示性公告"这类非正式年报标题）。
        if ANNUAL_REPORT_RE.search(title) and day >= cutoff_annual and "提示性公告" not in title:
            matched.append(r)
            continue
        # 近 1 年全部公告。
        if day >= cutoff_periodic:
            matched.append(r)
            continue

    # 去重（同一标题+日期只保留一份），并按日期降序
    seen: set[tuple[str, str]] = set()
    unique: list[dict] = []
    for r in matched:
        key = (r.get("title", ""), r.get("date", ""))
        if key in seen:
            continue
        seen.add(key)
        unique.append(r)
    return sorted(unique, key=lambda r: r.get("date", ""), reverse=True)


# ── CLI ─────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(prog="astock_api")
    sub = parser.add_subparsers(dest="command", required=True)

    p_info = sub.add_parser("stock-info")
    p_info.add_argument("code")

    p_fin = sub.add_parser("financial")
    p_fin.add_argument("code")
    p_fin.add_argument("--num", type=int, default=8)

    p_ann = sub.add_parser("announcements")
    p_ann.add_argument("code")
    p_ann.add_argument("--start-date", default="")
    p_ann.add_argument("--end-date", default="")
    p_ann.add_argument("--page-size", type=int, default=50)

    p_disc = sub.add_parser("discover")
    p_disc.add_argument("code")
    p_disc.add_argument("--max-pages", type=int, default=40)

    p_ind = sub.add_parser("industries")
    p_ind.add_argument("codes", nargs="+")

    p_pre = sub.add_parser("prewarm-industry")
    p_pre.add_argument("--limit", type=int, default=500)

    args = parser.parse_args()

    if args.command == "stock-info":
        result = stock_info(args.code)
    elif args.command == "industries":
        result = industries(args.codes)
    elif args.command == "prewarm-industry":
        result = prewarm_industry(args.limit)
    elif args.command == "financial":
        result = {
            "code": args.code,
            "income": financial_report(args.code, "lrb", args.num),
            "balance": financial_report(args.code, "fzb", args.num),
            "cashflow": financial_report(args.code, "llb", args.num),
            "indicators": financial_indicators(args.code, args.num),
            "equity": tencent_equity(args.code),
            "holders": holder_num(args.code),
            "dividends": dividend_history(args.code),
            "valuation": tencent_valuation(args.code),
        }
    elif args.command == "announcements":
        result = announcements(args.code, args.page_size, args.start_date, args.end_date)
    elif args.command == "discover":
        result = discover(args.code, args.max_pages)
    else:
        parser.print_help()
        return 2

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
