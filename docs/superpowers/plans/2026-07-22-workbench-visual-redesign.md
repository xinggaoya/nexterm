# Nexterm Workbench Visual Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在保留现有功能与五区位置的前提下，完成全应用连续工作舱视觉重设计。

**Architecture:** 由全局语义 token 统一驱动 Tailwind、Naive UI 和 xterm；shell 只负责结构尺寸，各业务模块复用共享表面与交互规则。视觉变化不跨越 IPC、Pinia 和 workspace 生命周期边界。

**Tech Stack:** Vue 3、Tailwind CSS 4、Naive UI、xterm.js、Vitest。

---

### Task 1: 主题基础

- [x] 先为新增 token、Naive UI 映射和 CSS 视觉契约编写失败测试。
- [x] 实现深浅色语义 token、共享表面类、状态色及终端映射。
- [x] 运行 token、theme 与 visual-system 测试。

### Task 2: 工作台壳层

- [x] 先通过测试锁定 TitleBar、Activity rail、TabBar、StatusBar 和面板宽度。
- [x] 将 Workbench 从浮卡画布改为连续工作舱，统一标签、拖拽柄和活动状态。
- [x] 运行 shell 与 layout 测试。

### Task 3: 模块表面

- [x] 统一 Explorer、Source Control、Editor、Git History、Tasks、Preview 和 Markdown 的 toolbar、row、surface 与状态色。
- [x] 统一 Welcome、Settings、Command Palette、菜单、通知与对话框的浮层规则。
- [x] 运行相关组件测试。

### Task 4: 完整验证

- [x] 运行 `pnpm test` 与 `pnpm build`。
- [x] 启动开发服务，检查深浅主题、常见视口、溢出、焦点和关键交互。
- [x] 检查最终 diff，确认没有业务接口与后端改动。
