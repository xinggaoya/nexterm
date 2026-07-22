# Shell 布局重构设计

- 日期：2026-07-22
- 状态：已批准
- 关联重构：多工作区支持已落地（commit `0ead5b3`），但 shell 层布局遗留冗余 UI 与不一致

## 1. 背景与目标

最近一次多工作区重构（`feat(workspace): 单窗口内多工作区彻底重构`）让 Nexterm 支持在单窗口内打开多个 workspace，且每个 workspace 独立持有：

- 工作区环境（Local / WSL distro）
- Tab 列表与活动 Tab
- Terminal sessions
- FS watcher
- Task console
- Native API 表面（`createNativeForEnv`）

但 shell 层布局并未跟随重构：

1. `StatusBar` 中的 `WorkspaceEnvSelector` 表达的是"添加工作区所用的 pending env"，不是"当前 workspace 的 env"，对当前活动 workspace 没有实际意义。
2. `StatusBar` 中显示完整 workspace root 路径与终端 cwd；这些信息已经在 Tab 标题（cwd basename）和面包屑中冗余表达。
3. `MainApp` 中 `workspaceOpenChoice` 模态（"当前窗口 / 新窗口"）打断了添加工作区流程，且新窗口场景实际使用频率低。
4. `WorkspaceBar` 是 TitleBar 下一条独立的水平条，没有与 TitleBar 形成层级关系；UI 上显得割裂。
5. `TabBar` 当前是 WorkspaceHost 内的固定顶部条，宽度覆盖整 Workbench（包括未来要做的左右侧栏）；tab 视觉上挤压了主内容。
6. `ActivityBar.vue` 已存在但未接入；Source Control 仍然作为 Workbench 内左 split 面板。

本次重构的目标：

- 清理多工作区遗留的冗余 UI（环境切换器、路径显示、当前/新窗口询问）
- 把面板开关收口到底部 StatusBar 的右侧图标组
- 把工作区列表集成到 TitleBar 中央，作为 app-level 的顶级导航
- 把 Activity Panel（Workspace / Source Control 多区域切换）做成左侧可拉伸侧栏
- 让 TabBar 仅覆盖中央 Workbench 顶部，不再越过左右侧栏
- 保留所有现有行为（workspace 切换 v-show 保活、PTY session 不销毁、tabs 按 workspace 隔离等）

## 2. 整体布局

```
┌──────────────────────────────────────────────────────────────────────┐
│ TitleBar                                                              │
│ ┌──┬──────────────────────────────────────────────┬────────────────┐ │
│ │📦│ WS-A │ WS-B │ + ↗          │           │ ⚙ ⚡ ⌘           │ │
│ └──┴──────────────────────────────────────────────┴────────────────┘ │
├──────┬───────────────────────────────────────────────────────────────┤
│  +   │  Tab1 │ Tab2 │ Tab3 │ + │ ⌘                                  │
│  ↗   ├───────────────────────────────────────────────────────┬───────┤
│ ───  │                                                       │       │
│  ▣   │           Terminal / Editor / Preview                  │  Exp  │
│  ⌥   │              (中央 Workbench)                          │       │
│      │                                                       │       │
│      │                                                       │       │
│      │                                                       │       │
│      ├───────────────────────────────────────────────────────┤       │
│      │           Task Console (可折叠)                        │       │
├──────┴───────────────────────────────────────────────────────┴───────┤
│ proj-A · main         [▣] [⌥] [▤] [↕]                                 │
└──────────────────────────────────────────────────────────────────────┘
```

### 层级定义

| 层级 | 角色 | 文件 |
|------|------|------|
| 1 | TitleBar（含内嵌 WorkspaceBar） | `TitleBar.vue`、`WorkspaceBar.vue` 内联 |
| 2 | 左侧 Activity Panel（图标 + 内容区） | 新增 `LeftSidebar.vue`、`ActivityIcons.vue` |
| 3 | 中央 Workbench：TabBar（顶）+ 主内容 + TaskConsole（底） | `WorkspaceHost.vue`、`TabBar.vue`、`Workbench.vue` |
| 4 | 右侧 Explorer（Activity Content 中选中 Explorer 时显示） | 由 ActivityContent 控制 |
| 5 | 底部 StatusBar（极简左右两栏） | `StatusBar.vue` |

