# 壳层布局重设计 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 移除 Nexterm 常驻左侧栏，把工作区切换器与停靠面板控制簇并入顶栏，使画布拿到更多像素。

**Architecture:** 壳层从「左栏 + 顶栏 + 右侧面板」三列改为「单条顶栏 + 画布 | 停靠面板」两列。新建 `WorkspaceSwitcher.vue` 承接原 `Sidebar.vue` 的工作区列表能力（弹出式），`TopBar.vue` 新增面板控制簇，`WorkspacePanel.vue` 去掉独立头部。新增偏好 `workspacePanelVisible` 持久化面板显隐。

**Tech Stack:** Vue 3 `<script setup>` + Naive UI（`NPopover` / `NDropdown`）+ Tailwind v4 + Pinia + Vitest。

**Spec:** `docs/superpowers/specs/2026-11-05-shell-layout-redesign.md`

## Global Constraints

- 所有 Tauri 调用必须走 `@/lib/native`；本次改动**不新增任何 IPC**。
- 新增偏好 = `Preferences` 加字段 + `DEFAULT_PREFERENCES` 加默认值 + `PREF_SPECS` 加一行（`store.ts`），并在 `preferencesPinia.ts` 加具名包装。
- i18n 新增/删除 key 必须中英双语同步（`localeParity.test.ts` 强制 key 集合相等）。
- 指针拖拽手势必须走 `usePointerDragReorder`，禁止手写副本（`pointerDragBoundary.test.ts` 静态扫描）。
- 命令 id 必须同步登记在 `src/modules/commands/types.ts` 的 `CommandId` 联合类型中。
- 注释与提交信息用中文，技术名保留英文。

## Review Focus

- 面板折叠状态下执行 `panel.explorer.toggle` / `panel.sourceControl.toggle`：面板必须被展开，否则用户看不到任何变化。
- 覆盖层模式（< 640px）下点折叠按钮：只切浮层开关，不得改写持久化偏好，否则用户在大窗口下会看到面板莫名消失。
- 从工作区弹出层里拖拽排序后落手：不能顺带触发「切换工作区」（`consumeSuppressedClick` 必须生效）。
- 弹出层在只有一个工作区时：拖拽不应启动（`enabled: () => workspaces.length > 1`）。
- 顶栏拖拽区：按在工作区切换器按钮上不应触发窗口拖动。
- 窄窗（< 900px）下顶栏必须仍能露出动作按钮（新建终端 / 分屏 / 命令中心 / 设置），不能被身份区挤出可视区。

---

### Task 1: 偏好层 —— 面板显隐偏好

**Files:**
- Modify: `src/modules/settings/store.ts`（`Preferences` / `DEFAULT_PREFERENCES` / `PREF_SPECS`）
- Modify: `src/modules/settings/preferencesPinia.ts`
- Test: `src/modules/settings/store.test.ts`

**Interfaces:**
- Produces: `Preferences["workspacePanelVisible"]: boolean`（默认 `true`）、`prefs.updateWorkspacePanelVisible(value: boolean): void`；移除 `Preferences["sidebarCollapsed"]` 与 `prefs.updateSidebarCollapsed`。

- [ ] **Step 1: 写失败测试** — 在 `store.test.ts` 断言 `DEFAULT_PREFERENCES.workspacePanelVisible === true`，且 `PREF_SPECS` 键集与 `DEFAULT_PREFERENCES` 键集仍相等（既有不变量用例自动覆盖删掉的 `sidebarCollapsed`）。
- [ ] **Step 2: 跑测试确认失败** — `pnpm test src/modules/settings/store.test.ts`，预期 `workspacePanelVisible` 未定义失败。
- [ ] **Step 3: 实现** — `store.ts` 三处按 Global Constraints 增删；`preferencesPinia.ts` 删除 `updateSidebarCollapsed` 及其导出，新增 `updateWorkspacePanelVisible` 及其导出。
- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令，预期 PASS。
- [ ] **Step 5: 提交** — `git commit -m "feat(settings): 新增工作区面板显隐偏好，移除侧栏折叠偏好"`

---

