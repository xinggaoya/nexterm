#!/usr/bin/env bash
# 发布 draft release 并写入最终 notes。
#
# 用法:
#   publish-release.sh <tag_name>
#
# 从 CHANGELOG.md 抽取对应版本的段作为 notes,找不到时使用简短 fallback。
# 在末尾追加下载说明表格,然后取消 draft 标记。

set -euo pipefail

tag_name="${1:?usage: publish-release.sh <tag_name>}"
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

version="${tag_name#v}"
repository="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"

echo "Publishing release ${tag_name} for ${repository}..."

notes="$("${script_dir}/extract-changelog.sh" "${version}" || true)"

if [ -z "${notes}" ]; then
  echo "::warning::No CHANGELOG section found for ${version}, falling back to short notes"
  notes="## Nexterm ${tag_name}

自动构建的 Nexterm 桌面安装包,支持应用内自动更新。

完整变更说明参见 [CHANGELOG.md](https://github.com/${repository}/blob/${tag_name}/CHANGELOG.md)。"
fi

# 追加下载表格(对 markdown 表格的 `|` 不需要转义 — 此字符串由 gh CLI 处理)
notes="${notes}

### 下载

| 平台 | 包 |
| --- | --- |
| Windows | \`.exe\` (NSIS) · \`.msi\` |
| macOS | \`.dmg\` (universal) · \`.app.tar.gz\` |
| Linux | \`.deb\` · \`.rpm\` · \`.AppImage\` |

所有产物已使用 Tauri 私钥签名,客户端会通过内置公钥验证更新来源。"

gh release edit "${tag_name}" \
  --draft=false \
  --notes "${notes}"

echo "Release ${tag_name} published."
