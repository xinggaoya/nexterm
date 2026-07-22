# Errors

Command failures and integration errors.

---

## [ERR-20260722-001] pnpm test

**Logged**: 2026-07-22T23:30:37+08:00
**Priority**: medium
**Status**: resolved
**Area**: tests

### Summary

从主工作树运行 Vitest 时，项目内尚未清理的 `.worktrees/` 被当作测试源码重复扫描。

### Error

```text
同一批测试同时从 src/ 和 .worktrees/<branch>/src/ 执行，第二套 Vue/Pinia
运行时产生 getActivePinia()、window is not defined 等交叉污染失败。
```

### Context

- 操作：功能分支快进合并到 `main` 后，在清理项目内 worktree 前执行 `pnpm test`。
- 环境：Vitest 默认递归发现 `*.test.ts`，Git 忽略规则不会排除测试发现。
- 产品代码的独立 worktree 测试此前已通过；清理 worktree 后主树全量测试恢复通过。

### Suggested Fix

合并项目内 worktree 后，先按分支收尾流程删除该 worktree，再从主树运行最终测试。若需要长期保留项目内 worktree，应在 Vitest 配置中显式排除 `**/.worktrees/**`。

### Metadata

- Reproducible: yes
- Related Files: `.gitignore`, `vite.config.ts`

### Resolution

- **Resolved**: 2026-07-22T23:29:10+08:00
- **Commit/PR**: `a16f733`
- **Notes**: 删除已合并 worktree 和功能分支后重新运行，110 个测试文件通过。

---