### Task 2: WorkspaceSwitcher 组件

**Files:**
- Create: `src/app/shell/WorkspaceSwitcher.vue`
- Create: `src/app/shell/WorkspaceSwitcher.vue.test.ts`

**Interfaces:**
- Consumes: `WorkspaceInstance`（`@/modules/workspace`）、`usePointerDragReorder`、`useWorkspaceEnvPiniaStore`。
- Produces:
  ```ts
  props: {
    workspaces: WorkspaceInstance[];
    activeWorkspaceId: string | null;
  }
  emits: {
    "select-workspace": [id: string];
    "close-workspace": [id: string];
    "add-workspace": [env: WorkspaceEnv];
    "open-workspace-in-new-window": [id: string];
    "reorder-workspace": [sourceId: string, targetId: string, placement: DragPlacement];
  }
  ```
  DOM 契约：`[data-workspace-switcher]`（触发按钮）、`[data-workspace-popover]`（浮层）、`[data-workspace-row]`（行）、`[data-add-workspace]`（添加入口）。

- [ ] **Step 1: 写失败测试** — `WorkspaceSwitcher.vue.test.ts` 覆盖：渲染当前工作区名与 monogram；点击行 emit `select-workspace`；右键菜单选「在新窗口中打开」emit `open-workspace-in-new-window`；选「关闭工作区」emit `close-workspace`；`data-add-workspace` 下拉选 local emit `add-workspace(LOCAL_WORKSPACE)`；拖拽重排 emit `reorder-workspace`。
- [ ] **Step 2: 跑测试确认失败** — `pnpm test src/app/shell/WorkspaceSwitcher.vue.test.ts`，预期因组件不存在而失败。
- [ ] **Step 3: 实现组件** — 从 `Sidebar.vue` 迁移：monogram 色板（`MONOGRAM_HUES` + `hueOf` + `monogramStyle` + `monogramOf`）、`envBadgeOf` / `envIconOf` / `rowTitle`、添加菜单（`addMenuOptions` / `handleAddSelect`）、拖拽重排（`usePointerDragReorder`，selector `[data-workspace-row]`）、行右键菜单。触发按钮用 `NPopover` 承载浮层；浮层底部放 `data-add-workspace` 下拉。挂载时 `watch(() => IS_WINDOWS && hasTauriInternals(), ...)` 刷新 WSL distro（迁移 `Sidebar.vue` 的副作用）。
- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令，预期 PASS。
- [ ] **Step 5: 提交** — `git commit -m "feat(shell): 新增顶栏工作区切换器组件"`

---

### Task 3: TopBar —— 接入切换器与面板控制簇

**Files:**
- Modify: `src/app/shell/TopBar.vue`
- Create: `src/app/shell/TopBar.vue.test.ts`

**Interfaces:**
- Consumes: `WorkspaceSwitcher`（Task 2）、`WorkspacePanelTab`（`@/modules/settings/store`）。
- Produces:
  ```ts
  props: {
    /* 既有 */ workspaceName, workspacePath, env, gitBranch, showWindowControls, canSplit, compact?, dense?;
    /* 新增 */ workspaces: WorkspaceInstance[];
    activeWorkspaceId: string | null;
    panelTab: WorkspacePanelTab;
    panelVisible: boolean;
  }
  emits: {
    /* 既有 */ "new-terminal", "split-pane", "open-command-palette", "open-settings";
    /* 新增 */ "select-workspace": [id: string];
    "close-workspace": [id: string];
    "add-workspace": [env: WorkspaceEnv];
    "open-workspace-in-new-window": [id: string];
    "reorder-workspace": [sourceId: string, targetId: string, placement: DragPlacement];
    "update:panel-tab": [tab: WorkspacePanelTab];
    "toggle-panel": [];
  }
  ```
  DOM 契约：`[data-panel-tab-switch]`（分段控件容器）、`[data-panel-tab="explorer"|"changes"]`、`[data-toggle-panel]`（折叠按钮）。

