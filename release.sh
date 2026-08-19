#!/usr/bin/env bash
#
# StockBuddy 一键发版脚本
# ======================
#
# 分工:
#   - macOS        : 本机构建 (arm64)，不消耗 GitHub Actions 分钟
#   - Windows/Linux: 触发 GitHub Actions (.github/workflows/release.yml) 构建
#   - 产物         : 本地 mac 产物 + GitHub 构建的 win/linux 产物，统一上传到 Release v<VERSION>
#
# 用法:
#   ./release.sh                  # 默认版本 0.2.3
#   ./release.sh 0.2.3            # 指定版本号(可带或不带 v 前缀)
#   ./release.sh 0.2.3 --wait     # 触发后等待 GitHub 构建完成并汇总
#   ./release.sh 0.2.3 --skip-mac --skip-gh   # 断点续传: 只重新上传本地已构建好的 mac 产物
#   ./release.sh 0.2.11 --upload-github       # 只上传本地 mac 产物到已有 GitHub Release
#   ./release.sh 0.2.11 --upload-qiniu       # 只上传本地 mac 产物到七牛云
#
#   GitHub 网络操作会在 setclash/unsetclash 包裹下执行；七牛云上传会强制直连。
#
# 选项:
#   --skip-mac    跳过本地 macOS 构建(已构建好，仅重新上传)
#   --skip-gh     跳过触发 GitHub Actions(已触发过，只做本地构建+上传)
#   --upload-github 只上传本地 macOS 产物到已有 GitHub Release，不构建、不触发 Actions、不上传七牛
#   --upload-qiniu 只上传本地 macOS 产物到七牛云，不下载 GitHub Release
#   --wait        等待 GitHub win/linux 构建完成后退出(默认)
#   --no-wait     触发后不等待 GitHub 构建，打印运行链接即返回
#   --help        显示帮助
#
# 说明:
#   - 本地构建会用环境变量 AIONUI_DEBUG_AUTO_UPDATE_CURRENT_VERSION 临时把
#     package.json 版本钉到 <VERSION>，构建结束自动还原，不会改动工作区。
#   - 脚本不 commit / 不打 tag / 不建 Release：tag + Release 由 GitHub Actions 的
#     create-release job 创建，本脚本负责触发 + 本地 mac 构建 + 上传 mac 产物到
#     GitHub Release 和七牛云。
#
set -euo pipefail

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$REPO_ROOT/AionUi"
OUT_DIR="$APP_DIR/out"
WORKFLOW="release.yml"
QINIU_UPLOAD_SCRIPT="$REPO_ROOT/.github/scripts/upload-to-qiniu.cjs"
QINIU_SDK_VERSION="7.15.2"
DEFAULT_VERSION="0.2.3"
CLASH_SHELL="${CLASH_SHELL:-zsh}"

# 只读取白名单中的七牛变量，不执行 .env 内容，避免把其他配置或命令带入进程。
load_qiniu_env() {
  local env_file="$REPO_ROOT/.env"
  local name line value
  [ -f "$env_file" ] || return 0

  for name in QINIU_ACCESS_KEY QINIU_SECRET_KEY QINIU_BUCKET QINIU_REGION QINIU_DOMAIN QINIU_KEY_PREFIX; do
    [ -n "${!name:-}" ] && continue

    while IFS= read -r line || [ -n "$line" ]; do
      line="${line%$'\r'}"
      [[ "$line" =~ ^[[:space:]]*$ || "$line" =~ ^[[:space:]]*# ]] && continue
      if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?${name}[[:space:]]*=(.*)$ ]]; then
        value="${BASH_REMATCH[2]}"
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"
        if [[ "$value" == \"*\" && "$value" == *\" ]]; then
          value="${value:1:${#value}-2}"
        elif [[ "$value" == \'*\' && "$value" == *\' ]]; then
          value="${value:1:${#value}-2}"
        fi
        export "$name=$value"
        break
      fi
    done < "$env_file"
  done
}

load_qiniu_env

# 颜色输出(自动判断是否 TTY)
if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'; C_CYAN=$'\033[36m'; C_RESET=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_CYAN=''; C_RESET=''
fi

# ---------------------------------------------------------------------------
# 参数解析
# ---------------------------------------------------------------------------
VERSION="$DEFAULT_VERSION"
WAIT=1
SKIP_MAC=0
SKIP_GH=0
SHOW_HELP=0
UPLOAD_MODE="full"

while [ $# -gt 0 ]; do
  case "$1" in
    --wait)         WAIT=1; shift ;;
    --no-wait)      WAIT=0; shift ;;
    --skip-mac)     SKIP_MAC=1; shift ;;
    --skip-gh)      SKIP_GH=1; shift ;;
    --upload-github|--github-only)
      [ "$UPLOAD_MODE" = "full" ] || { echo "--upload-github 与 --upload-qiniu 不能同时使用" >&2; exit 2; }
      UPLOAD_MODE="github"
      shift
      ;;
    --upload-qiniu|--qiniu-only)
      [ "$UPLOAD_MODE" = "full" ] || { echo "--upload-github 与 --upload-qiniu 不能同时使用" >&2; exit 2; }
      UPLOAD_MODE="qiniu"
      shift
      ;;
    --help|-h)      SHOW_HELP=1; shift ;;
    --*)            echo "未知选项: $1" >&2; exit 2 ;;
    -*)             echo "未知选项: $1" >&2; exit 2 ;;
    *)              VERSION="$1"; shift ;;
  esac
