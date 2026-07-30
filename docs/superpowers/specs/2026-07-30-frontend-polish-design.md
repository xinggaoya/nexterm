# 前端打磨增强：动效补齐 + 性能瓶颈优化

- **日期**：2026-07-30
- **方案**：均衡改进（方案 C）
- **状态**：待审阅
- **范围**：动效系统化补齐 + 高收益性能瓶颈，不含终端渲染管线/PTY/OSC 等已优化项

## 1. 背景与动机

项目已具备扎实的动效与性能基础，但存在两处明显错配：

**动效：基础完善却几乎未用。**
- 有完善的动效 token（`--dur-fast/base/slow`、`--ease-out/spring`，`globals.css:126-130`）和全局 `prefers-reduced-motion` 处理（`globals.css:407-416`）。
- 但全项目 **0 处** `<Transition>`/`<TransitionGroup>`；安装了 3 个动画库（`motion-v`、`@formkit/auto-animate`、`tw-animate-css`）却**全都没用**。
- 存在孤立的 `.v2-drawer-*` Vue transition CSS（`globals.css:670-687`，0 引用，注释提到的 `SideDrawer` 组件并不存在）。
- 只有 4 个组件用了 `v2-anim-*` 类。
- 结果：命令面板、标签右键菜单、标签增删、面板分屏、列表重排——**全部瞬时切换（snap）**，与 naive-ui 抽屉/模态框的顺滑手感形成断层。

**性能：已优化一轮，但留有 2 个高收益瓶颈。**
- 已优化（本次**不动**）：终端 WebGL 渲染管线、PTY 批处理、OSC O(1) 查表、文件树虚拟滚动（>200 行）、源码管理虚拟列表 + debounce、标签 memo、i18n 懒加载。
- ⚠️ **关键约束**：`content-visibility` 曾用于终端/工作区被回退（commit `8a6605e`），原因是与 FitAddon 测量竞态导致 WSL zsh 崩溃。**本次不可重新给终端/工作区容器加 `content-visibility`**。
- 高收益瓶颈：
  1. Monaco 启动时即加载（~4MB chunk），即使用户只用终端。`EditorPane`/`DiffEditor`/`MarkdownPreviewPane` 顶层静态 `import * as monaco`，进入渲染图即拉取。
  2. `GitHistoryPane` 提交列表（`GitHistoryPane.vue:516`）无虚拟化，已定义 `ROW_HEIGHT = 32` 却用 `v-for` 全量渲染；`graphRows` computed（`:131`）每次全量 `layoutGraph`，`filteredCommits` 过滤无 debounce。
  3. `FindInFilesPanel` 结果（`FindInFilesPanel.vue:149`）无窗口化/分页，大范围 grep 渲染上千行。

## 2. 目标与非目标

### 目标
- 用 Vue 内置 `<Transition>`/`<TransitionGroup>` + 已有 token，补齐命令面板、标签右键菜单、标签增删、面板分屏、列表重排的进入/退出动画。
- 为文件树加载、Git 历史加载提供骨架屏；统一空状态风格。
- 清理未用动画依赖与死 CSS，统一为单一动效系统。
- Monaco 改为按需加载，冷启动主路径减少 ~4MB。
- Git 历史与 FindInFiles 列表虚拟化/分页化。

### 非目标（明确不做）
- ❌ 不重新给终端/工作区容器加 `content-visibility`（FitAddon 竞态 → WSL zsh 崩溃）。
- ❌ 不动已优化的终端渲染管线 / PTY 批处理 / OSC 查表 / 文件树快照模型。
- ❌ 不引入路由级拆分（项目无 router，单一 `MainApp.vue`）。
- ❌ 不对终端**内容切换**做 fade 动画（会闪且影响 xterm 渲染）。
- ❌ 不改 naive-ui 自带的抽屉/模态框/toast 动画。

## 3. 设计

### 3.1 动效系统选型

采用 **Vue 内置 `<Transition>` / `<TransitionGroup>` + 现有 `v2-anim-*` token**，不引入新依赖。

- 新增的 keyframe/transition 全部引用 `--dur-*` / `--ease-*` token，从而被 `globals.css:407-416` 的 `prefers-reduced-motion` 媒体查询自动覆盖（强制 `1ms`），无障碍零成本。
- 列表重排（标签栏、源码管理变更列表）用 `<TransitionGroup>` 的 FLIP，靠 Vue 内置能力，无需第三方。

### 3.2 动效覆盖清单

