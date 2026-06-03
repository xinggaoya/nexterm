# Nexterm 前端 Vue 3 架构与编码规范重构 — 总览

## 总结

按 `local://nexterm-frontend-vue3-refactor.md` 计划，分 6 阶段推进。每阶段产出独立文档（`phase-1.md` … `phase-5-6.md`）。本文件给出阶段全景、最终验证结果与遗留工作。

## 阶段进度

| 阶段 | 主题 | 状态 | 文档 |
| --- | --- | --- | --- |
| Phase 1 | 基础设施：边界测试 + 公共工具 | ✅ 完成 | `phase-1.md` |
| Phase 2 | IPC 收口到 `native.ts` | ✅ 完成 | `phase-2.md` |
| Phase 3 | Pinia stores 改 setup-function 模式 | ✅ 完成 | `phase-3.md` |
| Phase 4 | god component 拆分 | ⚠️ 部分（仅 MainApp 事件订阅 + template ref 改造，模板/脚本结构未拆解） | — |
| Phase 5 | 类型/工具整合 | ✅ 完成 | `phase-5-6.md` |
| Phase 6 | Vue 3.5+ 特性收尾 | ✅ 完成 | `phase-5-6.md` |

## 新增文件清单

### Phase 1
- `src/lib/nativeBoundary.test.ts`
- `src/lib/eventBoundary.test.ts`
- `src/modules/pinia/setupStoreBoundary.test.ts`
- `src/lib/emptyObject.ts`
- `src/lib/types.ts`

### Phase 2
- `src/lib/native.ts` — 新增 `fs*` / `pty*` / `getLaunchDir` / `getWslHome` / `wslListDistros` 方法与 `Fs*` / `Pty*` 类型

### Phase 5
- `src/lib/refs.ts` — `ReadonlyRef<T>` / `MaybeRef<T>`
- `src/lib/path.ts` — `basename` / `dirname`
- `src/lib/normalizeError.ts`
- `src/lib/translationTraces.test.ts`

### Phase 6
- `src/lib/useEventListener.ts`
- `src/lib/useEventListener.test.ts`
- `src/lib/noOptionsApiBoundary.test.ts`

## 改动文件清单

| 文件 | 主要改动 |
| --- | --- |
| `src/lib/native.ts` | 收口 fs/pty/wsl/launchDir IPC，新增 `WorkspaceEnv` 透传给 `workspaceAuthorize` |
| `src/modules/editor/lib/documentService.ts` | 改用 `native.fsReadFile` / `native.fsWriteFile` |
| `src/modules/explorer/lib/fileTreeService.ts` | 改用 `native.fs*` |
| `src/modules/markdown/lib/markdownDocumentService.ts` | 改用 `native.fsReadFile` |
| `src/modules/terminal/lib/pty-bridge.ts` | thin re-export of `native.ptyOpen` + types |
| `src/modules/workspace/workspaceEnvPinia.ts` | setup 模式 + `native.wslListDistros` |
| `src/modules/workspace/workspaceNative.ts` | 改用 `native.*` |
| `src/modules/workspace/workspaceRootPinia.ts` | setup 模式 |
| `src/modules/settings/preferencesPinia.ts` | setup 模式（21 个字段独立 `ref`） |
| `src/modules/tabs/tabsPinia.ts` | setup 模式 |
| `src/modules/tabs/closeGuards.ts` | 改用 `@/lib/path` 共享 `basename` |
| `src/modules/source-control/useSourceControlState.ts` | 删 `ReadableRef`，改用 `ReadonlyRef` |
| `src/modules/source-control/useSourceControlGitMetadata.ts` | 同步 `ReadonlyRef` |
| `src/app/MainApp.vue` | 4 个 `addEventListener`/`removeEventListener` 配对改 `useEventListener`；`closeGuard` / `workspaceShell` 改 `useTemplateRef` |
| `src/lib/launchDir.ts` | 改用 `native.getLaunchDir` |
| `src/modules/pinia/setupStoreBoundary.test.ts` | 容忍列表 4 → 2，新增 `this.*` 断言 |
| `src/lib/nativeBoundary.test.ts` | 容忍列表 14 → 7（仅测试文件 + native.ts） |
| `src/lib/native.test.ts` | 新增 7 个 fs/pty 用例，含 `Channel` mock |

## 最终验证结果

### `pnpm test`

```
Test Files  2 failed | 90 passed (92)
Tests  2 failed | 380 passed (382)
```

2 个预存在失败与本计划无关（`main` 分支 HEAD 同样存在）：

- `src/modules/explorer/FileExplorer.vue.test.ts > renders git tones for changed files and parent folders`
  - `Cannot call attributes on an empty DOMWrapper.`