done

# 去掉版本号前缀 v
VERSION="${VERSION#v}"

usage() {
  cat <<'EOF'
StockBuddy 一键发版脚本

用法:
  ./release.sh [版本号] [选项]

示例:
  ./release.sh                  # 版本 0.2.3
  ./release.sh 0.2.3 --wait     # 等待 GitHub 构建完成
  ./release.sh 0.2.3 --skip-mac --skip-gh   # 仅重新上传本地 mac 产物
  ./release.sh 0.2.11 --upload-github       # 只上传本地 mac 产物到 GitHub Release
  ./release.sh 0.2.11 --upload-qiniu       # 只上传本地 mac 产物到七牛云

选项:
  --skip-mac   跳过本地 macOS 构建(仅上传已构建产物)
  --skip-gh    跳过触发 GitHub Actions
  --upload-github 只上传本地 macOS 产物到已有 GitHub Release
  --upload-qiniu 只上传本地 macOS 产物到七牛云
  --wait       等待 GitHub 构建完成(默认)
  --no-wait    不等待 GitHub 构建
  --help       显示本帮助

环境变量:
  QINIU_ACCESS_KEY   七牛云 Access Key
  QINIU_SECRET_KEY   七牛云 Secret Key
  QINIU_BUCKET       七牛云空间名
  QINIU_REGION       可选，七牛云区域 ID；留空则自动识别
  QINIU_DOMAIN       可选，公开空间/自定义域名，用于输出访问链接
  QINIU_KEY_PREFIX   可选，默认 stockbuddy/releases/<版本号>
EOF
}

if [ "$SHOW_HELP" -eq 1 ]; then
  usage
  exit 0
fi

# 独立上传模式天然不需要构建或触发 GitHub Actions。
if [ "$UPLOAD_MODE" = "github" ] || [ "$UPLOAD_MODE" = "qiniu" ]; then
  SKIP_MAC=1
  SKIP_GH=1
  WAIT=0
fi

# 校验版本号格式(基本 semver 校验)
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'; then
  echo "${C_RED}✗ 非法版本号: ${VERSION}(应为形如 0.2.3 的 semver)${C_RESET}" >&2
  exit 2
fi

TAG="v${VERSION}"

