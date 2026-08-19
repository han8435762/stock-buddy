#!/usr/bin/env python3
# -*- coding: UTF-8 -*-
"""
诊断脚本:用 AionUi 内置的 Python 单独测试巨潮资讯(cninfo)连通性。

背景:StockBuddy 添加公司后下载失败,错误形如
  python exit 1: ... requests\\models.py in json -> JSONDecodeError
即 discover 阶段调用巨潮接口返回了非 JSON(反爬页 / 代理拦截 / 空响应)。

本脚本在 Windows 上直接验证:
  1. 当前 Python 与 requests 是否可用
  2. 当前环境是否有代理变量(HTTP_PROXY / HTTPS_PROXY / ALL_PROXY)
  3. 用「走代理 + 旧 Mac UA」访问巨潮(复现失败场景)
  4. 用「禁代理 + Windows UA + https」访问巨潮(验证修复)

用法:
  python test_cninfo.py [股票代码]          # 默认 000001 平安银行

在已安装 AionUi 的机器上(Windows):
  "C:\\Users\\<你的用户名>\\AppData\\Local\\Programs\\StockBuddy\\resources\\bundled-python\\win32-x64\\python.exe" test_cninfo.py 000001

输出里看到 [OK]  说明对应方式能正常拿到 JSON;
看到 [FAIL] 会附上 HTTP 状态码、Content-Type 和响应前 200 字符,据此判断是反爬还是代理。
"""

from __future__ import annotations

import argparse
import os
import sys

import requests

# 让中文在 Windows GBK 控制台不抛 UnicodeEncodeError。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# 旧实现用的 UA(macOS),新实现改为真实 Windows Chrome UA。
MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
WIN_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)
# 新实现:cninfo 是国内服务,强制直连(requests 在 Windows 会自动读取注册表系统代理)。
NO_PROXY = {"http": None, "https": None}

QUERY_URL = "https://www.cninfo.com.cn/new/hisAnnouncement/query"


def fallback_orgid(code: str) -> str:
    """与 astock_api.py 一致的 orgId 兜底规则。"""
    if code.startswith("6"):
        return f"gssh0{code}"
    if code.startswith(("8", "4")):
        return f"gsbj0{code}"
    return f"gssz0{code}"


def build_payload(code: str, org_id: str, page_num: int = 1) -> dict:
    return {
        "stock": f"{code},{org_id}",
        "tabName": "fulltext",
        "pageSize": "30",
        "pageNum": str(page_num),
        "column": "szse",
        "category": "",
        "plate": "",
        "seDate": "",
        "searchkey": "",
        "secid": "",
        "sortName": "time",
        "sortType": "desc",
        "isHLtitle": "true",
    }


def build_headers(ua: str) -> dict:
    """新实现会带上 X-Requested-With 等浏览器请求头,规避反爬。"""
    return {
        "User-Agent": ua,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-CN,zh;q=0.9",
        "X-Requested-With": "XMLHttpRequest",
        "Referer": "https://www.cninfo.com.cn/new/disclosure",
        "Origin": "https://www.cninfo.com.cn",
    }


def probe(code: str, label: str, ua: str, proxies, timeout: int = 15) -> None:
    org_id = fallback_orgid(code)
    try:
        r = requests.post(
            QUERY_URL,
            data=build_payload(code, org_id),
            headers=build_headers(ua),
            timeout=timeout,
            proxies=proxies,
        )
        ctype = r.headers.get("Content-Type", "?")
        try:
            data = r.json()
            items = data.get("announcements", [])
            status = f"[OK]  JSON 可解析, 返回 {len(items)} 条公告"
        except ValueError:
            status = f"[FAIL] 返回非 JSON (Content-Type={ctype})"
        print(f"  {status}")
        print(f"        HTTP {r.status_code}, Content-Type={ctype}")
        if status.startswith("[FAIL]"):
            print(f"        响应前 200 字符: {r.text[:200]!r}")
    except requests.RequestException as e:
        print(f"  [FAIL] 请求异常: {type(e).__name__}: {e}")


def main() -> int:
    parser = argparse.ArgumentParser(prog="test_cninfo")
    parser.add_argument("code", nargs="?", default="000001", help="股票代码(默认 000001)")
    args = parser.parse_args()

    print("=" * 60)
    print("cninfo 连通性诊断")
    print("=" * 60)
    print(f"Python:  {sys.version.split()[0]}  ({sys.executable})")
    try:
        print(f"requests: {requests.__version__}")
    except Exception as e:
        print(f"requests: 导入失败! {e}")
        print("提示: bundled python 里应已预装 requests;若缺失需重新打包安装。")
        return 1

    print("\n[1] 代理环境变量")
    candidates = [
        ("HTTP_PROXY", os.environ.get("HTTP_PROXY")),
        ("HTTPS_PROXY", os.environ.get("HTTPS_PROXY")),
        ("ALL_PROXY", os.environ.get("ALL_PROXY")),
    ]
    proxy_vars = [(k, v) for k, v in candidates if v]
    if proxy_vars:
        for k, v in proxy_vars:
            print(f"    {k}={v}")
        print("    注意: requests 会走这些代理; 若代理对 cninfo 异常, 可能返回非 JSON。")
    else:
        print("    无 HTTP_PROXY/HTTPS_PROXY/ALL_PROXY 环境变量(系统代理可能仍被 requests 读取)")

    print(f"\n[2] 旧方式: 走代理 + 旧 Mac UA   ->  {QUERY_URL}")
    probe(args.code, "旧方式", MAC_UA, proxies=None)

    print(f"\n[3] 修复后: 禁代理 + Windows UA  ->  {QUERY_URL}")
    probe(args.code, "修复后", WIN_UA, proxies=NO_PROXY)

    print("\n" + "=" * 60)
    print("结论参考:")
    print("  · 方式3 OK 而方式2 FAIL   -> 是代理/UA 问题, 新版本已修复, 重装后应能下载")
    print("  · 两者都 FAIL             -> 网络/反爬/SSL 问题, 把 [FAIL] 的输出发回给开发者")
    print("  · 两者都 OK               -> 问题不在 cninfo 接口, 需进一步看完整 traceback")
    print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
