#!/usr/bin/env bash
set -euo pipefail
# Mobile Herdr installer. Downloads a tested release; never starts Herdr or an agent.
VERSION=0.2.2-beta.12
PREFIX=${MOBILE_HERDR_INSTALL_DIR:-"$HOME/.local/share/mobile-herdr"}
BIN_DIR=${MOBILE_HERDR_BIN_DIR:-"$HOME/.local/bin"}
INSTALL_BUN=1
usage() {
  cat <<'USAGE'
Mobile Herdr installer
  --version <version>     Install a specific release (optional leading v)
  --prefix <directory>    Runtime versions (default ~/.local/share/mobile-herdr)
  --bin-dir <directory>   mobile-herdr and mherdr commands (default ~/.local/bin)
  --no-install-bun        Fail instead of installing Bun when it is missing
Installs without sudo; preserves old versions and tokens. Does not start any server.
USAGE
}
fail() { printf '安装失败：%s\n' "$*" >&2; exit 1; }
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --version|--prefix|--bin-dir)
      (($# >= 2)) && [[ -n "$2" ]] || fail "$1 缺少参数"
      case "$1" in --version) VERSION=${2#v} ;; --prefix) PREFIX=$2 ;; --bin-dir) BIN_DIR=$2 ;; esac
      shift 2 ;;
    --no-install-bun) INSTALL_BUN=0; shift ;;
    *) fail '未知参数，请使用 --help。不要把 token 放在安装参数中。' ;;
  esac
done
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || fail '版本格式无效'
case "$(uname -s)/$(uname -m)" in Linux/x86_64|Linux/aarch64|Darwin/x86_64|Darwin/arm64) ;; *) fail '当前仅支持 Linux / macOS 的 x64 / ARM64；已验收平台为 Linux x64。' ;; esac
for dependency in curl tar mktemp; do command -v "$dependency" >/dev/null || fail "缺少命令：$dependency"; done
command -v sha256sum >/dev/null || command -v shasum >/dev/null || fail '需要 sha256sum 或 shasum'
mkdir -p "$PREFIX" "$BIN_DIR"
PREFIX=$(cd "$PREFIX" && pwd -P); BIN_DIR=$(cd "$BIN_DIR" && pwd -P)
[[ "$PREFIX$BIN_DIR" != *$'\n'* && "$PREFIX$BIN_DIR" != *$'\r'* ]] || fail '安装路径不能包含换行'
for entry in mobile-herdr mherdr; do
  marker='# Mobile Herdr installed command'; [[ "$entry" == mherdr ]] && marker='# Mobile Herdr agent launcher'
  if [[ -e "$BIN_DIR/$entry" || -L "$BIN_DIR/$entry" ]]; then
    [[ -f "$BIN_DIR/$entry" ]] && grep -Fxq "$marker" "$BIN_DIR/$entry" || fail "$BIN_DIR/$entry 已存在，未覆盖。请选择另一个 --bin-dir。"
  fi
done
[[ ! -e "$PREFIX/current" || -L "$PREFIX/current" ]] || fail 'current 已存在且不是版本链接'
mkdir "$PREFIX/.install.lock" 2>/dev/null || fail '另一个安装正在进行；确认已退出后可移除 .install.lock 再试。'
TEMP_DIR=''; STAGE=''
cleanup() { [[ -z "$TEMP_DIR" ]] || rm -rf "$TEMP_DIR"; [[ -z "$STAGE" ]] || rm -rf "$STAGE"; rm -f "$PREFIX/.current.$$" "$BIN_DIR/.mobile-herdr.$$"; rmdir "$PREFIX/.install.lock"; }
trap cleanup EXIT
TEMP_DIR=$(mktemp -d)
download() { curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 2 --connect-timeout 15 --max-time 300 "$1" -o "$2"; }
if [[ -n "${MOBILE_HERDR_BUN:-}" ]]; then BUN_BIN=$MOBILE_HERDR_BUN
elif command -v bun >/dev/null; then BUN_BIN=$(command -v bun)
elif [[ -x "$HOME/.bun/bin/bun" ]]; then BUN_BIN=$HOME/.bun/bin/bun
elif [[ -x "$PREFIX/bun/bin/bun" ]]; then BUN_BIN=$PREFIX/bun/bin/bun
else
  ((INSTALL_BUN)) || fail '需要 Bun 1.4+；可先安装 Bun，再运行本脚本。'
  command -v unzip >/dev/null || fail '自动安装 Bun 需要 unzip'
  printf '未找到 Bun，将从 bun.sh 安装 Bun 1.4.0 到 %s/bun（不修改 shell 配置）。\n' "$PREFIX"
  download https://bun.sh/install "$TEMP_DIR/bun-install.sh"
  BUN_INSTALL="$PREFIX/bun" SHELL=/bin/false bash "$TEMP_DIR/bun-install.sh" bun-v1.4.0
  BUN_BIN=$PREFIX/bun/bin/bun