- `src/modules/source-control/SourceControlPanel.vue.test.ts > runs fetch pull and push operations then refreshes status`
  - `expected "spy" to be called with arguments: [ '/repo' ]`

### `pnpm build` (`vue-tsc --noEmit && vite build`)

```
✓ 4423 modules transformed.
✓ built in 9.60s
```

### 边界测试矩阵

| 测试 | 状态 | 覆盖 |
| --- | --- | --- |
| `nativeBoundary.test.ts` (Phase 1+2) | ✅ 0 违规 | IPC 收口 |
| `eventBoundary.test.ts` (Phase 1) | ✅ 0 违规 | 事件总线收口 |
| `setupStoreBoundary.test.ts` (Phase 1+3) | ✅ 3/3 | Pinia setup 模式 + `this.*` 拒绝 |
| `translationTraces.test.ts` (Phase 5) | ✅ 1/1 | 无 React 命名 |
| `noOptionsApiBoundary.test.ts` (Phase 6) | ✅ 2/2 | 无 Options API 残留 |
| 既有 5 项 boundary | ✅ 全部通过 | 不退化 |

### 新增测试覆盖

| 文件 | 用例数 |
| --- | --- |
| `src/lib/native.test.ts`（新增 fs/pty 用例） | 7 |
| `src/lib/useEventListener.test.ts` | 1 |
| `src/lib/translationTraces.test.ts` | 1 |
| `src/lib/noOptionsApiBoundary.test.ts` | 2 |
| `src/lib/nativeBoundary.test.ts` | 1 |
| `src/lib/eventBoundary.test.ts` | 1 |
| `src/modules/pinia/setupStoreBoundary.test.ts` | 3（含 `this.*` 断言） |
| **小计** | **16** |

## 风险与遗留

### 已收口

- 6 个原直接 `invoke` 的实现文件已迁到 `native.*` 单一出口
- 4 个 Pinia store 全部迁移到 setup-function 模式
- `ReadableRef` 翻译残留已替换为 `ReadonlyRef` from `@/lib/refs`
- 4 个 `MainApp.vue` 事件订阅改用 `useEventListener`，避免 cleanup 配对遗漏
- 2 个 `ref<InstanceType<...>>` 改用 `useTemplateRef`
- 重复的 `basename` / `normalizeError` 出现 7 处，2 处（`closeGuards.ts`）已切到 `@/lib/path` 共享版本；其余 5 处（`AppHeader.vue` / `WorkspaceWelcome.vue` / `FileExplorer.vue` / `GitHistoryPane.vue` / `tabsPinia.ts`）保留本地实现以减少本次合并风险，纳入 Phase 4 god component 拆分时一并迁移

### 未完成（计划内但本次未执行）

- **Phase 4 god component 拆分**（4.1–4.7）：
  - `MainApp.vue` 仍是 500+ 行（仅事件订阅和 template ref 形式现代化，模板/脚本结构未拆解）
  - `AppHeader.vue` 651 行、`WorkspaceShell.vue` 310 行、`EditorPane.vue` 462 行、`FileExplorer.vue` 19.7KB、`SourceControlChangeList.vue` 9.1KB 全部未拆
  - `useWorkbenchCommands.ts` 30+ 字段 options bag 未拆
  - `useSourceControlActions.ts` 14 种 git 动作未按类别拆
  - 这些 god component 拆分的 ROI 高（god component 拆解后团队 review/修改效率显著提升），但单次 PR 容易引入回归，需要更谨慎的拆分节奏

### 故意不做

- 评估 `defineModel` 替换 `SettingsPanel.vue` 的 `activeTab` 双向绑定：emit 列表稳定，强行 `defineModel` 收益小
- 自研 `useDebouncedRef`：当前 `useWorkbenchLayout` 的 `setTimeout` 防抖没有重构；纳入 Phase 4.5 的 `useWorkbenchCommands` 拆分时再做单点试用
- 引入新依赖（`vueuse`）：按当前计划约定不引入第三方包
- 性能优化（xterm 渲染、虚拟列表、响应式细粒度）：不属于本次架构范围

## 后续建议

1. **继续 Phase 4 god component 拆分**：按 4.1 → 4.7 顺序，单 PR 单子项，最小风险。
2. **完成 `basename` / `normalizeError` 全量收口**：剩余 5 处本地实现统一改用 `@/lib/path` 与 `@/lib/normalizeError`。
3. **修复 2 个预存在测试失败**：`FileExplorer.vue.test.ts > renders git tones` 和 `SourceControlPanel.vue.test.ts > runs fetch pull and push`。这两个是测试本身问题（DOM 选择 / spy 装配），不属于本次重构范围但应在下次维护窗口修复。
4. **`.vue` 模块声明**：仓库 `tsconfig.json` 缺 `*.vue` 模块声明，独立排期（计划外）。
