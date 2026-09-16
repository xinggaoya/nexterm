#!/usr/bin/env bash
# 把 release 的 latest.json 资产同步到 main 分支固定路径,
# 作为 CDN 边缘节点 404 时的 fallback endpoint。
#
# 用法:
#   sync-latest-json.sh <tag_name>
#
# 依赖: gh CLI 已认证, jq 已安装,git 配置好 user.name / user.email。

set -euo pipefail

tag_name="${1:?usage: sync-latest-json.sh <tag_name>}"
repository="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY must be set}"
token="${GH_TOKEN:?GH_TOKEN must be set}"

echo "Fetching latest.json content from release ${tag_name} asset API..."

asset_api_url=$(
  curl -s \
    -H "Authorization: token ${token}" \
    "https://api.github.com/repos/${repository}/releases/tags/${tag_name}" \
    | jq -r '.assets[] | select(.name=="latest.json") | .url'
)

if [ -z "${asset_api_url}" ] || [ "${asset_api_url}" = "null" ]; then
  echo "::warning::latest.json asset not found in release ${tag_name}, skipping sync"
  exit 0
fi

content_base64=$(
  curl -sL \
    -H "Authorization: token ${token}" \
    -H "Accept: application/octet-stream" \
    "${asset_api_url}" \
    | base64 -w 0
)

existing_sha=$(
  curl -s \
    -H "Authorization: token ${token}" \
    "https://api.github.com/repos/${repository}/contents/updates/latest.json?ref=main" \
    | jq -r '.sha // empty'
)

payload=$(
  jq -n \
    --arg msg "chore(release): sync latest.json for ${tag_name} [skip ci]" \
    --arg content "${content_base64}" \
    --arg branch "main" \
    --arg sha "${existing_sha}" \
    '{message: $msg, content: $content, branch: $branch}
     + (if $sha != "" then {sha: $sha} else {} end)'
)

http_status=$(
  curl -s -o /tmp/sync-response.json -w "%{http_code}" \
    -X PUT \
    -H "Authorization: token ${token}" \
    -H "Content-Type: application/json" \
    -d "${payload}" \
    "https://api.github.com/repos/${repository}/contents/updates/latest.json"
)

if [ "${http_status}" = "200" ] || [ "${http_status}" = "201" ]; then
  echo "latest.json synced to main branch (status ${http_status})"
else
  echo "::error::Failed to sync latest.json (status ${http_status})"
  cat /tmp/sync-response.json
  exit 1
fi
