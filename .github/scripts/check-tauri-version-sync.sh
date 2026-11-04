#!/usr/bin/env bash
# 校验 npm 侧 @tauri-apps/api 与 Rust 侧 tauri crate 的 **minor 版本一致**。
#
# 为什么要这道门禁：
# Tauri CLI 在 `tauri build` 开始时会检查两者的 major.minor，不一致就直接
# 退出（"Found version mismatched Tauri packages"）。而两个 lockfile 各自
# 浮动 —— Rust 侧被 cargo 升到 2.12，npm 侧还停在 2.10 —— 于是 CI 一直
# 绿灯（CI 跑的是 `pnpm build`，不经过 tauri CLI），直到发版才炸：
#
#   v0.3.0 的 release 在三个平台同时挂在这一处。
#
# 把检查提前到 CI，漂移在 push 时就被拦下，而不是在 release 里。
#
# 用法:
#   check-tauri-version-sync.sh

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"

# npm 侧：pnpm-lock.yaml 里根 importer 解析到的 @tauri-apps/api 版本。
npm_version=$(awk '
  /^  \.:$/ { in_root = 1; next }
  in_root && /^  [^ ]/ { in_root = 0 }
  !in_root { next }
  /^      .?@tauri-apps\/api.?:$/ { want = 1; next }
  want && /^        version: / {
    gsub(/^        version: /, "")
    gsub(/[^0-9.].*$/, "")
    print
    exit
  }
' pnpm-lock.yaml)

# Rust 侧：Cargo.lock 里的 tauri crate 版本。
crate_version=$(awk '
  /^name = "tauri"$/ { getline; gsub(/version = "/, ""); gsub(/"/, ""); print; exit }
' src-tauri/Cargo.lock)

if [ -z "$npm_version" ] || [ -z "$crate_version" ]; then
  echo "::error::无法读出版本：npm=${npm_version:-<空>} crate=${crate_version:-<空>}"
  exit 1
fi

npm_minor="$(echo "$npm_version" | cut -d. -f1,2)"
crate_minor="$(echo "$crate_version" | cut -d. -f1,2)"

if [ "$npm_minor" != "$crate_minor" ]; then
  echo "::error::@tauri-apps/api 与 tauri crate 的 minor 版本不一致：npm ${npm_version} vs crate ${crate_version}。Tauri CLI 会在 \`tauri build\` 时直接失败，请把两者对齐到同一个 minor。"
  exit 1
fi

echo "版本一致：@tauri-apps/api ${npm_version} ↔ tauri ${crate_version}（minor ${npm_minor}）"
