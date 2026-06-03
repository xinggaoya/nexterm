# Nexterm 前端重构 Phase 3 — Pinia stores 改 setup 模式

## 范围

把 4 个 Pinia store 全部迁移到 setup-function 模式（`defineStore("name", () => { ... })`），并扩充 `setupStoreBoundary.test.ts` 拒绝 `this.*` 访问。

## 关键变更点

### 迁移文件

| 文件 | 状态 | 关键改动 |
| --- | --- | --- |
| `src/modules/settings/preferencesPinia.ts` | ✅ setup | 21 个字段拆为独立 `ref<>`，20 个 `updateXxx` 方法改为普通 `async function` |
| `src/modules/tabs/tabsPinia.ts` | ✅ setup | `state` 拆为 4 个 `ref`，所有 action 改为顶层 `function` |
| `src/modules/workspace/workspaceEnvPinia.ts` | ✅ setup | `state` 拆为 4 个 `ref`，2 个 action 改为顶层 `function` |
| `src/modules/workspace/workspaceRootPinia.ts` | ✅ setup | `state` 拆为 6 个 `ref`，7 个 action 改为顶层 `function` |

### 边界测试扩展

`src/modules/pinia/setupStoreBoundary.test.ts` 收紧容忍名单（从 4 → 2 项）并新增第三条用例：

- 用例 1：扫描所有 Pinia store 文件，断言非容忍列表里没有 `state: {` / `actions: {` / `getters: {` 反模式
- 用例 2：固定容忍名单内容，防止列表漂移
- 用例 3（新）：扫描所有 Pinia store 文件，断言任何 store 文件不得出现 `this.<identifier>` 访问

## 设计取舍

### 公共 API 形态不变

所有 store 的属性名 / 方法名都保持原样，调用方（`useWorkspaceLifecycle` / `useWorkbenchCommands` / `useSourceControlState` / `MainApp.vue` / `useTaskConsoleController` 等）零改动：

- `prefs.theme` / `prefs.hydrate()` / `prefs.updateTheme(value)` / `prefs.touchOptimizations = "on"` 全部继续可用（Pinia 自动展开 setup store 的 ref）
- `tabs.newTab(cwd)` / `tabs.activeId` / `tabs.moveTab(...)` 继续可用
- `workspaceRoot.openWorkspace(path, env)` / `workspaceRoot.recentWorkspaces` 继续可用

### 私有类型保留

迁移中保留以下私有类型 / 内部 helper（不进 store return）：

- `tabsPinia.ts`: `createInitialTab` / `basename` / `titleFromUrl` / `inputForCommand` / `taskTitle`
- `workspaceRootPinia.ts`: `isWorkspaceEnv` / `isStoredWorkspace` / `normalizeStoredWorkspace` / `normalizeRecentWorkspaces` / `workspaceKey` / `isWindowsDrivePath` / `isLinuxAbsolutePath` / `isUncPath` / `isWslUncPath` / `wslHomeToUnc` / `dialogDefaultPath` / `envForSelectedDirectory` / `upsertRecent` / `normalizeError`
- `preferencesPinia.ts`: 私有 `applySnapshot` / `readPreferencesSnapshot` 辅助函数

这些 helper 都是 store 私有的实现细节，不属于公共 API。

## 验证结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm test` | 通过（376/378；2 个预存在失败与本阶段无关：`FileExplorer.vue > renders git tones`、`SourceControlPanel.vue > runs fetch pull and push`） |
| `pnpm build` (`vue-tsc --noEmit && vite build`) | 通过 |
| `pnpm exec vitest run src/modules/pinia/setupStoreBoundary.test.ts` | 3/3 通过 |
| `pnpm exec vitest run src/lib/nativeBoundary.test.ts` | 0 违规 |
| `pnpm exec vitest run src/lib/eventBoundary.test.ts` | 0 违规 |
| `pnpm exec vitest run src/modules/tabs/tabsPinia.test.ts` | 17/17 通过 |
| `pnpm exec vitest run src/modules/workspace/workspaceRootPinia.test.ts` | 14/14 通过 |
| `pnpm exec vitest run src/modules/workspace/workspaceEnvPinia.test.ts` | 4/4 通过 |

## 风险与遗留

- `preferencesPinia.ts` 体积从 163 行增长到 303 行（每个字段独立 `ref` + `updateXxx` 函数），这是 setup 模式不可避免的代价。Phase 4 可以在外部 composable 中聚合更新操作（如果发现有用）。
- `tabsPinia.ts` / `workspaceRootPinia.ts` 中保留了多个本地辅助函数（`basename`、`wslHomeToUnc` 等）。Phase 5 会把这些抽到 `src/lib/` 下，但当前实现与原版完全一致，不影响功能。

## 下一步

进入 Phase 4：拆分 god component。
