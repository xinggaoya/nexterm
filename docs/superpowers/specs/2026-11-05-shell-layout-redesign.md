# 壳层布局重设计：取消常驻左栏，工作区切换器并入顶栏

> 日期：2026-11-05 · 状态：已批准 · 实施计划见 `docs/superpowers/plans/2026-11-05-shell-layout-redesign.md`

## 1. 问题

Nexterm 是终端优先的 IDE，但壳层仍按「通用 IDE 三栏」分配空间（1920px 窗口实测）：

| 区域 | 宽度 | 内容密度 |
|---|---|---|
| 左侧栏 `Sidebar.vue` | 248px（可折叠 52px） | 品牌 + 搜索位 + **工作区列表（通常 1–3 个）** + 设置入口 |
| 右侧停靠面板 `WorkspacePanel.vue` | 328px | 文件树 / 更改（**高密度**） |
| 画布 | ~1344px | 终端 + 编辑器（核心工作区） |

三个具体矛盾：

1. **左侧 248px 常年只承载 3 行文字。** 工作区数量天然很少（多数用户 1–3 个），却为此常年占掉整列 —— 这是纯浪费。
2. **信息密度与空间分配倒挂。** 真正需要宽度的文件树被挤在 328px 的右侧，而左侧空列占据 248px。
3. **纵向 chrome 重复。** 顶栏 44px 之上，右侧面板还有自己独立的 44px 标签头，右侧区域合计 88px chrome，且与顶栏割裂成两条视觉带。

## 2. 目标

- 消除「为少数项目常驻一整列」的结构。
- 让核心工作内容（终端 / 编辑器）拿到尽可能多的像素。
- 保持终端优先的视觉语言：单条顶栏、单色标题栏、克制的信息密度。

## 3. 方案

### 3.1 新壳层骨架

```
WorkspaceHost (flex h-full flex-col)
├─ TopBar (h-11 = 44px, 全宽)
│   ├─ 左: WorkspaceSwitcher（monogram 芯片 + 名称 + ▾）→ popover 承载工作区列表
│   ├─ 身份区: env 徽标 / 分支（窄窗隐藏）
│   ├─ 中: SessionStrip (flex-1)
│   └─ 右: 面板控制簇（图标分段控件 + 折叠 chevron）→ 动作区（＋⧉⌕⚙）→ 窗口按钮
├─ 主体 (flex flex-1 min-h-0)
│   ├─ Canvas (flex-1 min-w-0)
│   └─ WorkspacePanel (无独立头部；宽度可拖；可折叠)
└─ StatusDock (h-6 = 24px, 全宽)
```

### 3.2 空间账

| 场景 | 之前 | 之后 | 收益 |
|---|---|---|---|
| 1920px 宽，画布 | 1344px | 1592px | **+18.5%** |
| 1920px 宽，折叠右面板 | —（面板不可折叠） | 1920px | **+42.9%** |
| 右侧区域纵向 chrome | 88px（顶栏 44 + 面板头 44） | 44px | **-44px** |
| 800px 窄窗，画布 | 224px | 472px | **+111%** |

### 3.3 工作区切换器（新建 `WorkspaceSwitcher.vue`）

- **触发按钮**：monogram 色块（稳定散列到 chart 色板）+ 工作区名（truncate）+ ▾ chevron。
- **Popover**（宽 260px）：工作区列表 → 拖拽重排（复用 `usePointerDragReorder`）→ 每行右键菜单（新窗口打开 / 移除）→ 底部「添加工作区」下拉（本机 / WSL / SSH）。
- 迁移 `Sidebar.vue` 的 WSL distro 刷新副作用到本组件（挂载即刷新）。
- 当前工作区高亮 + `aria-current`。

### 3.4 面板控制簇并入顶栏

- 面板原来的 44px 头部（`文件树 / 更改` 标签组 + git 分支徽标）整体删除：
  - 分支徽标去重 —— 状态坞已有，且顶栏身份区也有。
  - 标签组改为**图标分段控件**（文件树 `FolderOpenOutline` / 更改 `GitBranchOutline`），带 tooltip 与 `aria-pressed`。
- 位置：顶栏右端，动作区（新建终端 / 分屏 / 命令中心 / 设置）左侧。
- 折叠 chevron 控制面板显隐，`aria-pressed` 反映当前可见性。

### 3.5 面板显隐语义

- 新增偏好 `workspacePanelVisible: boolean`（默认 `true`），持久化。
- 移除偏好 `sidebarCollapsed`（侧栏已不存在）。旧数据残留为孤儿键，不被 `loadPreferences()` 读取，无功能影响。
- 命令 `panel.explorer.toggle` / `panel.sourceControl.toggle` 语义统一为：**切标签，并保证面板可见** —— 消除「面板折叠了但命令把它切出来」的矛盾态。

### 3.6 v3.3：左右双侧面板（追加需求）