| 场景 | 当前 | 改进 | 文件 | 约束 |
|---|---|---|---|---|
| 命令面板开关 | 瞬时 `v-if` | fade + scale-in（遮罩 fade，面板 `v2-scale-in`） | `CommandPalette.vue:241` | — |
| 标签右键菜单 | 瞬时 `v-if` | scale/fade-in，退出淡出 | `TabContextMenu.vue:150` | 对齐 NDropdown 手感；点击外部关闭时淡出 |
| 标签栏增删/拖拽重排 | 瞬时 | `<TransitionGroup>` 水平 slide（transform） | `TabBar.vue:261` | **只动标签条 DOM**，不影响终端内容 |
| 源码管理变更列表重排 | 瞬时 | `<TransitionGroup>` FLIP | `SourceControlChangeList.vue` | — |
| 侧边栏面板切换 | `v-if`/`v-show` 瞬时 | fade | `LeftSidebar.vue:95` | — |
| 面板分屏新增 | 瞬时 | opacity fade-in | `TerminalWorkspace.vue:41` | ⚠️ **禁用 transform scale**，避免触发 FitAddon 测量竞态（content-visibility 教训） |
| 标签切换内容 | — | **不做** | — | 终端切换 fade 会闪且影响 xterm 渲染 |

### 3.3 加载 / 空状态

- **骨架屏**：文件树加载、Git 历史加载用骨架行（轻微 `v2-breathe` 或 shimmer），替代当前"空白→NSpin→弹出"。
- **空状态统一**：图标 + 文案 + 极轻微 fade-in，风格对齐已最好的 `SourceControlChangeList`（`CheckmarkCircleOutline` + 居中 grid）。涉及 `WorkspaceWelcome`、`FindInFilesPanel`、`CommandPalette` 无结果态。

### 3.4 性能优化

1. **Monaco 按需加载**（最高收益）
   - `EditorPane.vue`、`DiffEditor.vue`、`MarkdownPreviewPane`（若静态引入 monaco）改用 `defineAsyncComponent(() => import(...))`。
   - 效果：monaco chunk（~4MB）只在首次打开编辑器/Markdown 标签时加载；纯终端用户冷启动主路径减负。
   - 加载占位：用骨架屏或轻量 loading 态，避免空白。

2. **Git 历史虚拟滚动**
   - `GitHistoryPane.vue:516` 提交列表定高窗口化（复用文件树 200 行阈值 + overscan 模式）。
   - 行组件加 `v-memo="[commit.sha, selectedSha === commit.sha]"`。
   - `filteredCommits` 的搜索输入加 debounce（~120ms），避免每次按键全量重过滤。
   - `graphRows` computed 保持现状（按 `commits` 键控，已正确）；不在本次改 web-worker（超范围）。

3. **FindInFiles 窗口化**
   - 结果列表采用与文件树一致的定高窗口化（阈值 + overscan）。若定高难以保证（命中行展开高度不一），退化为「先渲染 N 组 + 触底加载更多」分页。优先窗口化；分页仅作为定高不可行时的回退。

4. **will-change 瞬态提示**
   - 标签拖拽 ghost、分屏 resizer 拖动期间瞬态加 `will-change: transform`，结束即清除。减少 paint 抖动。
   - 谨慎使用：只在交互进行时加，结束即移除（避免常驻增加内存）。

### 3.5 依赖与死代码清理

- 移除未用动画依赖：`motion-v`、`@formkit/auto-animate`（deps）、`tw-animate-css`（devDeps）。
- 移除 `globals.css:2` 的 `@import "tw-animate-css"`。
- 移除孤立的 `.v2-drawer-*` CSS（`globals.css:670-687`）。
- 保留：`v2-anim-*` keyframe 工具类（本次将真正用起来）与全局 `prefers-reduced-motion`。

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 标签栏 `<TransitionGroup>` 影响 OSC/拖拽既有逻辑 | 只包列表项 enter/leave/move，不动 `reorderTab`/拖拽指针逻辑；拖拽 ghost 仍走既有指针路径 |
| 分屏 transform 触发 FitAddon 测量竞态 | 分屏入场**只用 opacity**，禁用 transform scale；不碰 `content-visibility` |
| Monaco 改异步后首次打开有延迟 | 首次打开用骨架/loading 态占位；延迟只在首次，chunk 加载后即用 |
| 虚拟滚动引入滚动跳动 | 复用文件树已验证的定高 + overscan + ResizeObserver 模式 |
| 清理依赖误删在用项 | 清理前 grep 全仓确认 0 引用；`tw-animate-css` 仅 `globals.css:2` 一处 import |

## 5. 验收标准

- `pnpm test` + `pnpm build`（含 `vue-tsc --noEmit`）通过。
- 命令面板、标签右键菜单、标签增删/拖拽、分屏新增、列表重排均可见进入/退出动画。
- `prefers-reduced-motion` 开启时所有新增动画降为 ~1ms（不破功能）。
- 冷启动网络/加载中不再包含 monaco chunk；首次打开编辑器标签时加载。
- Git 历史 >200 条、FindInFiles 大范围结果均不卡顿。
- 三个未用动画库与孤立 CSS 已移除，构建产物无残留引用。

## 6. 提交策略

拆为 3 个聚焦 commit，各自可独立验证：
1. `refactor(ui): 移除未用动画依赖与孤立 transition CSS` — 清理先行，零风险。
2. `feat(ui): 补齐命令面板/标签/分屏/列表的进入退出动效` — 动效覆盖。
3. `perf(ui): Monaco 按需加载 + Git 历史/FindInFiles 虚拟化` — 性能项。