# ---------------------------------------------------------------------------
# 日志工具
# ---------------------------------------------------------------------------
log()    { printf '%s\n' "$*"; }
info()   { printf '%s[INFO]%s %s\n'    "$C_BLUE" "$C_RESET" "$*"; }
ok()     { printf '%s[ OK ]%s %s\n'    "$C_GREEN" "$C_RESET" "$*"; }
warn()   { printf '%s[WARN]%s %s\n'    "$C_YELLOW" "$C_RESET" "$*"; }
step()   { printf '\n%s==>%s %s\n'     "$C_CYAN" "$C_RESET" "$*"; }
die()    { printf '%s[FAIL]%s %s\n'    "$C_RED" "$C_RESET" "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 网络模式
# ---------------------------------------------------------------------------
# setclash/unsetclash 通常定义在用户的 zsh 配置中。将 GitHub 命令放进
# 同一个交互式 zsh 会话，既能找到 shell function/alias，也能保证 unsetclash
# 在 GitHub 命令结束后执行，即使上传失败也不会留下代理状态。
run_with_github_proxy() {
  command -v "$CLASH_SHELL" >/dev/null 2>&1 || die "未找到 ${CLASH_SHELL}，无法通过 setclash 执行 GitHub 网络操作。"

  "$CLASH_SHELL" -ic '
    setclash
    setup_status=$?
    if [ "$setup_status" -ne 0 ]; then
      exit "$setup_status"
    fi

    "$@"
    command_status=$?

    unsetclash
    cleanup_status=$?

    if [ "$command_status" -ne 0 ]; then
      exit "$command_status"
    fi
    exit "$cleanup_status"
  ' release.sh-github-proxy "$@"
}

# 七牛云上传不走代理。除了调用 unsetclash 外，再从子进程环境中移除常见的
# HTTP(S)/SOCKS 代理变量，防止 setclash 通过 export 留下代理配置。
run_without_proxy() {
  if command -v "$CLASH_SHELL" >/dev/null 2>&1; then
    "$CLASH_SHELL" -ic 'unsetclash' >/dev/null 2>&1 || true
  fi

  env \
    -u http_proxy -u https_proxy -u all_proxy \
    -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY \
    "$@"
}

# ---------------------------------------------------------------------------
# 前置检查
# ---------------------------------------------------------------------------
preflight() {
  step "前置检查"

  command -v gh  >/dev/null 2>&1 || die "未找到 gh(GitHub CLI)，请先安装: https://cli.github.com/"
  if [ "$SKIP_MAC" -eq 0 ]; then
    command -v bun >/dev/null 2>&1 || die "未找到 bun，请先安装: https://bun.sh/"
  fi
  if qiniu_upload_enabled; then
    command -v node >/dev/null 2>&1 || die "未找到 Node.js 18+，七牛云上传需要 Node.js。"
    if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)' >/dev/null 2>&1; then
      die "Node.js 版本过低，七牛云上传需要 Node.js 18+。"
    fi
  fi
  [ -d "$APP_DIR" ] || die "未找到应用目录: $APP_DIR"

  if qiniu_upload_enabled; then
    [ -f "$QINIU_UPLOAD_SCRIPT" ] || die "未找到七牛云上传脚本: $QINIU_UPLOAD_SCRIPT"
  fi

  # 确认 gh 已登录且有 repo 权限
  if ! run_with_github_proxy gh auth status >/dev/null 2>&1; then
    die "gh 未登录，请先执行: gh auth login"
  fi

  REPO="$(run_with_github_proxy gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null || true)"
  if [ -z "$REPO" ]; then
    die "无法确定 GitHub 仓库(请在仓库根目录运行，且 remote 指向 han8435762/stock-buddy)"
  fi

  BRANCH="$(git -C "$REPO_ROOT" branch --show-current)"
  [ -n "$BRANCH" ] || BRANCH="main"

  ok "仓库: ${REPO}  分支: ${BRANCH}  版本: ${VERSION} (tag ${TAG})"
  ok "本机架构: $(uname -m) / $(uname -s)"

  if qiniu_upload_enabled; then
    ensure_qiniu_env
    ensure_qiniu_sdk
  else
    warn "未设置 QINIU_ACCESS_KEY，跳过七牛云上传"
  fi

  # 是否跳过本地 mac 构建 & 是否跳过触发
  [ "$SKIP_MAC" -eq 1 ] && warn "已跳过本地 macOS 构建 (--skip-mac)"
  [ "$SKIP_GH"  -eq 1 ] && warn "已跳过触发 GitHub Actions (--skip-gh)"

  # 未跳过触发时: 防止重复发版(Release 或 tag 已存在)
  if [ "$SKIP_GH" -eq 0 ]; then
    if run_with_github_proxy gh release view "$TAG" >/dev/null 2>&1; then
      die "Release ${TAG} 已存在。请换一个版本号，或使用 --skip-gh 继续上传产物。"
    fi
    if run_with_github_proxy git ls-remote --tags origin "refs/tags/${TAG}" 2>/dev/null | grep -q .; then
      die "远程已存在 tag ${TAG}。请换一个版本号。"
    fi
    ok "Release/tag ${TAG} 尚未创建，可以发版"
  fi
}

