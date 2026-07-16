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

## [ERR-20260716-001] terminal_native_boundary_regression

**Logged**: 2026-07-16T10:08:16+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
终端 V2 重构后的 `sessions.ts` 直接导入 Tauri `invoke/Channel`，破坏统一 IPC 边界。

### Error
```text
nativeBoundary.test.ts expected [] but received ["modules/terminal/lib/sessions.ts"]
```

### Context
- Command attempted: targeted Vitest run for terminal and native boundary tests.
- The repository requires all frontend IPC calls to pass through `src/lib/native.ts`.

### Suggested Fix
让终端会话复用 `native.ptyOpen` 返回的 typed session，并通过 native wrapper 执行 kill。

### Metadata
- Reproducible: yes
- Related Files: src/modules/terminal/lib/sessions.ts, src/lib/native.ts

### Resolution
- **Resolved**: 2026-07-16T10:32:11+08:00
- **Notes**: 会话改用 `native.ptyOpen/ptyKill`，native boundary 定向与全量测试均通过。

---

## [ERR-20260716-002] pnpm_pack_dry_run_target_ignored

**Logged**: 2026-07-16T10:20:00+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
使用 `pnpm pack <package> --dry-run` 检查第三方包时，pnpm 忽略目标并打包了当前项目。

### Error
```text
Tarball Details: nexterm-0.1.2.tgz
```

### Context
- Intended operation: inspect a registry package without installing it.
- The generated local tarball was removed immediately.

### Suggested Fix
使用 `npm pack <package> --dry-run --json` 或直接读取 registry tarball metadata。

### Metadata
- Reproducible: yes
- Related Files: n/a

### Resolution
- **Resolved**: 2026-07-16T10:20:00+08:00
- **Notes**: 清理临时 tarball，后续改用 npm registry inspection。

---

## [ERR-20260716-003] terminal_test_fixture_environment

**Logged**: 2026-07-16T10:31:29+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
新增终端快捷键测试缺少 jsdom，PTY mock 也未遵守 Promise 返回契约。

### Error
```text
KeyboardEvent is not defined
Cannot read properties of undefined (reading 'catch')
```

### Context
- Targeted Vitest run after adding terminal regression coverage.
- Production type checking and native boundary test already passed.

### Suggested Fix
为 DOM 快捷键测试声明 jsdom 环境，并让异步 native mocks 返回 resolved Promise。

### Metadata
- Reproducible: yes
- Related Files: src/modules/terminal/lib/shortcuts.test.ts, src/modules/terminal/lib/sessions.test.ts

### Resolution
- **Resolved**: 2026-07-16T10:33:00+08:00
- **Notes**: 补齐测试环境与异步 mock 契约。

---

## [ERR-20260716-004] manual_lockfile_integrity_typo

**Logged**: 2026-07-16T10:37:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
收敛 pnpm 锁文件的无关升级时手工误写了旧包 integrity 的一个字符。

### Error
```text
ERR_PNPM_TARBALL_INTEGRITY for fast-wrap-ansi@0.2.0
```

### Context
- The immutable HEAD lockfile contained the authoritative integrity value.
- Frozen install caught the mismatch before verification continued.

### Suggested Fix
恢复锁文件条目时直接与 `git show HEAD:<path>` 比对，不手工重录完整性摘要。

### Metadata
- Reproducible: yes
- Related Files: pnpm-lock.yaml

### Resolution
- **Resolved**: 2026-07-16T10:38:00+08:00
- **Notes**: 从 HEAD 恢复精确 integrity 并重新执行 frozen install。

---

## [ERR-20260716-005] existing_frontend_test_failures

**Logged**: 2026-07-16T10:34:43+08:00
**Priority**: medium
**Status**: pending
**Area**: tests

### Summary
全量前端测试存在与终端修改无关、可隔离复现的既有失败和异步 mock 泄漏。

### Error
```text
MainApp.vue.test.ts: 10 failures plus 10 unhandled mock/runtime errors
useWorkbenchLayout.test.ts: expected 274, received 272
FileExplorer.vue.test.ts: empty DOMWrapper for git tone assertion
```

### Context
- `pnpm test` reported 12 failures across 3 files; 376 tests passed.
- Each failing file reproduces when run without terminal tests.
- Terminal regression tests, native boundary, type checking, and production build pass.

### Suggested Fix
Separate follow-up: stabilize MainApp Tauri/store mocks, align workbench width expectation, and repair the explorer git-tone fixture.

### Metadata
- Reproducible: yes
- Related Files: src/app/MainApp.vue.test.ts, src/app/useWorkbenchLayout.test.ts, src/modules/explorer/FileExplorer.vue.test.ts

---

## [ERR-20260716-006] grep_empty_file_type

**Logged**: 2026-07-16T14:50:58+08:00
**Priority**: low
**Status**: resolved
**Area**: tests

### Summary
调用 Grep 工具时传入空字符串 `type`，导致 ripgrep 将其解析为未知文件类型。

### Error
```text
rg: unrecognized file type:
```

### Context
- 搜索 `VimMode` 与 `monaco-vim` 的引用。
- 同时已提供 `glob`，无需再传空的 `type` 参数。

### Suggested Fix
未使用文件类型筛选时省略 `type` 参数；需要筛选时传有效类型名。

### Metadata
- Reproducible: yes
- Related Files: n/a

### Resolution
- **Resolved**: 2026-07-16T14:50:58+08:00
- **Notes**: 改用有效的 TypeScript 文件类型并完成搜索。

---

## [ERR-20260716-007] node_direct_monaco_vim_import

**Logged**: 2026-07-16T14:53:26+08:00
**Priority**: low
**Status**: resolved
**Area**: frontend

### Summary
用 Node 直接导入 `monaco-vim` ESM 入口时，Node 无法解析包内无扩展名的 Monaco 子路径。

### Error
```text
ERR_MODULE_NOT_FOUND: monaco-editor/esm/vs/editor/editor.api
```

### Context
- 该命令用于检查运行时导出名。
- 这是 Node ESM 解析限制；Vite 会把同一路径解析为带 `.js` 的浏览器模块。

### Suggested Fix
对 Vite 应用依赖使用 Vite 实际转换结果验证，不用 Node 原生 ESM 直接导入代替浏览器解析。

### Metadata
- Reproducible: yes
- Related Files: node_modules/monaco-vim/dist/index.mjs

### Resolution
- **Resolved**: 2026-07-16T14:53:26+08:00
- **Notes**: 通过正在运行的 Vite 服务确认 ESM 入口被正确转换。

---

## [ERR-20260716-008] duplicate_vite_dev_server

**Logged**: 2026-07-16T14:53:26+08:00
**Priority**: low
**Status**: resolved
**Area**: infra

### Summary
尝试启动诊断用 Vite 服务时，端口 `3180` 已由当前 Nexterm 进程监听。

### Error
```text
Error: Port 3180 is already in use
```

### Context
- 现有服务可直接用于获取 Vite 转换后的模块。
- 未终止或修改用户正在运行的进程。

### Suggested Fix
先检查监听端口；需要独立验证时改用其他端口。

### Metadata
- Reproducible: yes
- Related Files: vite.config.ts

### Resolution
- **Resolved**: 2026-07-16T14:53:26+08:00
- **Notes**: 复用现有服务收集证据，后续独立验证使用其他端口。

---
