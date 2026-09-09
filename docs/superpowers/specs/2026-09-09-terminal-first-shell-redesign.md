# Nexterm 前端壳层重设计 — "终端优先工作台"(Terminal-First Shell)

日期:2026-09-09
状态:已定稿(自主执行模式,设计决策由本次重设计做出,用户可随后迭代)
范围:仅前端展示层(壳层 + 视觉令牌)。功能模块(终端/编辑器/资源管理器/源控/任务/预览)、Rust 后端、IPC 契约、Pinia store 逻辑全部复用。

## 1. 目标与动机

旧壳层是经典 IDE 范式(活动栏 + 常驻侧栏 + 标签条 + 状态栏),终端被装在一张带边框的"卡片"里,与编辑器、面板分享空间。本次彻底重做布局,目标:

1. **终端是主角**:打开工作区即全幅终端,零多余镶边;其他一切悬浮其上。
2. **多工作区成为空间维度**:每个打开的工作区是一枚"芯片",贴在左缘轨道上,一键切换、后台常驻(能力已存在:全部 host 常驻挂载 + v-show)。
3. **面板即浮层**:文件树 / 源控 / 任务控制台不再挤压终端,以玻璃拟态浮层覆盖,随用随关。
4. **更克制的 chrome**:标题栏与标签条合并为一条 44px 顶栏;单终端时进一步退化为"面包屑",接近原生终端的存在感。

## 2. 信息架构

```
┌────┬────────────────────────────────────────────────┐
│ 轨 │ 顶栏 h-11:[工作区名+env+分支][会话条…][动作][窗控] │
│ 道 ├────────────────────────────────────────────────┤
│    │                                                │
│ 52 │        画布:终端/编辑器 全幅无框                  │
│ px │   ┌──────────┐        ┌──────────────────┐     │
│    │   │浮层:文件树 │        │浮层:任务控制台(底) │     │
│芯片 │   │/源控(左)  │        │                  │     │
│ 工具│   └──────────┘        └──────────────────┘     │
│    ├────────────────────────────────────────────────┤
│    │ 状态坞 h-6:[env·工作区·分支]        [任务运行态] │
└────┴────────────────────────────────────────────────┘
```

### 2.1 轨道(Rail,52px,左缘通高)
- **上区**:Nexterm 字标点(装饰)→ 工作区芯片列表 → "+"添加按钮(菜单:本机 / WSL distro / SSH,复用 `WorkspaceAddControl` 的 distro 探测逻辑)。
- **芯片**:32×32 圆角方块,首字母 monogram;活动 = accent 底,非活动 = surface-hover;右下 4px env 角标(WSL=info、SSH=warning、本机=无)。Tooltip 显示名称+路径+env;单击切换(`workspaces.setActive`),中键/右键菜单关闭(经 `request-remove-workspace` 二次确认)、在新窗口打开。
- **下区**:工具切换(文件树 / 源控 / 任务),分隔线,命令面板、设置。
- 工具键映射:explorer / sourceControl / tasks 三个浮层,单选互斥(左列);任务为底部浮层独立开关。

### 2.2 顶栏(TopBar,44px,每工作区自渲染)
- 左:工作区名 + env 徽标 + git 分支(点击分支可弹分支菜单沿用 showBranchesModal 链路则后续再做,首版只读展示)。
- 中:会话条(SessionStrip)。
- 右:新终端 +、分屏下拉、命令面板、设置、WindowControls(非 mac)。
- 整条为窗口拖拽区(沿用 `data-window-drag-region` + `target===currentTarget` 守卫的 startDragging 方案)。

### 2.3 会话条(SessionStrip)
- 药丸式标签:图标 + 标题 + 悬停关闭 ×;脏标记圆点;预览斜体;固定宽度偏好(`tabWidthMode/tabFixedWidth`)继续生效。
- 拖拽重排:移植旧 TabBar 的 pointer 拖拽实现(阈值 6px、ghost、before/after 落点)。
- **极简模式**:仅一个终端 tab 时,会话条退化为一个 cwd 面包屑芯片(不可关、无标签框),顶栏呈现"原生终端 + 超能力"的气质;出现第二个 tab 或非终端 tab 时恢复完整标签。
- 右键菜单复用 `TabContextMenu.vue`(12 个 emit 契约不变)。

