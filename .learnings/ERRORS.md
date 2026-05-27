# Errors

Command failures and integration errors.

---

## [ERR-20260526-001] rg_pattern_option_conflict

**Logged**: 2026-05-26T17:12:02+08:00
**Priority**: low
**Status**: pending
**Area**: infra

### Summary
`rg` 搜索模式以 `--format` 开头时被当作命令参数解析。

### Error
```text
rg: unrecognized flag --format
```

### Context
- Command attempted: `rg -n "--format=.*%x1f|%x1f" src-tauri/src/modules/git`
- Patterns beginning with `-` need an option terminator before the pattern.

### Suggested Fix
Use `rg -n -- "<pattern>" <path>` for patterns that may begin with `-`.

### Metadata
- Reproducible: yes
- Related Files: n/a

---