- [ ] **Step 1: 写失败测试** — `TopBar.vue.test.ts` 断言：`data-panel-tab-switch` 存在；点 `[data-panel-tab="changes"]` emit `update:panel-tab("changes")`；点 `[data-toggle-panel]` emit `toggle-panel`；`aria-pressed` 反映 `panelTab` / `panelVisible`；`[data-workspace-switcher]` 存在。
- [ ] **Step 2: 跑测试确认失败** — `pnpm test src/app/shell/TopBar.vue.test.ts`，预期失败。
- [ ] **Step 3: 实现** — 顶栏左端渲染 `<WorkspaceSwitcher>` 并透传 props/emits；右侧动作区**之前**插入面板控制簇：图标分段控件（`FolderOpenOutline` / `GitBranchOutline`，各自包 `TooltipTitle`）+ 折叠按钮（`ChevronBackOutline` / `ChevronForwardOutline`，方向随 `panelVisible` 翻转）。在 `handleRootPointerDown` 里跳过 `[data-no-drag]` 子树，避免按在切换器上时拖动窗口。
- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令，预期 PASS。
- [ ] **Step 5: 提交** — `git commit -m "feat(shell): 顶栏接入工作区切换器与面板控制簇"`

---

### Task 4: WorkspacePanel —— 去掉独立头部

**Files:**
- Modify: `src/app/shell/WorkspacePanel.vue`
- Modify: `src/app/shell/WorkspacePanel.vue.test.ts`

**Interfaces:**
- Consumes: 无新依赖。
- Produces: props 去掉 `tab`；emits 去掉 `update:tab`。面板根元素保留 `data-workspace-panel` / `data-workspace-panel-right`，但**不再包含任何头部**。

- [ ] **Step 1: 写失败测试** — 更新 `WorkspacePanel.vue.test.ts`：删除「面板头部有 `data-panel-tab` 两个标签」的断言；改为断言面板根元素下**不存在** `data-panel-tab` 与 `data-panel-branch`；保留 FileExplorer / SourceControlPanel 转发与左缘 resizer 用例。
- [ ] **Step 2: 跑测试确认失败** — `pnpm test src/app/shell/WorkspacePanel.vue.test.ts`，预期头部断言失败。
- [ ] **Step 3: 实现** — 删掉 `<header>` 整块（含 tabs 切换、分支徽标）、`tabs` computed、`selectTab`、`tab` prop、`update:tab` emit、`GitBranchOutline`/`NIcon` 引用。内容层（`relative min-h-0 flex-1`）直接作为 aside 的唯一子级。
- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令，预期 PASS。
- [ ] **Step 5: 提交** — `git commit -m "refactor(shell): 停靠面板去掉独立头部，标签组并入顶栏"`

---

### Task 5: 删除 Sidebar 并重新接线 WorkspaceHost