## 3. 变更详情

### 3.1 StatusBar 改造（极简左右两栏）

**移除：**
- `WorkspaceEnvSelector` 实例
- `workspaceRoot` 完整路径显示
- `terminalCwd` 显示
- `workspaceSwitching` / `switchingWorkspaceEnv` / `workspaceChange`（这些只在添加工作区流程中使用，已从 MainApp 移除）
- 当前 props：`workspaceRoot: string | null`、`terminalCwd: string | null`、`workspaceSwitching?: boolean`、`switchingWorkspaceEnv?: WorkspaceEnv | null`、`workspaceChange` 事件

**保留并重构：**
- 左侧：一行面包屑 `<workspace.name> · <git branch>`
- 右侧：四个图标按钮（顺序固定）：
  - `▣` Source Control 面板（toggle）
  - `⌥` Explorer 面板（toggle）
  - `▤` Workspace 列表（toggle）
  - `↕` Task Console（toggle）

**新增 props：**
- `workspaceName: string | null`
- `gitBranch: string | null`
- `panelStates: { workspace: boolean; sourceControl: boolean; explorer: boolean; taskConsole: boolean }`

**新增事件：**
- `toggle-panel: [key: "workspace" | "sourceControl" | "explorer" | "taskConsole"]`

**对应文件：**
- `src/app/shell/StatusBar.vue`（重写）
- `src/modules/i18n/locales/{zh-CN,en-US}/app.json`（新增 `app.status.toggle.*`、`app.status.crumb`，移除 `app.status.noWorkspace`）

### 3.2 TitleBar 集成 WorkspaceBar

**当前：** `WorkspaceBar.vue` 是 TitleBar 下方的独立水平条

**目标：** 把 WorkspaceBar 合并到 TitleBar 中央作为内嵌横向条目

**TitleBar 三段式：**
```
┌────────────────────────────────────────────────────────────────┐
│ Logo │      WorkspaceBar（中央条目）        │  Actions（右侧） │
└────────────────────────────────────────────────────────────────┘
```

**WorkspaceBar 内容：**
- 每个 workspace 一个 tab-style 条目（高亮当前活动项）
- 条目右侧 `×` 关闭按钮
- 末尾 `+` 按钮：点击 → 在当前窗口添加 workspace（流程：弹出 env 下拉 → 选目录）
- 末尾 `↗` 按钮：点击 → 直接弹出 env 下拉 → 选目录 → 在新窗口打开
- 工作区列表超出可视宽度时横向滚动

**TitleBar 接口变更：**
- 新增 props：`workspaces`、`activeWorkspaceId`
- 新增事件：`addWorkspace`、`openWorkspaceInNewWindow`、`selectWorkspace`、`closeWorkspace`

**TitleBar 移除：**
- `openFolderOptions` 下拉按钮组（Local / WSL 各 distro）
- `chooseWorkspace` / `chooseWorkspaceInEnv` 事件
- `WorkspaceEnvSelector` 实例

**对应文件：**
- `src/app/shell/TitleBar.vue`（重构）
- `src/app/shell/WorkspaceBar.vue`（变为 TitleBar 子组件或保留独立组件被 TitleBar 调用）

### 3.3 左侧 Activity Panel

**当前：** `ActivityBar.vue` 已存在但未接入；Source Control 直接作为 Workbench 内左 split 面板

**目标：** 新建 `LeftSidebar.vue` 作为多区域左侧栏容器

**结构：**

