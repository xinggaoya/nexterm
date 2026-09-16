#!/usr/bin/env bash
# 从 CHANGELOG.md 抽取指定版本的段。
#
# 用法:
#   extract-changelog.sh <version>
#
# 输出从 `## [<version>]` 标题行开始,直到下一个 `## [` 标题之前的所有内容。
# 找不到对应段时输出空字符串,由调用方决定 fallback。

set -euo pipefail

version="${1:?usage: extract-changelog.sh <version>}"
changelog="${CHANGELOG_FILE:-CHANGELOG.md}"

awk -v ver="[${version}]" '
  BEGIN { capturing = 0 }
  /^## \[/ {
    if (capturing) exit
    if (index($0, ver) > 0) {
      capturing = 1
      print
      next
    }
  }
  capturing { print }
' "$changelog"