fi
[[ -x "$BUN_BIN" ]] || fail 'MOBILE_HERDR_BUN 必须是可执行文件的路径'
"$BUN_BIN" -e 'const [a,b]=Bun.version.split(".").map(Number); if(a<1||(a===1&&b<4)) process.exit(1)' || fail '需要 Bun 1.4+；未修改现有 Bun，请自行升级或设置 MOBILE_HERDR_BUN。'
BUN_BIN=$("$BUN_BIN" -e 'console.log(process.execPath)')
NAME=mobile-herdr-$VERSION
BASE=https://github.com/wuxiaobai24/mobile-herdr/releases/download/v$VERSION
printf '下载 Mobile Herdr %s…\n' "$VERSION"
download "$BASE/$NAME.tar.gz" "$TEMP_DIR/$NAME.tar.gz"
download "$BASE/$NAME.tar.gz.sha256" "$TEMP_DIR/$NAME.tar.gz.sha256"
read -r EXPECTED CHECK_FILE < "$TEMP_DIR/$NAME.tar.gz.sha256"
[[ "$EXPECTED" =~ ^[a-f0-9]{64}$ && "$CHECK_FILE" == "$NAME.tar.gz" ]] || fail '校验文件格式无效'
if command -v sha256sum >/dev/null; then ACTUAL=$(sha256sum "$TEMP_DIR/$NAME.tar.gz"); else ACTUAL=$(shasum -a 256 "$TEMP_DIR/$NAME.tar.gz"); fi
[[ "${ACTUAL%% *}" == "$EXPECTED" ]] || fail 'SHA-256 不匹配，未安装或切换版本'
tar -tzf "$TEMP_DIR/$NAME.tar.gz" > "$TEMP_DIR/entries"
while IFS= read -r entry; do
  case "$entry" in "$NAME/"*) ;; *) fail '压缩包路径无效' ;; esac
  case "/$entry/" in *'/../'*|*'/./'*) fail '压缩包包含不安全路径' ;; esac
done < "$TEMP_DIR/entries"
tar -tvzf "$TEMP_DIR/$NAME.tar.gz" | LC_ALL=C awk 'substr($0,1,1)!="d" && substr($0,1,1)!="-" {exit 1}' || fail '压缩包不能包含链接或特殊文件'
STAGE=$(mktemp -d "$PREFIX/.stage.XXXXXX")
tar -xzf "$TEMP_DIR/$NAME.tar.gz" -C "$STAGE"
MOBILE_HERDR_BUN="$BUN_BIN" "$STAGE/$NAME/bin/mobile-herdr" --version | grep -Fxq "$VERSION" || fail '包版本不匹配'
mkdir -p "$PREFIX/versions"
DESTINATION=$PREFIX/versions/$VERSION-${EXPECTED:0:12}
if [[ -e "$DESTINATION" ]]; then
  [[ -f "$DESTINATION/.archive-sha256" && "$(cat "$DESTINATION/.archive-sha256")" == "$EXPECTED" ]] || fail '目标目录已存在且来源不匹配，未覆盖'
else
  printf '%s\n' "$EXPECTED" > "$STAGE/$NAME/.archive-sha256"
  mv "$STAGE/$NAME" "$DESTINATION"
fi
"$BUN_BIN" -e 'const fs=require("node:fs");fs.writeFileSync(process.argv[1],JSON.stringify({prefix:process.argv[2],binDir:process.argv[3]}),{mode:0o600})' "$DESTINATION/.installation.json" "$PREFIX" "$BIN_DIR"
# Quote literal filesystem paths, including spaces and apostrophes, for the wrappers.
quote() { printf "'%s'" "${1//\'/\'\\\'\'}"; }
{
  printf '#!/bin/sh\n# Mobile Herdr installed command\n'
  printf 'if [ -z "${MOBILE_HERDR_BUN:-}" ]; then MOBILE_HERDR_BUN=%s; export MOBILE_HERDR_BUN; fi\n' "$(quote "$BUN_BIN")"
  printf 'exec %s "$@"\n' "$(quote "$PREFIX/current/bin/mobile-herdr")"
} > "$BIN_DIR/.mobile-herdr.$$"
chmod 755 "$BIN_DIR/.mobile-herdr.$$"
# install-agent pins the selected version; running agents and their runtime stay untouched.
MOBILE_HERDR_BUN="$BUN_BIN" "$DESTINATION/bin/mobile-herdr" install-agent --bin-dir "$BIN_DIR"
ln -s "$DESTINATION" "$PREFIX/.current.$$"
"$BUN_BIN" -e 'const fs=require("node:fs"); fs.renameSync(process.argv[1],process.argv[2]); fs.renameSync(process.argv[3],process.argv[4]);' "$PREFIX/.current.$$" "$PREFIX/current" "$BIN_DIR/.mobile-herdr.$$" "$BIN_DIR/mobile-herdr"
printf '\n已安装 Mobile Herdr %s：%s/mobile-herdr\n' "$VERSION" "$BIN_DIR"
printf '下一步：\n  %s/mobile-herdr token set  # 可选，不设置则自动生成\n  %s/mobile-herdr background\n  %s/mobile-herdr pair --url http://手机可访问的开发机地址:7331\n' "$BIN_DIR" "$BIN_DIR" "$BIN_DIR"
printf '局域网访问时启动前设置 MOBILE_HERDR_HOST=0.0.0.0；默认仅本机访问。Herdr 须已安装并运行。\n'
printf '未启动或停止任何 bridge、Herdr 或 agent；升级后请按指南重启自己的 Mobile Herdr bridge。\n'
case ":$PATH:" in *":$BIN_DIR:"*) ;; *) printf '请将 %s 加入 PATH，或使用上面的完整路径。未修改 shell 配置。\n' "$BIN_DIR" ;; esac