v3.2 落地后反馈两点：画布变得过宽（1920px 下近 1600px），以及「为少数项目腾出的一整列」应该换成真正有用的内容。于是把右侧那一个面板拆成**左右各一个**，两侧都能放文件树或 git 面板。

| 约束 | 规则 |
|---|---|
| 视图种类 | 只有两种：文件树（explorer）、更改（changes） |
| 左右分配 | **全局**设置（偏好 `panelLayout`），不是按项目 |
| 不能重复 | 同一个视图不允许同时出现在两侧 —— 两边都开文件树没有意义 |
| 冲突处理 | 选到另一侧已占用的视图时**两侧对调**（`assignPanelView`） |
| 视图 / 显隐 | 两个独立维度：收起时顶栏的只读指示仍显示当前视图 |
| 切换入口 | **只有设置页**；顶栏两侧的控制簇只做展开 / 收起 |
| 宽度预算 | 单侧 ≤ 容器宽 45%；两侧合计不得把画布挤到 `MIN_CANVAS_WIDTH`(360px) 以下 |
| 旧数据迁移 | `workspacePanelTab` / `workspacePanelVisible` / `explorerPanelWidth` 降级为 legacy 源，右侧面板原样保留 |

**配置入口**（唯一一处）：
- 「设置 → 通用 → 停靠面板布局」：左侧面板 / 右侧面板两个下拉。

顶栏左右两端的控制簇**只做展开 / 收起**：
- 一枚只读图标，说明这一侧当前放的是文件树还是更改（不是按钮，点不动）；
- 一个折叠 chevron，开 / 关该侧。

同一个设置有两个入口，用户会分不清「顶栏那个按钮改了以后设置里的值也跟着
变吗」—— 所以视图切换收敛到设置页，顶栏只保留不会引起歧义的展开 / 收起。

**壳层骨架（最终形态）：**

```
WorkspaceHost (flex h-full flex-col)
├─ TopBar (44px, 全宽)
│   ├─ 左: WorkspaceSwitcher + 左侧面板控制簇
│   ├─ 身份区: env 徽标 / 分支
│   ├─ 中: SessionStrip (flex-1)
│   └─ 右: 动作区 + 右侧面板控制簇
├─ 主体 (flex flex-1 min-h-0)
│   ├─ 左侧 WorkspacePanel | Canvas | 右侧 WorkspacePanel
└─ StatusDock (24px, 全宽)
```

### 3.7 附带修复：Ctrl+Shift+V 冲突

`preview.open`（打开 URL 预览）的默认键位 `Ctrl+Shift+V` 与终端粘贴撞车：命令分发器默认「有绑定就抢」，于是终端里按下 Ctrl+Shift+V 会**既粘贴又弹预览框**。修复用 spec 的 `captureInTerminal: false` —— 终端里归粘贴（xterm 的快捷键层自己拦），终端之外（文件树 / 面板 / 命令面板）归预览。

### 3.6 响应式重整

断点保留（`compact: 900` / `narrow: 760` / `tight: 640`），语义重新分配：

| 断点 | 旧语义 | 新语义 |
|---|---|---|
| `compact` < 900 | 侧栏自动折叠为 52px 轨道 | 顶栏紧凑：隐藏分支名（状态坞仍有） |
| `narrow` < 760 | 面板按比例收窄 | 不变 |
| `tight` < 640 | 面板转覆盖层 | 不变 |

`resolveResponsivePanelWidth(requested, available, overlay)` 的 `available` 语义由「容器宽 − 侧栏宽」改为「容器宽」。

## 4. 影响面

| 类别 | 变更 |
|---|---|
| 删除 | `src/app/shell/Sidebar.vue`、`src/app/shell/Sidebar.vue.test.ts` |
| 新建 | `src/app/shell/WorkspaceSwitcher.vue` + 测试 |
| 修改 | `TopBar.vue`、`WorkspacePanel.vue`、`WorkspaceHost.vue`、`useResponsiveLayout.ts`、`useWorkbenchCommands.ts` |
| 偏好 | `store.ts`（增 `workspacePanelVisible` / 删 `sidebarCollapsed`）、`preferencesPinia.ts` |
| i18n | 删 `app.sidebar.*`；新增 `app.titleBar.*` |
| 测试 | `visualSystem.test.ts`、`WorkspaceHost.vue.test.ts`、`WorkspacePanel.vue.test.ts`、`pointerDragBoundary.test.ts`、`useResponsiveLayout.test.ts`、新建 `TopBar.vue.test.ts` |
| 文档 | `docs/architecture/01-overview.md`、`docs/architecture/overview.md` |

## 5. 不做什么

- 不移动停靠面板到左侧（保持右侧，避免 Explorer / SourceControl 停靠侧翻转）。
- 不改文件树 / 源控面板内部结构与 IPC 契约。
- 不引入新的 IPC 命令；工作区增删改仍走既有 `workspaces` store 与 `add-workspace` 事件链。
