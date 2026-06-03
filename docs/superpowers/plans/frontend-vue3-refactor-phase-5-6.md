# Nexterm 前端重构 Phase 5+6 — 类型/工具整合与 Vue 3.5+ 特性收尾

## 范围

- 引入三个共享类型/工具模块（`refs.ts` / `path.ts` / `normalizeError.ts`）替换翻译残留和重复实现
- 引入 `useEventListener` composable，改造 `MainApp.vue` 的 window/document 事件订阅
- 把 `ref<InstanceType<...>>` 替换为 `useTemplateRef`
- 新增 `translationTraces` 与 `noOptionsApiBoundary` 两个边界测试固化契约

## 关键变更点

### 新增

| 文件 | 角色 |
| --- | --- |
| `src/lib/refs.ts` | `ReadonlyRef<T>`（替代 `ReadableRef<T>`）、`MaybeRef<T>` |
| `src/lib/path.ts` | `basename` / `dirname`（跨平台分隔符） |
| `src/lib/normalizeError.ts` | 统一错误归一化（可选 `t` 翻译） |
| `src/lib/useEventListener.ts` | `watchEffect` + `onCleanup` 的事件订阅 composable，支持 Window / Document / HTMLElement / MediaQueryList |
| `src/lib/translationTraces.test.ts` | 边界测试：禁止 `ReadableRef` / `useState` / `useEffect` / `useMemo` 等 React 命名 |
| `src/lib/noOptionsApiBoundary.test.ts` | 边界测试：禁止 Options API 残留（Vue `export default {` + Pinia `defineStore` 对象形式） |
| `src/lib/useEventListener.test.ts` | composable 单元测试 |

### 改动

| 文件 | 变更 |
| --- | --- |
| `src/modules/source-control/useSourceControlState.ts` | 删除本地 `ReadableRef` 类型，`SourceControlRuntimeState` 改用 `ReadonlyRef<T>` from `@/lib/refs` |
| `src/modules/source-control/useSourceControlGitMetadata.ts` | 同样改用 `ReadonlyRef<T>` |
| `src/app/MainApp.vue` | `colorSchemeQuery` / `window` 的 4 个事件订阅改用 `useEventListener`；`closeGuard` / `workspaceShell` 改用 `useTemplateRef` |

### 故意未做（Phase 4 之外）

- `useWorkbenchCommands.ts` / `useSourceControlActions.ts` 拆分（Phase 4.5 / 4.6 范围）
- `AppHeader.vue` / `WorkspaceShell.vue` / `EditorPane.vue` / `FileExplorer.vue` 等 god component 拆分（Phase 4.1–4.7 范围）
- `useWorkbenchLayout.ts` / `useWindowChromeState.ts` 内的 `addEventListener` / `removeEventListener` 配对（仍沿用 `onMounted` / `onUnmounted`，可单独再做一轮）
- `defineModel` 在 `SettingsPanel.vue` 的 `activeTab` 评估后保留 emit 形式（emit 列表稳定，强行 `defineModel` 风险大于收益）
- `useDebouncedRef` 自研：当前 `useWorkbenchLayout` 的 `setTimeout` 防抖没有重构；纳入 Phase 4 的 `useWorkbenchLayout` 重构再做单点试用

## 验证结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm test` | 通过（380/382；2 个预存在失败与本阶段无关） |
| `pnpm build` (`vue-tsc --noEmit && vite build`) | 通过 |
| `pnpm exec vitest run src/lib/translationTraces.test.ts` | 通过 |
| `pnpm exec vitest run src/lib/noOptionsApiBoundary.test.ts` | 2/2 通过 |
| `pnpm exec vitest run src/lib/useEventListener.test.ts` | 1/1 通过 |
| `pnpm exec vitest run src/lib/nativeBoundary.test.ts` | 0 违规 |
| `pnpm exec vitest run src/lib/eventBoundary.test.ts` | 0 违规 |
| `pnpm exec vitest run src/modules/pinia/setupStoreBoundary.test.ts` | 3/3 通过 |

## 风险与遗留

- `ReadableRef<T>` 仅在 `useSourceControlState.ts` 中被实际使用，迁移到 `ReadonlyRef<T>` 是符号级改名，公共 API 形态未变。`useSourceControlGitMetadata.ts` 的导入也同步更新。
- `MainApp.vue` 仍然有 500+ 行，是 god component。本次仅替换事件订阅的写法（4 个 `addEventListener`/`removeEventListener` 配对 → 4 个 `useEventListener` 调用），未拆解其模板/脚本结构。后续 Phase 4 的 4.1 子项仍可继续拆分。
- `useEventListener` 的 `onCleanup` 是 `watchEffect` 的回调参数；vue-tsc 在最新版本下不会把 `onCleanup` 当作未使用变量。本阶段未走 `onWatcherCleanup` 路径，避免和类型推断冲突。

## 下一阶段（不在本次计划内）

- 真正完成 Phase 4（MainApp 模板拆分、useWorkbenchCommands/useSourceControlActions 拆分、AppHeader/WorkspaceShell/EditorPane/FileExplorer 拆分）
- 评估 `useDebouncedRef` 自研（用作 `useWorkbenchLayout` 防抖的替代）
- 评估 `defineModel` 替换 `SettingsPanel.vue` 的 `activeTab` 双向绑定