**Files:**
- Delete: `src/app/shell/Sidebar.vue`、`src/app/shell/Sidebar.vue.test.ts`
- Modify: `src/app/shell/WorkspaceHost.vue`
- Modify: `src/app/shell/WorkspaceHost.vue.test.ts`
- Modify: `src/lib/pointerDragBoundary.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `WorkspaceSwitcher`、Task 3 的 `TopBar` 新 props/emits、Task 4 的无头 `WorkspacePanel`。
- Produces: `WorkspaceHost` 模板结构变为 `TopBar`（含切换器）→ `Canvas` + `WorkspacePanel` → `StatusDock`。

- [ ] **Step 1: 写失败测试** — 改 `WorkspaceHost.vue.test.ts`：把 `vi.mock("./Sidebar.vue")` 换成 `vi.mock("./WorkspaceSwitcher.vue")`；用例「切换器的 close-workspace 上抛为 request-remove-workspace」改由 `WorkspaceSwitcherStub` 触发；新增用例：面板折叠时 `WorkspacePanel` 不渲染内容（`v-if` 收起）。
- [ ] **Step 2: 跑测试确认失败** — `pnpm test src/app/shell/WorkspaceHost.vue.test.ts`，预期失败。
- [ ] **Step 3: 实现** — 删除 `Sidebar.vue` 与其测试；从 `WorkspaceHost.vue` 移除 `Sidebar` import / 模板挂载、`SIDEBAR_EXPANDED_WIDTH`、`SIDEBAR_RAIL_WIDTH`、`sidebarOverride`、`sidebarCollapsed`、`handleSidebarToggle`、`toggleSidebarCollapsed`、`sidebarWidth` 及相关 watch；把工作区相关 props/emits 接到 `TopBar` 上；`WorkspacePanel` 改为 `v-if="panelVisible"`（保留 `ref` 与 `defineExpose` 的 `activate` / `flushPendingTreeRefresh` / `openFindInFiles` 调用路径 —— 用 `v-show` 保留挂载更稳妥，见 Step 3 备注）。
- [ ] **Step 3: 跑测试确认通过** — 同 Step 2 命令，预期 PASS。
- [ ] **Step 4: 同步指针拖拽白名单** — `pointerDragBoundary.test.ts` 的 consumers 列表把 `"app/shell/Sidebar.vue"` 换成 `"app/shell/WorkspaceSwitcher.vue"`；`pnpm test src/lib/pointerDragBoundary.test.ts` 预期 PASS。
- [ ] **Step 5: 提交** — `git commit -m "refactor(shell): 移除常驻左侧栏，工作区切换并入顶栏"`

---

### Task 6: 响应式重整与面板显隐接线

**Files:**
- Modify: `src/app/useResponsiveLayout.ts`
- Modify: `src/app/shell/WorkspaceHost.vue`
- Modify: `src/app/useResponsiveLayout.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `prefs.workspacePanelVisible`。
- Produces: `WorkspaceHost` 新增 `panelVisible`（= 偏好与覆盖层开合的合取）、`togglePanelVisibility()`；`effectivePanelWidth` 的 `available` 改为容器宽。

- [ ] **Step 1: 写失败测试** — `useResponsiveLayout.test.ts`：新增「`available` 即容器宽时面板按 45% 收窄」的用例（传 `available = 800`，期望 `min(requested, 360)`）；更新既有对 `available` 减侧栏宽的断言。
- [ ] **Step 2: 跑测试确认失败** — `pnpm test src/app/useResponsiveLayout.test.ts`，预期失败。
- [ ] **Step 3: 实现** —
  - `useResponsiveLayout.ts`：`RESPONSIVE_BREAKPOINTS` 数值不变（900/760/640），但 `compact` 的注释语义改为「顶栏紧凑」；`resolveResponsivePanelWidth` 的 `available` 语义改为「容器宽」，实现不变（仅注释与调用方）。
  - `WorkspaceHost.vue`：`effectivePanelWidth` 去掉 `- sidebarWidth.value`；新增 `panelVisible = computed(() => prefs.workspacePanelVisible && (!panelOverlay.value || panelOverlayOpen.value))`；新增 `togglePanelVisibility()`：`panelOverlay` 模式只切 `panelOverlayOpen`，否则切 `prefs.workspacePanelVisible` 并持久化；`TopBar` 的 `:compact` 传 `responsive.narrow.value`、`:dense` 传 `responsive.compact.value`（分支名在 900px 以下隐藏）。
- [ ] **Step 4: 跑测试确认通过** — 同 Step 2 命令，预期 PASS。
- [ ] **Step 5: 提交** — `git commit -m "feat(shell): 面板显隐可持久化并重整响应式断点语义"`

---

### Task 7: 命令语义统一