### 2.4 画布(Canvas)
- 终端:每个终端 tab 一个 `TerminalWorkspace` 实例,v-show 保活(与旧 Workbench 相同);**去掉外层卡片边框/圆角**,终端铺满画布,与轨道、顶栏、状态坞之间以 1px hairline 分隔。
- 非终端 tab:editor(仅活动渲染)/ preview / markdown / file-preview / git-diff / git-history 各 Stack 全保活,同样全幅。
- 编辑器仍由 `saveActiveEditor/openGotoLine/revealEditorLine` 等暴露方法驱动,契约从旧 Workbench 原样迁移到 Canvas。

### 2.5 浮层(Overlay)
- 左列浮层(文件树/源控):`absolute left-2 top-2 bottom-2`,默认宽 340px,右缘可拖拽调宽(持久化沿用 `explorerPanelWidth/sourceControlPanelWidth` 偏好),玻璃拟态(`v2-glass` + rounded-xl + 阴影)。Esc 或再次点击工具键关闭;浮层不改变画布布局。
- 底部浮层(任务控制台):`absolute inset-x-2 bottom-2 h-[300px]`,复用 `TaskConsole.vue` 与其控制器,不改模块。
- `useWorkbenchCommands` 的 `leftPanelOpen/rightPanelOpen` 选项分别绑定"源控浮层/文件树浮层"的可写 ref,现有命令(`panel.*.toggle`、`git.refresh` 等)语义不变。

### 2.6 状态坞(StatusDock,24px)
- 左:env 徽标 + 工作区名 + 分支(host 内部消化 `branch-change`,不再上抛 MainApp)。
- 右:任务运行数(>0 时显示)。
- 移除旧 StatusBar 的四个面板切换按钮(职责移入轨道)。

### 2.7 工作区仪表盘(WorkspaceDashboard,替代 WorkspaceWelcome)
- 无工作区时全屏:居中字标 + 一句 tagline;环境选择(本机/WSL/SSH,复用 `WorkspaceEnvSelector`);大号"打开文件夹"主按钮;最近工作区以 monogram 卡片网格呈现(env 角标 + 路径)。
- Props/emits 与 WorkspaceWelcome 完全一致,MainApp 接线不变。

## 3. 视觉语言 — "Graphite & Signal"

- **色**:暗色为主角。石墨蓝底(`--shell-bg` oklch≈0.16),表面以亮度阶梯分层而非边框;1px 发丝线(白 6–8% α);亮色保持中性浅灰。保持既有 6 组 accent 预设与 `[data-accent]` 机制不动。
- **形**:圆角体系放大(--radius 8→10,新增 xl=14);芯片/药丸全圆角;浮层 xl。
- **玻璃**:`--glass-blur` 提到 20px,浮层统一 `v2-glass`。
- **动效**:沿用 `--dur-fast/base/slow` + `v2-pop/v2-fade/v2-anim-slide-left`;尊重 prefers-reduced-motion。
- **字**:Inter(chrome)/ JetBrains Mono(终端)不变;微标签 11px + tracking。
- **实现方式**:只改 `globals.css` 中 `:root`/`.dark` 的令牌**值**(令牌名、`@theme inline` 映射、xterm `--term-*`、accent 块结构全部保留),模块 UI 经令牌与新 Naive overrides 自动继承新皮肤。

## 4. 组件与文件变更清单

