#!/usr/bin/env bash
# cargo audit 的唯一入口。
#
# 为什么需要脚本而不是直接 `cargo audit`：cargo-audit 0.22 的配置文件发现
# 在不同版本/平台上不一致（audit.toml 与 CARGO_AUDIT_CONFIG 都验证过不生效），
# 而豁免清单必须**可审计** —— 有人 review 时应该能看到「哪些告警被接受了、
# 理由是什么」，而不是一串散落在 workflow 里的 --ignore。
#
# audit.toml 是唯一事实来源；这里只负责把 ID 提取成 --ignore 参数。
set -euo pipefail

cd "$(dirname "$0")/.."

config="audit.toml"
if [[ ! -f "$config" ]]; then
  echo "cargo audit: missing $config" >&2
  exit 1
fi

ignores=()
while IFS= read -r id; do
  # 去掉 `    "` 前缀与 `",` 后缀，只留 ID 本体
  id="${id//\"/}"
  id="${id// /}"
  id="${id//,}"
  [[ -z "$id" || "$id" == \#* ]] && continue
  ignores+=(--ignore "$id")
done < <(sed -n 's/^[[:space:]]*"\(RUSTSEC-[0-9-]*\)".*/\1/p' "$config")

if [[ ${#ignores[@]} -eq 0 ]]; then
  echo "cargo audit: $config contains no advisory ids — did it get emptied?" >&2
  exit 1
fi

echo "cargo audit: applying ${#ignores[@]} accepted advisories from $config"
cargo audit "${ignores[@]}" "$@"