```
LeftSidebar (flex row, 可拉伸)
├── ActivityIcons (48px 宽，纵向图标)
│   ├── + (添加 workspace，hover dropdown 选择 env)
│   ├── ↗ (新窗口打开)
│   ├── separator
│   ├── ▣ Source Control
│   ├── ⌥ Workspace 列表
│   ├── (未来可扩展 Git History 等)
│   └── 折叠/展开按钮
└── ActivityContent (剩余宽度，~240-360px，可拖拽)
    ├── 选中 Workspace → WorkspaceBar 内容（与 TitleBar 同步）
    ├── 选中 Source Control → SourceControlPanel
    └── 默认 → SourceControlPanel
```

**变更点：**
- 新建 `src/app/shell/LeftSidebar.vue`
- 新建 `src/app/shell/ActivityIcons.vue`
- 新建 composable `src/app/useLeftSidebar.ts`：管理活动项 state、面板显隐 state、宽度持久化
- Source Control 面板从 Workbench 内移到 ActivityContent 中
- Workbench 移除内嵌 Source Control split

**持久化：**
- `panelStates` 写入 preferences（key：`layout.leftSidebar.activity`、`layout.leftSidebar.width`）

### 3.4 TabBar 简化 + 不再满宽

**当前：** TabBar 是 `WorkspaceHost` 内的固定顶部条，宽度覆盖整 Workbench

**目标：** TabBar 仅覆盖中央 Workbench 顶部；接口简化，不再接收 `workspaceRoot`

**WorkspaceHost 布局变化：**

```vue
<div class="flex min-h-0 flex-1">
  <LeftSidebar />              <!-- 新增 -->
  <div class="flex min-w-0 flex-1 flex-col">
    <TabBar />                 <!-- 仅中央顶部 -->
    <main class="flex min-h-0 flex-1">
      <Workbench />            <!-- 中央 Workbench + Explorer -->
    </main>
  </div>
</div>
```

**TabBar 接口调整：**
- 移除 prop：`workspaceRoot`
- 移除 emit：`copyPath`、`copyRelativePath`、`moveToNewWindow`
- 这些动作保留在 `TabContextMenu.vue`，由 `TabContextMenu` 通过 `inject(workspaceContextKey)` 自行获取

**对应文件：**
- `src/app/shell/TabBar.vue`（简化 prop）
- `src/app/shell/TabContextMenu.vue`（workspaceContext 注入）
- `src/app/shell/WorkspaceHost.vue`（重构）
- `src/app/workspaceContext.ts`（扩展）

### 3.5 移除"当前窗口/新窗口"询问弹窗

**移除：**
- `MainApp.vue` 中的 `workspaceOpenChoice` ref
- `MainApp.vue` 中的 `NModal`（`app.workspaceOpen.*`）
- `openSelectedWorkspaceInCurrentWindow` / `openSelectedWorkspaceInNewWindow` 方法
- 新窗口打开路径改为 `WorkspaceBar.↗` 按钮触发：弹 env 下拉 → 选目录 → `openWorkspaceInNewWindow()`
- `addWorkspace(path, env)` 始终在当前窗口工作

**保留：**
- `src/modules/workspace/workspaceWindow.ts`（用于 `↗` 按钮）

### 3.6 TitleBar 中的环境入口清理

**当前 TitleBar 含：**
- `openFolderOptions` 下拉按钮组（Local / WSL 各 distro）
- `chooseWorkspace` / `chooseWorkspaceInEnv` 事件
- `WorkspaceEnvSelector` 实例（在左侧或中间）

**简化：**
- TitleBar 移除"openFolder"下拉按钮组
- 添加 workspace 入口统一为：`TitleBar 中央 WorkspaceBar.+/↗`、`LeftSidebar.+/↗`（两个位置等价入口）
- 移除 TitleBar 中的 `WorkspaceEnvSelector`

## 4. 状态与持久化变更

### 4.1 `useWorkbenchLayout` 扩展

新增：