新增 `src/app/shell/`:`Rail.vue`、`TopBar.vue`、`SessionStrip.vue`、`Canvas.vue`、`OverlayPanel.vue`、`StatusDock.vue`。
新增 `src/app/components/`:`WorkspaceDashboard.vue`(接口同 WorkspaceWelcome)。
重写:`WorkspaceHost.vue`(模板换新;脚本保留 wsNative/Context/watcher/taskConsole/commands 全部接线)、`MainApp.vue`(去掉 TitleBar/StatusBar/Welcome/useWorkbenchLayout 依赖,保留主题/locale/抽屉/面板/守卫/增删工作区流程)。
删除:`TitleBar.vue`、`WorkspaceBar.vue`、`ActivityIcons.vue`、`LeftSidebar.vue`、`TabBar.vue`、`Workbench.vue`、`StatusBar.vue`、`WorkspaceWelcome.vue`(+ 各自测试;`TabContextMenu.vue` 保留)。
`useWorkbenchLayout.ts`:壳层不再消费后删除(其 prefs 键 `leftSidebar/panelVisibility` 保留为遗留,不迁移)。
测试:重写 `visualSystem.test.ts` 为新设计系统守卫(新尺寸、结构断言;xterm 变量计数与 accent 块断言原样保留);新增 `SessionStrip/Canvas/Rail/StatusDock/WorkspaceDashboard` 测试;更新 `MainApp.vue.test.ts` 与 `WorkspaceHost.vue.test.ts` 的 stub。
i18n:新增 `app.rail.*`、`app.dashboard.*` 等键(zh-CN/en-US)。

## 5. 明确不做(YAGNI)

- 不改 Rust 后端、native.ts、tabs/workspaces store 的数据模型。
- 不做浮层"钉住变停靠"、不做工作区拖拽重排(Store 已有 reorder,后续可接)、不新增命令/快捷键。
- 不重写模块内部 UI(编辑器、源控面板内容、设置分区、命令面板外观),靠令牌继承。
- `TerminalResizer` 的 resize 事件断链维持现状(记录为已知问题,不在本次范围)。

## 6. 验收

- `pnpm exec vue-tsc --noEmit`、`pnpm test`、`pnpm build` 全绿;边界测试(native/event/vueShell/tauriCapabilities/noReact*)不回退。
- 行为验收:开多工作区 → 轨道芯片切换、后台终端保活;单终端极简顶栏;文件树/源控浮层开关与命令面板互通;任务浮层;关窗守卫与 PTY 回收链路不变。

## 7. 修订 v3.1 — 停靠式布局(2026-09-09,用户反馈后)

用户反馈:浮层形态不符合预期,终端也不需要独占全部宽度;参考 MonoCode 的双列左侧结构。修订如下:

1. **全部面板从浮层改为停靠**:`OverlayPanel.vue` 删除。新增 `WorkspacePanel.vue`(每工作区一列,默认 300px,右缘可拖宽,持久化沿用 `explorerPanelWidth`),以三个标签组织内容:**文件树 / 更改 / 任务**(标签状态持久化在新偏好 `workspacePanelTab`),内容组件(FileExplorer / SourceControlPanel / TaskConsole)v-show 保活。
2. **Rail 升级为 `Sidebar.vue`(全局侧栏)**,参考 MonoCode 的信息设计:
   - 顶部:应用标识 + 搜索位(点击打开命令面板,显示 ⌘K 角标);
   - "工作区"分区:每行彩色 monogram(id 稳定散列到 chart 色板)+ 名称 + env 图标(WSL=服务器/SSH=终端,info/warning 色),活动行高亮,悬停显 × 关闭,右键菜单(新窗口/关闭);
   - 底部:设置入口;侧栏可折叠为 52px 轨道(芯片态,偏好 `sidebarCollapsed`)。
   - 工具切换键职责移交 WorkspacePanel 的三个标签,侧栏不再承担。
3. **Canvas 回归纯内容层**:终端/编辑器等铺满剩余宽度,不再承载任何浮层;各内容层加 `data-tab-layer` 标记。
4. 命令系统面板语义:`leftPanelOpen` = 更改标签、`rightPanelOpen` = 文件树标签(写入即切换标签);`openTaskConsole` = 切到任务标签。
5. 视觉契约(visualSystem.test.ts)同步更新为停靠结构断言。

## 8. 修订 v3.2 — 面板移至右侧(2026-09-09,用户反馈后)

用户反馈:终端和内容应放在中间区域,文件树和更改放右侧栏。修订:

1. WorkspaceHost 行布局改为 `Sidebar | [TopBar / (Canvas | WorkspacePanel) / StatusDock]`——画布居中,停靠面板移到右缘。
2. WorkspacePanel 拖宽手柄从右缘改为**左缘**(向左拖加宽),DOM 顺序 Canvas 在前、面板在后;新增 `data-workspace-panel-right` 标记。
3. 契约测试同步:断言 `<Canvas ... <WorkspacePanel` 次序与左缘手柄。