**Files:**
- Modify: `src/app/useWorkbenchCommands.ts`
- Modify: `src/app/shell/WorkspaceHost.vue`
- Test: `src/app/useWorkbenchCommands.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `togglePanelVisibility()` / `panelVisible`。
- Produces: `panel.explorer.toggle` 与 `panel.sourceControl.toggle` 在切标签时会确保面板可见。

- [ ] **Step 1: 写失败测试** — `useWorkbenchCommands.test.ts` 新增用例：面板不可见时执行 `panel.explorer.toggle`，期望调用「确保面板可见」的回调。
- [ ] **Step 2: 跑测试确认失败** — 预期失败。
- [ ] **Step 3: 实现** — `useWorkbenchCommands` options 增加 `ensurePanelVisible?: () => void`；`panel.explorer.toggle` / `panel.sourceControl.toggle` 的实现里在切 tab 前调用它。`WorkspaceHost` 传入 `ensurePanelVisible: () => { if (!panelVisible.value) togglePanelVisibility(); }`。
- [ ] **Step 4: 跑测试确认通过** — 预期 PASS。
- [ ] **Step 5: 提交** — `git commit -m "fix(shell): 面板命令在折叠状态下确保面板可见"`

---

### Task 8: i18n

**Files:**
- Modify: `src/modules/i18n/locales/zh-CN.ts`
- Modify: `src/modules/i18n/locales/en-US.ts`

**Interfaces:**
- Produces: `app.titleBar.switchWorkspace`、`app.titleBar.panelShow`、`app.titleBar.panelHide`（中英同 key）；删除 `app.sidebar.search` / `app.sidebar.collapse` / `app.sidebar.expand`。

- [ ] **Step 1: 写失败测试** — 依赖既有 `localeParity.test.ts`（key 集合相等 + `t()` 调用可解析）。
- [ ] **Step 2: 实现** — 两份 locale 同步增删；确认 `t("app.sidebar...")` 在 `src/` 下已无引用（`Sidebar.vue` 删除后成立）。
- [ ] **Step 3: 跑测试确认通过** — `pnpm test src/modules/i18n` 预期 PASS。
- [ ] **Step 4: 提交** — `git commit -m "refactor(i18n): 清理侧栏文案，新增顶栏工作区与面板文案"`

---

### Task 9: 视觉系统契约测试同步

**Files:**
- Modify: `src/styles/visualSystem.test.ts`

**Interfaces:**
- Produces: 壳层尺寸契约改写为新骨架。

- [ ] **Step 1: 改写断言** — 删除 `Sidebar.vue` 的 `w-[248px]` / `w-[52px]` / `data-sidebar` / `data-sidebar-search` 断言；新增：顶栏 `h-11`、状态坞 `h-6`、会话条 `h-7` 保持；`WorkspacePanel.vue` **不含** `data-panel-tab` / `data-panel-branch`（头部已并入顶栏）且仍含 `data-workspace-panel-right` 与左缘 resizer；`TopBar.vue` 含 `data-panel-tab-switch`；`WorkspaceHost.vue` 的组合顺序改为 `<TopBar ... <SessionStrip` 与 `<Canvas ... <WorkspacePanel ... <StatusDock`。
- [ ] **Step 2: 跑测试确认通过** — `pnpm test src/styles/visualSystem.test.ts` 预期 PASS。
- [ ] **Step 3: 提交** — `git commit -m "test: 同步视觉系统契约到新壳层骨架"`

---

### Task 10: 架构文档同步

**Files:**
- Modify: `docs/architecture/01-overview.md`
- Modify: `docs/architecture/overview.md`

- [ ] **Step 1: 更新 ASCII 架构图** — `01-overview.md` 的 `MainApp.vue -> WorkspaceHost(Sidebar + TopBar/SessionStrip + WorkspacePanel + Canvas + StatusDock)` 改为新骨架。
- [ ] **Step 2: 更新响应式章节** — `01-overview.md` §4.1.1 断点表按新语义重写（compact → 顶栏紧凑）。
- [ ] **Step 3: 更新 Mermaid 图** — `overview.md` 中 `Sidebar 全局侧栏(可折叠轨道)` 节点替换为 `WorkspaceSwitcher 工作区切换器`。
- [ ] **Step 4: 提交** — `git commit -m "docs: 同步壳层布局架构文档"`

---

### Task 11: 全量验证

**Files:** 无改动。

- [ ] **Step 1: 跑全部前端测试** — `pnpm test`，预期全部 PASS。
- [ ] **Step 2: 类型检查** — `pnpm exec vue-tsc --noEmit`，预期无错误。
- [ ] **Step 3: 构建** — `pnpm build`，预期成功。
- [ ] **Step 4: Rust 侧** — `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`，本次无 Rust 改动，预期无新告警。
- [ ] **Step 5: 提交** — 无需提交（若上一步有格式化产物则单独提交）。
