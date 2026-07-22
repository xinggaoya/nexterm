# Nexterm v2 视觉系统重构设计

**日期**: 2026-07-22
**状态**: 已实现（阶段 0–6）
**范围**: 前端视觉层 + 命令系统接线 + AI 面板占位（不涉及 Rust 后端）

## 设计方向

在保留全部现有功能的前提下，对前端进行全新 v2 视觉重构：

- **视觉风格**: 极简专业（Linear/Zed 风）为基底 + 选择性玻璃拟态点缀。深炭背景、单一青蓝强调线、信息密度高。
- **布局范式**: 终端优先中心化。标题栏（含工作区切换）→ 命令中心条 → 标签栏 → 终端/编辑器主区 → 精简状态栏。
- **AI 定位**: UI 占位（"即将上线"），不引入 AI 后端。尊重项目既有边界（见下文）。

## 一、视觉令牌系统（`src/styles/globals.css`）

重新定义了 `:root`（亮色）与 `.dark`（暗色，canonical skin）的全部 oklch 令牌：

| 层 | 暗色值 | 用途 |
|---|---|---|
| `--shell-bg` | `oklch(0.14 0.005 250)` | 最外层深炭背景 |
| `--panel-bg` / `--card` | `oklch(0.16/0.18 0.006 250)` | 面板/卡片 |
| `--primary` | `oklch(0.82 0.13 220)` | 单一青蓝强调 |
| `--foreground` | `oklch(0.92 0.004 250)` | 主文字 |
| `--muted-foreground` | `oklch(0.62 0.006 250)` | 次要文字 |
| `--border` | `oklch(0.28 0.007 250 / 0.6)` | 极细边框 |

**新增令牌**：
- 玻璃拟态: `--glass-bg`、`--glass-blur`、`--glass-border`、`--glass-shadow`
- 动效: `--ease-out`、`--ease-spring`、`--dur-fast`(120ms)、`--dur-base`(200ms)、`--dur-slow`(320ms)

**终端令牌** (`--term-*`): 同步深炭底（`oklch(0.155 0.005 250)`），ANSI 16 色采用 Tokyo Night 风格现代调色，与青蓝强调色协调。

**降级**: `prefers-reduced-motion` 媒体查询将所有 animation/transition duration 压至 1ms（覆盖 v2 动画类）。

## 二、布局骨架

```
┌──────────────────────────────────────────────────┐
│ ● Nexterm  [ws1][ws2][+]   🔍  ✨  ⚙   – □ ×   │ 标题栏 40px
├──────────────────────────────────────────────────┤
│ ❯ 输入命令 · 跳转文件 · 问 AI…          (⌘K)    │ 命令中心条 44px
├──────────────────────────────────────────────────┤
│ ◧ tab1 │ tab2 │                          [≫]    │ 标签栏 34px
├──────────────────────────────────────────────────┤
│              终端 / 编辑器 主区                   │ 主区
├──────────────────────────────────────────────────┤
│ ws · git:feat   ●2 tasks    UTF-8   v0.1.2       │ 状态栏 24px
└──────────────────────────────────────────────────┘
```

## 三、新增/重写组件

| 组件 | 改动 |
|---|---|
| `shell/TitleBar.vue` | 重写：呼吸发光 logo、工作区切换器、命令中心/AI/设置按钮、Mac/非 Mac 分支保留 |
| `shell/CommandBar.vue` | **新增**：顶部统一入口条，⌘K 唤起命令面板 |
| `shell/StatusBar.vue` | 重写：极简化，primary 点 + 面包屑 + 面板切换 |
| `shell/TabBar.vue` | 换肤：圆角 tab、primary 底部线、glass drag ghost（保留 pointer-drag 重排/右键菜单/split） |
| `shell/LeftSidebar.vue` | 换肤：v2-slide-left 动画、精致 resizer |
| `shell/ActivityIcons.vue` | 换肤：hairline 分隔、激活态过渡 |
| `shell/WorkspaceBar.vue` | 换肤：圆角 tab、过渡 |
| `shell/Workbench.vue` | 微调：resize-trigger 过渡 |
| `components/WorkspaceWelcome.vue` | 重写：glass 卡片 + 环境光晕，保留全部入口 |
| `components/AIPanel.vue` | **新增**：AI 助手 UI 占位（纯视觉，无后端） |

## 四、命令系统接线（补齐 v1 缺口）

v1 中 `useWorkbenchCommands` 逻辑完整但**未在 MainApp 接线**（命令面板组件未渲染、全局快捷键未绑定）。

**v2 修复**：
- `WorkspaceHost` 内运行 `useWorkbenchCommands`（workspace 作用域，含 git/editor 全部 options）
- 通过 ref 暴露 `commandApi` 给 MainApp
- MainApp 渲染 `<CommandPalette>` 浮层，绑定全局 keydown（capture 阶段）
- 接通 `request-settings`/`request-command-palette`/`request-rename` emits
- `requestCloseTab` 带 dirty 守卫（修正 v1 直接调 closeTab 绕过守卫的问题）

## 五、动效系统（新增基础设施）

v1 完全没有动效库。v2 引入：
- `motion-v` — Vue 3 声明式 motion（已安装，后续交互可逐步采用）
- `@formkit/auto-animate` — 列表/布局自动过渡（已安装）
- CSS 关键帧: `v2-fade-in`、`v2-slide-up`、`v2-scale-in`、`v2-slide-in-right/left`、`v2-breathe`
- 工具类: `.v2-anim-*`、`.v2-glass`、`.v2-glass-float`、`.v2-hairline`、`.v2-dot-glow`
- Drawer 过渡: `.v2-drawer-right-*`、`.v2-drawer-left-*`

## 六、AI 面板与项目边界

**重要发现**: 项目维护者于 2026-05-21（commit 693f47a）**有意移除了全部 AI 功能**（850 行 config、agent 模块、secrets、net 模块、AI SDK 包），并设置边界测试 `src/app/noAiFeaturesBoundary.test.ts` 防止重新引入。

**v2 决策**: 尊重该边界。AI 面板作为**纯 UI 占位**放在 `src/app/components/AIPanel.vue`，不含任何 AI 后端逻辑/SDK/导入，不创建 `src/modules/ai` 目录。标题栏的 AI 按钮（✨）呼出该占位面板。若未来决定重新引入 AI，需先更新边界测试并设计后端契约。

## 七、功能保真（重构后保留的全部不变量）

所有 22 项关键不变量均已保留：多 workspace v-show 并存、env-bound wsNative、PTY disposal、共享面板可见性、window chrome、拖拽区判定、TabBar pointer-drag、FS event 双 ref、UnsavedCloseGuard、7 种标签类型、OSC 解析、PTY 假死重建、关闭撤销栈、Git 装饰 map、预览 sandbox、外部变更检测、双搜索入口、命令面板双模式、任务发现、Monaco、i18n、通知桥接、主题三层令牌联动。

## 八、验证结果

- `pnpm test`: **443 passed** / 1 skipped（含 AI 边界测试）✓
- `pnpm build`: ✓ built in 23.55s
- `cargo clippy`: 预存平台错误（`std::os::unix` on Windows），与本次前端改动无关

## 九、后续可扩展点

1. 用 motion-v 为面板切换/抽屉滑入添加编排动效
2. SideDrawer 抽屉容器（当前 LeftSidebar 已是有效面板容器，可进一步改为边缘滑出式）
3. 各模块面板（SourceControl/FileExplorer）的精细化 v2 视觉打磨
4. 若决策重新引入 AI：更新边界测试 → 设计 Rust AI 模块 → 实现 AIPanel 的实时对话
