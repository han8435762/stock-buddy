---
name: download-a-share-announcements
description: |
  从巨潮资讯网下载A股公告PDF文件的工具。
  当用户说"下载[公司]的[年报/半年报/公告]"、"帮我下载年报"、"下载A股公告PDF"等时触发。
  支持股票代码或公司名称查找，支持年报、半年报、一季报、三季报等分类，自动下载PDF到本地目录。
  TRIGGER when: user wants to download A-share announcements or reports (年报/半年报/公告) from CNINFO/巨潮资讯.
compatibility: python3, requests
---

# 下载A股公告 (巨潮资讯)

使用捆绑脚本从巨潮资讯网查询并下载指定公司的公告PDF。

## 脚本位置

`scripts/download_announcements.py`

## 用法

```bash
python scripts/download_announcements.py \
  <公司名称或股票代码> \
  [--category 公告类型] \
  [--year 年份] \
  [--start-date YYYY-MM-DD] \
  [--end-date YYYY-MM-DD] \
  [--output-dir 输出目录]
```

## 参数说明

| 参数           | 说明                                             | 默认值     |
| -------------- | ------------------------------------------------ | ---------- |
| 公司名称或代码 | 支持6位代码(000001)或中文简称(平安银行)          | 必填       |
| --category     | 公告类型：年报、半年报、一季报、三季报、董事会等 | 年报       |
| --year         | 报告年份                                         | 当前年份-1 |
| --start-date   | 自定义开始日期（与--year互斥）                   | -          |
| --end-date     | 自定义结束日期                                   | -          |
| --output-dir   | 保存目录                                         | 当前目录   |

## 示例

```bash
# 下载平安银行2024年年报
python scripts/download_announcements.py 000001 --year 2024

# 用公司名称，指定类型
python scripts/download_announcements.py 贵州茅台 --category 半年报 --year 2024

# 自定义日期范围
python scripts/download_announcements.py 600519 --start-date 2024-01-01 --end-date 2024-12-31

# 指定输出目录
python scripts/download_announcements.py 万科A --year 2023 --output-dir ~/Downloads
```

## 输出结构

文件保存在 `{output-dir}/{code}_{zwjc}/` 目录下，文件名为公告标题。

## 注意

- 模糊匹配到多个公司时，脚本会交互式列出候选并等待用户输入序号
- 可用公告类型：年报、半年报、一季报、三季报、业绩预告、权益分派、董事会、监事会、股东会、日常经营、公司治理、中介报告等（完整列表见 scripts/config.json）
- --start-date 和 --year 不能同时使用