# ---------------------------------------------------------------------------
# 七牛云配置与 SDK
# ---------------------------------------------------------------------------
qiniu_upload_enabled() {
  [ -n "${QINIU_ACCESS_KEY:-}" ]
}

ensure_qiniu_env() {
  local name
  for name in QINIU_ACCESS_KEY QINIU_SECRET_KEY QINIU_BUCKET; do
    [ -n "${!name:-}" ] || die "未设置 ${name}。请先 export ${name}=..."
  done
}

ensure_qiniu_sdk() {
  if node -e 'require.resolve("qiniu")' >/dev/null 2>&1; then
    return 0
  fi

  command -v npm >/dev/null 2>&1 || die "未找到 npm，无法安装七牛云 Node.js SDK。"

  QINIU_SDK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/stockbuddy-qiniu.XXXXXX")"
  trap 'if [ -n "${QINIU_SDK_DIR:-}" ] && [ -d "$QINIU_SDK_DIR" ]; then rm -rf "$QINIU_SDK_DIR"; fi' EXIT
  info "本机未安装 qiniu，临时安装 qiniu@${QINIU_SDK_VERSION}..."
  npm install --prefix "$QINIU_SDK_DIR" --no-package-lock --ignore-scripts "qiniu@${QINIU_SDK_VERSION}" >/dev/null
  export NODE_PATH="$QINIU_SDK_DIR/node_modules${NODE_PATH:+:$NODE_PATH}"
}

# ---------------------------------------------------------------------------
# 触发 GitHub Actions (Windows + Linux)
# ---------------------------------------------------------------------------
gh_latest_run_id() {
  run_with_github_proxy gh run list --workflow="$WORKFLOW" --branch "$BRANCH" --limit 1 \
    --json databaseId --jq '.[0].databaseId' 2>/dev/null || echo ""
}