```ts
type ActivityKey = "workspace" | "sourceControl";
type PanelKey = "workspace" | "sourceControl" | "explorer" | "taskConsole";

interface LeftSidebarState {
  activity: ActivityKey;
  open: boolean;
  width: number; // px
}

interface PanelVisibilityState {
  workspace: boolean;
  sourceControl: boolean;
  explorer: boolean;
  taskConsole: boolean;
}
```

API：

```ts
return {
  leftSidebar: Ref<LeftSidebarState>;
  panelVisibility: Ref<PanelVisibilityState>;
  setLeftSidebarActivity: (key: ActivityKey) => void;
  toggleLeftSidebar: () => void;
  setLeftSidebarWidth: (w: number) => void;
  togglePanel: (key: PanelKey) => void;
  // 兼容旧 API
  toggleLeftPanel,    // 转发到 togglePanel("sourceControl")
  toggleRightPanel,   // 转发到 togglePanel("explorer")
  leftPanelOpen,      // 派生 panelVisibility.sourceControl
  rightPanelOpen,     // 派生 panelVisibility.explorer
  // ...
};
```

### 4.2 持久化 keys

`src/modules/settings/store.ts` 新增：

```ts
KEY_LAYOUT_LEFT_SIDEBAR = "layout.leftSidebar";
KEY_LAYOUT_PANELS = "layout.panels";
```

Preferences 中：

```ts
interface LeftSidebarPref {
  activity: "workspace" | "sourceControl";
  open: boolean;
  width: number;
}

interface PanelVisibilityPref {
  workspace: boolean;
  sourceControl: boolean;
  explorer: boolean;
  taskConsole: boolean;
}
```

### 4.3 WorkspaceEnv Pinia

- `pendingEnv` 仍由 WorkspaceEnvPiniaStore 维护，作为添加 workspace 时选择的 env
- 不再由 StatusBar 显示；只在 TitleBar `+/↗` / LeftSidebar `+/↗` 的 dropdown 中使用

## 5. i18n 变更

### 移除 key

- `app.status.noWorkspace`
- `app.workspaceOpen.title`
- `app.workspaceOpen.currentWindow`
- `app.workspaceOpen.newWindow`
- `app.header.openFolderMenu.openInLocal`
- `app.header.openFolderMenu.openInWsl`

### 新增 key

- `app.titleBar.workspaces`
- `app.leftSidebar.activity.workspace`
- `app.leftSidebar.activity.sourceControl`
- `app.leftSidebar.addWorkspace`
- `app.leftSidebar.openInNewWindow`
- `app.leftSidebar.toggle`
- `app.status.crumb`（模板 `"{workspace} · {branch}"`）
- `app.status.toggle.sourceControl`
- `app.status.toggle.explorer`
- `app.status.toggle.workspace`
- `app.status.toggle.taskConsole`

## 6. 架构边界

- 不破坏 IPC 边界：`native.*` 仍然通过 workspace env 显式传递
- 不破坏模块通信：仅修改 shell 层布局，store / composable 行为不变
- `WorkspaceHost` v-show 常驻策略保留
- `tabsPinia` 按 workspace 隔离保留
- `createNativeForEnv` 每个 workspace 独立保留

## 7. 受影响文件清单

### 新增

- `src/app/shell/LeftSidebar.vue`
- `src/app/shell/ActivityIcons.vue`
- `src/app/useLeftSidebar.ts`

### 修改

