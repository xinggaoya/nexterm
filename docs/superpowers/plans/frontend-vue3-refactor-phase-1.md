# Nexterm 前端重构 Phase 1 — 基础设施落地

## 范围

按 `local://nexterm-frontend-vue3-refactor.md` 计划，本阶段在零运行时风险的前提下铺设三道边界测试与少量公共工具，作为后续 Phase 2-6 的安全网。

## 关键变更点

### 新增

| 文件 | 角色 |
| --- | --- |
| `src/lib/nativeBoundary.test.ts` | 阻止非 `src/lib/native.ts` 直接 import `invoke`/`Channel` from `@tauri-apps/api/core` |
| `src/lib/eventBoundary.test.ts` | 阻止非 `src/lib/native.ts` 直接 import `listen`/`emit` from `@tauri-apps/api/event` |
| `src/modules/pinia/setupStoreBoundary.test.ts` | 禁止新增 Options-form Pinia store（`defineStore("name", { state, actions })`） |
| `src/lib/emptyObject.ts` | 暴露 `EMPTY_OBJECT`（frozen `Record<string, never>`），供偏好 store / 默认值复用 |
| `src/lib/types.ts` | 共享类型：`Translate`（`t` 函数签名）、`MaybeRef<T>` |

### 改动

无运行时代码改动。仓库其余 `*.test.ts` 与 `*.ts` 保持原状。

## 边界测试契约

### `nativeBoundary.test.ts`

扫描 `src/` 全部 `.ts`/`.tsx`/`.vue`，匹配以下任一模式即视为越界：

```ts
import { invoke, ... } from "@tauri-apps/api/core";
import { Channel, ... } from "@tauri-apps/api/core";
import "..." from "@tauri-apps/api/core";
```

白名单（v1，Phase 2 起会逐步收紧）：

- `src/lib/native.ts`（唯一运行时出口）
- `src/lib/native.test.ts`（mock）
- `src/lib/launchDir.ts`（待 Phase 2 迁移）
- `src/modules/editor/lib/documentService.ts`（待 Phase 2 迁移）
- `src/modules/explorer/lib/fileTreeService.ts`（待 Phase 2 迁移）
- `src/modules/markdown/lib/markdownDocumentService.ts`（待 Phase 2 迁移）
- `src/modules/terminal/lib/pty-bridge.ts`（待 Phase 2 迁移）
- `src/modules/workspace/workspaceEnvPinia.ts`（待 Phase 2 迁移）
- `src/modules/workspace/workspaceNative.ts`（待 Phase 2 迁移）
- 以及上述文件对应的 `*.test.ts`

### `eventBoundary.test.ts`

扫描规则相同；白名单（v1）：

- `src/lib/native.ts`
- `src/lib/native.test.ts`
- `src/modules/settings/store.ts`（持久化层；待后续 phase 改造）
- `src/app/useWorkspaceLifecycle.ts`（Phase 6 改走 `native.onWorkspaceFsChanged`）
- `src/app/components/UnsavedCloseGuard.vue`（仅 `import type UnlistenFn`；Phase 6 收敛）

### `setupStoreBoundary.test.ts`

- 文件名匹配 `/Pinia\.ts$` 或 `/use[A-Z][A-Za-z0-9]*PiniaStore\.ts$/`
- 源码出现 `state: ...` / `actions: {` / `getters: {` 任一关键字即视为 Options-form
- 容忍名单（v1，Phase 3 起逐步迁移）：
  - `src/modules/settings/preferencesPinia.ts`
  - `src/modules/tabs/tabsPinia.ts`
  - `src/modules/workspace/workspaceEnvPinia.ts`
  - `src/modules/workspace/workspaceRootPinia.ts`
- 第二条用例固定容忍名单内容，防止列表漂移

## 验证结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm exec vitest run` 三道新边界测试 | 通过 |
| `pnpm test` 全量（367/369） | 通过（2 个预存在失败与本阶段无关：`FileExplorer.vue > renders git tones for changed files and parent folders`、`SourceControlPanel.vue > runs fetch pull and push operations then refreshes status`） |
| `pnpm build` | 通过 |
| `pnpm exec tsc --noEmit` | 失败（与本阶段无关：仓库 `tsconfig.json` 未配置 `vue` 模块声明，全量 `vue-tsc` 才会解析） |

> 复现：在 `main` 分支 HEAD 同样跑 `pnpm test` 与 `pnpm exec tsc --noEmit` 可观察到完全相同的 2 个失败与 `.vue` 找不到错误，本阶段未引入新违规。

## 风险与遗留

- 容忍名单仍包含 4 个 Options-form store 与 6 个直接 IPC 调用方。Phase 2/3 的核心工作就是把这些条目从白名单里删掉。
- `eventBoundary.test.ts` 白名单中的 `useWorkspaceLifecycle.ts` 实际只用了 `listen as tauriListen`；Phase 6 改写为 `native.onWorkspaceFsChanged` 后移除条目。
- `tsconfig.json` 缺 `.vue` 模块声明是一个独立的工具链问题，建议另行排期修复（不在本次重构范围）。

## 下一步

进入 Phase 2：把 `documentService` / `fileTreeService` / `markdownDocumentService` / `pty-bridge` / `workspaceNative` / `workspaceEnvPinia` 全部改用 `native.*`，并把它们的条目从 `nativeBoundary.test.ts` 白名单中移除。