trigger_github() {
  step "触发 GitHub Actions 构建 (Windows + Linux, macOS 关闭)"

  local before_id
  before_id="$(gh_latest_run_id)"

  run_with_github_proxy gh workflow run "$WORKFLOW" \
    --ref "$BRANCH" \
    -f "version=$VERSION" \
    -f "build_windows=true" \
    -f "build_linux=true" \
    -f "build_macos=false"

  # 轮询拿到新 run id(workflow run 是异步入队)
  local run_id="" deadline=$(( $(date +%s) + 60 ))
  while [ -z "$run_id" ] && [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 3
    local cur_id
    cur_id="$(gh_latest_run_id)"
    if [ -n "$cur_id" ] && [ "$cur_id" != "$before_id" ]; then
      run_id="$cur_id"
    fi
  done

  if [ -z "$run_id" ]; then
    warn "未能自动捕获 run id(不影响构建，只是无法监控)。可手动查看: gh run list --workflow=$WORKFLOW"
    RUN_ID=""
  else
    RUN_ID="$run_id"
    local run_url
    run_url="$(run_with_github_proxy gh run view "$RUN_ID" --json url --jq .url 2>/dev/null || true)"
    ok "已触发 GitHub 构建，run id: ${RUN_ID}"
    [ -n "$run_url" ] && info "运行地址: ${run_url}"
  fi

  # 说明: create-release job 会先创建 tag + 空 Release，win/linux job 随后构建并上传。
  info "GitHub 侧会先创建 tag ${TAG} + Release，再构建并上传 Windows/Linux 产物"
}

# ---------------------------------------------------------------------------
# 本地构建 macOS
# ---------------------------------------------------------------------------
build_mac() {
  step "本地构建 macOS (arm64)"

  # 临时把版本钉到 <VERSION>，构建结束后由 build-with-builder.js 自动还原
  export AIONUI_DEBUG_AUTO_UPDATE_CURRENT_VERSION="$VERSION"
  export CI="true"
  export CSC_IDENTITY_AUTO_DISCOVERY="false"
  export HUSKY="0"
  export NODE_OPTIONS="--max-old-space-size=8192"

  (
    cd "$APP_DIR"
    info "安装/校验 AionUi 依赖..."
    bun install --frozen-lockfile
    info "构建 arm64..."
    bun run build-mac:arm64
  )

  ok "macOS 本地构建完成，产物目录: ${OUT_DIR}"
}

# ---------------------------------------------------------------------------
# 等待 Release 出现
# ---------------------------------------------------------------------------
require_existing_release() {
  step "检查已有 GitHub Release ${TAG}"

  if ! run_with_github_proxy gh release view "$TAG" >/dev/null 2>&1; then
    die "GitHub Release ${TAG} 不存在。请先创建 Release，或先运行完整发版流程。"
  fi

  ok "GitHub Release ${TAG} 已存在"
}

wait_for_release() {
  step "等待 GitHub 创建 Release ${TAG}"

  if run_with_github_proxy gh release view "$TAG" >/dev/null 2>&1; then
    ok "Release ${TAG} 已存在"
    return 0
  fi

  # create-release job 通常 1 分钟内完成; 留 20 分钟余量
  local deadline=$(( $(date +%s) + 1200 ))
  while ! run_with_github_proxy gh release view "$TAG" >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      die "等待 Release ${TAG} 超时。请检查 GitHub Actions 运行状态: gh run list --workflow=$WORKFLOW"
    fi
    info "Release 尚未创建，20 秒后重试..."
    sleep 20
  done
  ok "Release ${TAG} 已就绪"
}

# ---------------------------------------------------------------------------
# 上传本地 macOS 产物
# ---------------------------------------------------------------------------
collect_mac_assets() {
  if [ ! -d "$OUT_DIR" ]; then
    die "产物目录不存在: ${OUT_DIR}"
  fi

  # 只上传 arm64 dmg；使用精确文件名，避免上传旧的 x64 产物。
  local files=()
  shopt -s nullglob
  files=(
    "$OUT_DIR"/StockBuddy-"$VERSION"-mac-arm64.dmg
  )
  shopt -u nullglob

  # 过滤掉仍可能为字面量且不存在的路径(为稳妥再校验一次)。
  local real=() f
  for f in "${files[@]}"; do
    [ -e "$f" ] && real+=("$f")
  done

  if [ ${#real[@]} -eq 0 ]; then
    die "在 ${OUT_DIR} 未找到 macOS arm64 产物(StockBuddy-${VERSION}-mac-arm64.dmg)。请先构建(--skip-mac 前需先完成构建)。"
  fi

  MAC_ASSET_FILES=("${real[@]}")
}

upload_mac() {
  step "上传本地 macOS 产物到 Release ${TAG}"

  collect_mac_assets

  info "待上传文件:"
  local f
  for f in "${MAC_ASSET_FILES[@]}"; do
    info "  - $(basename "$f") ($(du -h "$f" | cut -f1))"
  done

  run_with_github_proxy gh release upload "$TAG" "${MAC_ASSET_FILES[@]}" --clobber

  ok "macOS 产物上传完成"
}

# ---------------------------------------------------------------------------
# 上传本地 macOS 产物到七牛云
# ---------------------------------------------------------------------------
upload_mac_to_qiniu() {
  if ! qiniu_upload_enabled; then
    warn "未设置 QINIU_ACCESS_KEY，跳过七牛云上传"
    return 0
  fi

  step "上传本地 macOS 产物到七牛云 (${TAG})"

  collect_mac_assets
  ensure_qiniu_env
  ensure_qiniu_sdk

  export QINIU_ACCESS_KEY QINIU_SECRET_KEY QINIU_BUCKET
  export QINIU_REGION="${QINIU_REGION:-}"
  export QINIU_DOMAIN="${QINIU_DOMAIN:-}"
  export QINIU_KEY_PREFIX="${QINIU_KEY_PREFIX:-stockbuddy/releases/${VERSION}}"
  # Release assets must each derive their own key from the filename.
  unset QINIU_OBJECT_KEY

  local f
  for f in "${MAC_ASSET_FILES[@]}"; do
    run_without_proxy node "$QINIU_UPLOAD_SCRIPT" "$f"
  done

  ok "macOS 产物已上传到七牛云，Key 前缀: ${QINIU_KEY_PREFIX}"
}

# ---------------------------------------------------------------------------
# 等待 GitHub 构建完成(可选)
# ---------------------------------------------------------------------------
wait_github_run() {
  if [ -z "${RUN_ID:-}" ]; then
    warn "未捕获到 run id，无法监控。请手动查看: gh run list --workflow=$WORKFLOW"
    return 0
  fi

  step "监控 GitHub 构建 (run id: ${RUN_ID})"

  local url
  url="$(run_with_github_proxy gh run view "$RUN_ID" --json url --jq .url 2>/dev/null || true)"
  [ -n "$url" ] && info "运行地址: ${url}(可随时 Ctrl-C 中断，构建会在 GitHub 后台继续)"

  # GitHub win/linux 构建通常 10~25 分钟; 留 60 分钟上限
  local deadline=$(( $(date +%s) + 3600 ))
  while :; do
    local line
    line="$(run_with_github_proxy gh run view "$RUN_ID" --json status,conclusion --jq '"\(.status)|\(.conclusion // "")"' 2>/dev/null || true)"
    local status="${line%%|*}" conclusion="${line##*|}"

    if [ "$status" = "completed" ]; then
      if [ "$conclusion" = "success" ]; then
        if qiniu_upload_enabled; then
          ok "GitHub 构建成功，Windows/Linux 产物已由 workflow 上传到 Release ${TAG} 和七牛云"
        else
          ok "GitHub 构建成功，Windows/Linux 产物已由 workflow 上传到 Release ${TAG}（已跳过七牛云上传）"
        fi
      else
        warn "GitHub 构建结束，结论: ${conclusion:-unknown}。请到运行页查看详情(可能影响 win/linux 产物)。"
      fi
      return 0
    fi

    if [ "$(date +%s)" -ge "$deadline" ]; then
      warn "等待 GitHub 构建超时(60 分钟)。构建仍在后台继续，请稍后查看运行页。"
      return 0
    fi

    info "GitHub 状态: ${status:-unknown}，30 秒后重试..."
    sleep 30
  done
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
main() {
  # 无论从哪个目录调用,都切到仓库根目录,保证 gh/git 能正确识别仓库。
  cd "$REPO_ROOT"

  cat <<EOF
${C_CYAN}
  StockBuddy 发版 v${VERSION}
  macOS: 本机构建 | Windows/Linux: GitHub Actions
${C_RESET}
EOF

  preflight

  if [ "$UPLOAD_MODE" = "github" ]; then
    step "独立上传模式: GitHub Release"
    require_existing_release
    upload_mac
    echo
    ok "GitHub macOS 产物上传完成。未触发 GitHub Actions，未上传七牛云。"
    return 0
  fi

  if [ "$UPLOAD_MODE" = "qiniu" ]; then
    step "独立上传模式: 七牛云"
    upload_mac_to_qiniu
    echo
    if qiniu_upload_enabled; then
      ok "七牛云 macOS 产物上传完成。未触发 GitHub Actions，未构建或上传 GitHub。"
    else
      warn "未设置 QINIU_ACCESS_KEY，已跳过七牛云上传。未触发 GitHub Actions，未构建或上传 GitHub。"
    fi
    return 0
  fi

  if [ "$SKIP_GH" -eq 0 ]; then
    trigger_github
  else
    info "跳过触发 GitHub Actions"
  fi

  if [ "$SKIP_MAC" -eq 0 ]; then
    build_mac
  else
    info "跳过本地 macOS 构建"
  fi

  wait_for_release
  upload_mac
  upload_mac_to_qiniu

  if [ "$WAIT" -eq 1 ]; then
    wait_github_run
  else
    info "未等待 GitHub 构建(--no-wait)。可稍后查看: gh run list --workflow=$WORKFLOW"
  fi

  echo
  ok "发版脚本执行完毕。Release: https://github.com/${REPO}/releases/tag/${TAG}"
}

main "$@"