- `src/app/MainApp.vue`（移除 `workspaceOpenChoice` 模态；简化 StatusBar props 接线）
- `src/app/shell/TitleBar.vue`（集成 WorkspaceBar；移除 openFolder 下拉；新增 props/emit）
- `src/app/shell/StatusBar.vue`（重写为极简左右两栏）
- `src/app/shell/WorkspaceBar.vue`（保留为独立组件，由 TitleBar 内嵌调用；保留 `+/↗` 按钮）
- `src/app/shell/WorkspaceHost.vue`（重构为左侧栏 + 中央分层）
- `src/app/shell/Workbench.vue`（移除内嵌 Source Control split）
- `src/app/shell/TabBar.vue`（移除 `workspaceRoot` prop 和相关 emit）
- `src/app/shell/TabContextMenu.vue`（workspaceContext 注入；保留 copyPath/copyRelativePath/moveToNewWindow 逻辑）
- `src/app/useWorkbenchLayout.ts`（扩展 panel / activity / leftSidebar state）
- `src/app/workspaceContext.ts`（扩展 key 列表）
- `src/modules/settings/store.ts`（新增 layout 偏好 keys）
- `src/modules/settings/preferencesPinia.ts`（applySnapshot 同步新字段）
- `src/modules/i18n/locales/zh-CN/app.json`
- `src/modules/i18n/locales/en-US/app.json`

### 删除（最终清理时）

- `src/app/components/WorkspaceEnvSelector.vue`（功能内联到 ActivityIcons / WorkspaceBar 的 dropdown 触发器）

## 8. 测试策略

### 更新现有测试

- `src/app/MainApp.vue.test.ts`：移除 `data-open-workspace-current` / `data-open-workspace-new-window` 相关断言；新增 TitleBar 内嵌 WorkspaceBar 渲染断言
- `src/app/shell/StatusBar.vue.test.ts`（如存在）：更新面板按钮断言
- `src/app/shell/TabBar.vue.test.ts`（如存在）：移除 `workspaceRoot` prop 相关断言

### 新增测试

- `src/app/shell/LeftSidebar.vue.test.ts`：activity 切换、collapse/expand
- `src/app/shell/ActivityIcons.vue.test.ts`：图标按钮触发 emit
- `src/app/useLeftSidebar.test.ts`：state 变更 + 持久化

### 现有测试需保持通过

- `src/modules/tabs/tabsPinia.test.ts`（workspace 隔离）
- `src/modules/workspace/workspacesPinia.test.ts`
- `src/modules/source-control/SourceControlPanel.vue.test.ts`（仅当 SourceControl 挂载点迁移后行为不变）

## 9. 验收标准

1. 不存在 `workspaceOpenChoice` 相关代码
2. StatusBar 不显示终端 cwd、不显示完整路径、不含 WorkspaceEnvSelector
3. StatusBar 右侧有 4 个图标按钮（sourceControl / explorer / workspace / taskConsole），可独立 toggle
4. TitleBar 中央横向显示 Workspace 列表（含 `+` 和 `↗` 按钮）
5. 左侧出现独立可拉伸的 Activity Panel，图标可在 Workspace / SourceControl 之间切换内容
6. Workspace 列表在 TitleBar 和 LeftSidebar 中保持同步
7. TabBar 仅覆盖中央 Workbench 顶部，不再接收 `workspaceRoot` prop
8. TabContextMenu 仍能正确复制路径、移动到新窗口（通过 workspaceContext 注入）
9. 所有现有 workspace 切换、tab 切换、PTY session 保活行为不变
10. `pnpm exec tsc --noEmit` 通过
11. `pnpm test` 通过（除已知的 2 个 out-of-scope 失败）
12. `pnpm build` 通过
13. `cargo clippy --all-targets --locked -- -D warnings` 通过

## 10. 实施顺序（高层）

1. 扩展 `useWorkbenchLayout` + `preferencesPinia` + i18n keys（基础设施）
2. 重写 `StatusBar.vue`
3. 重构 `TitleBar.vue` + `WorkspaceBar.vue` 内嵌
4. 创建 `LeftSidebar.vue` + `ActivityIcons.vue` + `useLeftSidebar`
5. 重构 `WorkspaceHost.vue` 布局
6. 简化 `TabBar.vue` + 扩展 `TabContextMenu.vue`
7. 移除 `MainApp.vue` 的 `workspaceOpenChoice` 模态
8. 删除 `WorkspaceEnvSelector.vue`（功能已内联）
9. 跑全量测试 + build + clippy 验证