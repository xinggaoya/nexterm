# 前端打磨增强 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Vue 内置 `<Transition>`/`<TransitionGroup>` 补齐界面进入/退出动效，并对 Monaco 按需加载与大列表虚拟化做高收益性能优化。

**Architecture:** 动效全部复用项目已有的 `--dur-*`/`--ease-*` token 与全局 `prefers-reduced-motion` 处理，不引入新依赖；性能侧把 `EditorPane`/`DiffEditor`/`MarkdownPreviewPane` 三个静态 import 改为 `defineAsyncComponent`，并把 Git 历史/FindInFiles 的大列表虚拟化。

**Tech Stack:** Vue 3 `<script setup>`、naive-ui、Tailwind CSS v4、Vitest + @vue/test-utils。

## Global Constraints

- 包管理器：pnpm（必需）；Node 运行时（无 Bun）。
- **不可给终端/工作区容器加 `content-visibility`**（commit `8a6605e` 回退原因：FitAddon 测量竞态 → WSL zsh 崩溃）。
- 新增 keyframe/transition 必须引用 `--dur-*`/`--ease-*` token，从而被 `globals.css:407-416` 的 `prefers-reduced-motion` 媒体查询自动覆盖。
- **终端内容切换不做动画**（会闪且影响 xterm 渲染）。
- 所有 IPC 走 `@/lib/native`，不直接 `invoke()`。
- 事件订阅用 `@/lib/useEventListener`；本计划不新增原生 addEventListener。
- 提交信息用中文（Conventional Commit 前缀），技术名保持英文。
- 每次 PR 前：`pnpm test` + `pnpm build` 通过。

---

## File Structure

**新建：**
- 无新建组件文件（复用现有组件）。

**修改：**
- `src/styles/globals.css` — 新增 Vue `<Transition>` 命名类（`v2-pop`、`v2-tab-move` 等），删除孤立 `.v2-drawer-*` 与 `tw-animate-css` import。
- `package.json` — 移除未用依赖 `motion-v`、`@formkit/auto-animate`、`tw-animate-css`。
- `src/app/shell/CommandPalette.vue` — 模板顶层 `v-if="show"` 包 `<Transition>`，加进入退出动效。
- `src/app/shell/TabContextMenu.vue` — 模板 `v-if="target"` 包 `<Transition>`。
- `src/app/shell/TabBar.vue` — 标签列表 `v-for` 包 `<TransitionGroup>`。
- `src/app/shell/LeftSidebar.vue` — 面板切换容器包 `<Transition>`。
- `src/modules/terminal/TerminalWorkspace.vue` — 分屏容器包 opacity-only `<Transition>`。
- `src/app/shell/Workbench.vue` — `EditorPane` 改 `defineAsyncComponent`。
- `src/modules/editor/GitDiffPane.vue` — `DiffEditor` 改 `defineAsyncComponent`。
- `src/modules/markdown/MarkdownStack.vue` — `MarkdownPreviewPane` 改 `defineAsyncComponent`。
- `src/modules/git-history/GitHistoryPane.vue` — 提交列表虚拟化 + `v-memo` + 搜索 debounce；初始加载骨架屏。
- `src/modules/explorer/FileExplorer.vue` — 文件树加载骨架屏。
- `src/modules/search/FindInFilesPanel.vue` — 结果分页渲染。

**关于 spec §3.2「源码管理变更列表 TransitionGroup」的技术修正：** 调研发现 `SourceControlChangeList.vue` 已用 naive-ui `NVirtualList`，虚拟列表内部 DOM 条目是**复用**的（滚动时同一 DOM 节点被重新填充数据），`<TransitionGroup>` 的 FLIP 无法套在虚拟列表内部（FLIP 依赖真实 DOM 节点的 enter/leave/move，与 DOM 复用语义冲突）。因此该条**不实施**——虚拟列表自身的滚动已是性能最优解，列表项增删在虚拟列表里靠数据变化体现即可。spec 该项经核实不可行，本计划将其剔除。

---

## Task 1: 移除未用动画依赖与孤立 transition CSS

**Files:**
- Modify: `package.json`（移除 `motion-v`、`@formkit/auto-animate`、`tw-animate-css`）
- Modify: `src/styles/globals.css:2`（移除 `@import "tw-animate-css";`）、`globals.css:669-687`（删除孤立 `.v2-drawer-*`）

**Interfaces:**
- Consumes: 无
- Produces: 清理后的依赖清单与 globals.css；后续任务新增动效类时不再与死代码冲突。

- [ ] **Step 1: 确认三个依赖零引用**

  Run: `grep -rn "motion-v\|@formkit/auto-animate\|autoAnimate\|v-auto-animate\|tw-animate-css\|animate-in\|fade-in-\|zoom-in\|slide-in-from-" src/ | grep -v node_modules`
  Expected: 仅 `src/styles/globals.css:2` 出现 `tw-animate-css` 一处 import，其余 0 匹配。

- [ ] **Step 2: 移除 globals.css 中的 tw-animate-css import**

  编辑 `src/styles/globals.css:2`，删除该行：
  ```css
  @import "tw-animate-css";
  ```

- [ ] **Step 3: 删除孤立的 `.v2-drawer-*` transition CSS**

  编辑 `src/styles/globals.css`，删除 `669-687` 行整段（从注释 `/* Drawer slide transitions (used by SideDrawer via Vue <Transition>). */` 到 `.v2-drawer-left-leave-to { transform: translateX(-100%); opacity: 0; }` 结束）。删除前先 grep 确认 `.v2-drawer-right` / `.v2-drawer-left` 在 `src/` 下 0 引用。

- [ ] **Step 4: 从 package.json 移除依赖**

  Run: `pnpm remove motion-v @formkit/auto-animate tw-animate-css`
  预期 `package.json` 中这三个依赖被移除，lockfile 更新。

- [ ] **Step 5: 验证类型检查与构建**

  Run: `pnpm exec tsc --noEmit`
  Expected: PASS（无类型错误；这些库未被任何代码引用）。

- [ ] **Step 6: Commit**

  ```bash
  git add -A
  git commit -m "refactor(ui): 移除未用动画依赖与孤立 transition CSS

  - 删除 motion-v / @formkit/auto-animate / tw-animate-css 三个未引用依赖
  - 删除 globals.css 中孤立的 .v2-drawer-* transition 类（0 引用）
  - 移除 tw-animate-css 的 @import"
  ```

---

## Task 2: 在 globals.css 新增动效 transition 类

**Files:**
- Modify: `src/styles/globals.css`（在原 `.v2-drawer-*` 删除位置附近新增 Vue `<Transition>` 命名类）

**Interfaces:**
- Consumes: Task 1 清理后的 globals.css
- Produces: `.v2-pop-*`（弹出 scale/fade）、`.v2-fade-*`（纯 fade）、`.v2-tab-move-*`（列表项 slide move/enter/leave）四组 Vue transition 命名类，供 Task 3-6 使用。

- [ ] **Step 1: 新增三组 Vue transition 命名类**

  在 globals.css 删除 `.v2-drawer-*` 的位置插入：
  ```css
  /* ── Vue <Transition> / <TransitionGroup> 命名类 ──────────────────
   * 全部引用 --dur-*/--ease-* token，prefers-reduced-motion 媒体查询会
   * 自动把它们降为 1ms。 */
  /* 弹出层：scale + fade（命令面板、右键菜单） */
  .v2-pop-enter-active,
  .v2-pop-leave-active {
    transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  }
  .v2-pop-enter-from,
  .v2-pop-leave-to {
    opacity: 0;
    transform: scale(0.97);
  }
  /* 纯 fade（侧栏面板切换、分屏新增） */
  .v2-fade-enter-active,
  .v2-fade-leave-active {
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .v2-fade-enter-from,
  .v2-fade-leave-to {
    opacity: 0;
  }
  /* 列表项水平 slide（标签栏、变更列表），仅 transform + opacity */
  .v2-tab-move-enter-active,
  .v2-tab-move-leave-active {
    transition: transform var(--dur-base) var(--ease-spring), opacity var(--dur-fast) var(--ease-out);
  }
  .v2-tab-move-enter-from {
    opacity: 0;
    transform: translateX(-8px);
  }
  .v2-tab-move-leave-to {
    opacity: 0;
    transform: translateX(8px);
  }
  /* TransitionGroup 的 .xxx-move 类由 Vue 自动注入，复用同一过渡 */
  .v2-tab-move-move {
    transition: transform var(--dur-base) var(--ease-spring);
  }
  ```

- [ ] **Step 2: 验证构建**

  Run: `pnpm exec vite build --mode development 2>&1 | tail -5`
  Expected: 构建成功，无 CSS 解析错误。

- [ ] **Step 3: Commit**

  ```bash
  git add src/styles/globals.css
  git commit -m "feat(ui): 新增 Vue Transition 命名类（pop/fade/tab-move）"
  ```

---

## Task 3: 命令面板进入/退出动效

**Files:**
- Modify: `src/modules/commands/CommandPalette.vue:240-251`（模板顶层结构）
- Test: `src/modules/commands/CommandPalette.vue.test.ts`（已有测试，验证未被破坏）

**Interfaces:**
- Consumes: Task 2 的 `.v2-pop-*` 类
- Produces: CommandPalette 开关时遮罩 fade + 面板 scale-in。

**注意：** 当前模板 `<div v-if="show" ...>` 直接是根。包 `<Transition>` 时外层必须有单根；`<Transition>` 本身不渲染 DOM，其直接子节点需是单元素。遮罩和面板是父子嵌套（遮罩里有面板），所以 `<Transition>` 包整个遮罩 div 即可——退场时遮罩 fade、面板 scale。

- [ ] **Step 1: 先读现有测试，确认验证点**

  Run: `sed -n '1,60p' src/modules/commands/CommandPalette.vue.test.ts`
  了解测试如何 mount、如何断言 show/隐藏，避免包 Transition 后破坏（Transition 在测试环境 jsdom 下 enter/leave 类会应用但 `v-if` 切换行为不变）。

- [ ] **Step 2: 修改模板，用 Transition 包裹**

  编辑 `src/modules/commands/CommandPalette.vue`，把：
  ```html
  <template>
    <div
      v-if="show"
      data-command-palette
      class="fixed inset-0 z-40 flex items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[2px]"
      @mousedown.self="close"
    >
  ```
  改为：
  ```html
  <template>
    <Transition name="v2-pop">
    <div
      v-if="show"
      data-command-palette
      class="fixed inset-0 z-40 flex items-start justify-center bg-black/30 px-4 pt-[12vh] backdrop-blur-[2px]"
      @mousedown.self="close"
    >
  ```
  并在 `</section></div>` 之后、`</template>` 之前补 `</Transition>`：
  ```html
      </section>
    </div>
    </Transition>
  </template>
  ```
  即 `<Transition name="v2-pop">` 紧贴 `<div v-if="show">`，`</Transition>` 紧贴其闭合后。

- [ ] **Step 3: 运行该组件测试**

  Run: `pnpm test -- src/modules/commands/CommandPalette.vue.test.ts`
  Expected: PASS。若测试断言"关闭后 DOM 立即消失"，Transition 会延迟一帧 leave——但 jsdom 下 `transition` 不真正计时，leave-active 元素仍在 DOM 直到 nextTick。如有失败，在测试里对关闭用 `await nextTick()` 包裹已存在的用例即可（不改测试逻辑，只补 await）。

- [ ] **Step 4: Commit**

  ```bash
  git add src/modules/commands/CommandPalette.vue src/modules/commands/CommandPalette.vue.test.ts
  git commit -m "feat(ui): 命令面板开关加 scale+fade 进入退出动效"
  ```

---

## Task 4: 标签右键菜单进入动效

**Files:**
- Modify: `src/app/shell/TabContextMenu.vue:150-157`
- Test: 无现成测试（本组件无 .test.ts）；依赖手动验证 + 类型检查。

**Interfaces:**
- Consumes: Task 2 的 `.v2-pop-*` 类
- Produces: 右键菜单出现时 scale+fade-in，关闭时淡出。

**注意：** 外部 pointerdown 关闭（`handleOutsidePointerDown`）会立即 `close()` 把 target 置空触发 leave。scale 退场在 120ms 内完成，体感是快速淡出，可接受。

- [ ] **Step 1: 用 Transition 包裹菜单根**

  编辑 `src/app/shell/TabContextMenu.vue`，把模板从：
  ```html
  <template>
    <div
      v-if="target"
      ref="menuElement"
      class="nexterm-overlay fixed z-50 min-w-44 p-1 text-[12px]"
      :style="{ left: `${target.x}px`, top: `${target.y}px` }"
      @contextmenu.prevent
    >
  ```
  改为：
  ```html
  <template>
    <Transition name="v2-pop" appear>
    <div
      v-if="target"
      ref="menuElement"
      class="nexterm-overlay fixed z-50 min-w-44 p-1 text-[12px]"
      :style="{ left: `${target.x}px`, top: `${target.y}px` }"
      @contextmenu.prevent
    >
  ```
  并在模板最末 `</div>` 之后、`</template>` 之前补 `</Transition>`。`appear` 让首次出现也走动画。

- [ ] **Step 2: 类型检查**

  Run: `pnpm exec vue-tsc --noEmit 2>&1 | tail -5`
  Expected: PASS。

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/shell/TabContextMenu.vue
  git commit -m "feat(ui): 标签右键菜单加 scale+fade 进入动效"
  ```

---

## Task 5: 标签栏 TransitionGroup（增删 + 拖拽重排 FLIP）

**Files:**
- Modify: `src/app/shell/TabBar.vue:260-315`（标签 button 的 v-for 区块）
- Test: `src/app/shell/TabBar.vue` 若有 .test.ts 先核对（运行 `pnpm test` 验证）。

**Interfaces:**
- Consumes: Task 2 的 `.v2-tab-move-*` 类
- Produces: 标签新增/删除/拖拽重排时水平滑动过渡。

**注意（关键约束）：** 拖拽逻辑（`handleTabPointerDown`、`pointerDrag`、ghost、`dropTarget`）全部不动。`<TransitionGroup>` 的 move 过渡靠 Vue 的 FLIP，对拖拽释放后数组重排生效；拖拽进行中的 ghost 仍走既有指针路径，互不冲突。`TransitionGroup` 渲染为 `<span>`（默认）或指定 `tag`——这里标签列表的父是 `<div class="flex ...">`（`:259`），所以给 TransitionGroup 设 `tag="div"` 并把 flex 类移到它上面，避免多套一层破坏布局。

- [ ] **Step 1: 先确认 TabBar 是否有测试**

  Run: `ls src/app/shell/TabBar.vue.test.ts 2>/dev/null && echo EXISTS || echo NONE`

- [ ] **Step 2: 用 TransitionGroup 包裹标签 v-for**

  编辑 `src/app/shell/TabBar.vue:259-315`。当前：
  ```html
  <div class="no-scrollbar min-w-0 flex-1 overflow-x-auto">
    <div class="flex min-w-full items-end gap-0.5 px-1.5 py-1.5">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        ...
      >
      ...
      </button>

      <div
        data-window-drag-region
        class="h-6 min-w-4 flex-1"
      />
    </div>
  </div>
  ```
  改为（把内层 `<div class="flex ...">` 换成 `<TransitionGroup tag="div" name="v2-tab-move" class="flex min-w-full items-end gap-0.5 px-1.5 py-1.5">`，标签 `<button>` 放进去，`data-window-drag-region` 占位 div **留在 TransitionGroup 外**——它不是 list item）：
  ```html
  <div class="no-scrollbar min-w-0 flex-1 overflow-x-auto">
    <div class="flex min-w-full items-end gap-0.5 px-1.5 py-1.5">
      <TransitionGroup tag="div" name="v2-tab-move" class="flex min-w-0 items-end gap-0.5">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          ...
        >
        ...
        </button>
      </TransitionGroup>

      <div
        data-window-drag-region
        class="h-6 min-w-4 flex-1"
      />
    </div>
  </div>
  ```
  注意：外层保留 `min-w-full px-1.5 py-1.5`，TransitionGroup 只承载标签 button 的 flex 流（`min-w-0` 避免撑爆）。拖拽时标签变 `opacity-60`、drop 指示条逻辑不受影响。

- [ ] **Step 3: 运行测试 + 类型检查**

  Run: `pnpm exec vue-tsc --noEmit 2>&1 | tail -5`
  Expected: PASS。

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/shell/TabBar.vue
  git commit -m "feat(ui): 标签栏增删与拖拽重排加水平滑动过渡"
  ```

---

## Task 6: 侧边栏面板切换 fade

**Files:**
- Modify: `src/app/shell/LeftSidebar.vue:107-135`
- Test: `src/app/shell/LeftSidebar.vue.test.ts`、`src/app/useLeftSidebar.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `.v2-fade-*` 类
- Produces: `SourceControlPanel` ↔ `WorkspaceBar` 切换时淡入淡出。

**注意：** 当前两个面板用 `v-show`（`v-show="activity === 'sourceControl'"`）。`<Transition>` 对 `v-show` 同样生效（Vue 对 v-show 的 transition 会用 opacity）。两个面板是同层兄弟、互斥显示，各包一个 `<Transition name="v2-fade" appear>`。

- [ ] **Step 1: 先读测试确认验证点**

  Run: `sed -n '1,40p' src/app/shell/LeftSidebar.vue.test.ts`
  了解测试如何切换 activity、断言显隐。

- [ ] **Step 2: 分别给两个面板包 Transition**

  编辑 `src/app/shell/LeftSidebar.vue:107-128`，把：
  ```html
  <div class="relative min-w-0 flex-1">
    <SourceControlPanel
      v-show="activity === 'sourceControl'"
      ...
    />
    <WorkspaceBar
      v-show="activity === 'workspace'"
      ...
    />
  ```
  改为（每个面板各包一层 `<Transition name="v2-fade">`，保留 v-show）：
  ```html
  <div class="relative min-w-0 flex-1">
    <Transition name="v2-fade">
    <SourceControlPanel
      v-show="activity === 'sourceControl'"
      ...
    />
    </Transition>
    <Transition name="v2-fade">
    <WorkspaceBar
      v-show="activity === 'workspace'"
      ...
    />
    </Transition>
  ```
  （其余 props/events 不变，只加 Transition 包裹。）

- [ ] **Step 3: 运行相关测试**

  Run: `pnpm test -- src/app/shell/LeftSidebar.vue.test.ts src/app/useLeftSidebar.test.ts`
  Expected: PASS。

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/shell/LeftSidebar.vue
  git commit -m "feat(ui): 侧边栏面板切换加 fade 过渡"
  ```

---

## Task 7: 分屏新增 opacity fade（禁用 transform）

**Files:**
- Modify: `src/modules/terminal/TerminalWorkspace.vue:40-52`
- Test: 无组件级测试；依赖手动验证 + 类型检查。

**Interfaces:**
- Consumes: Task 2 的 `.v2-fade-*` 类（纯 opacity，无 transform）
- Produces: 新分屏 leaf 出现时淡入。

**关键约束：** 分屏只用 opacity，**绝不用 transform scale**——transform 会触发 FitAddon 在尺寸未稳定时测量，复现 commit `8a6605e` 的 WSL zsh 崩溃。`.v2-fade-*` 是纯 opacity 过渡，符合要求。但 `TerminalWorkspace` 的根 `<div v-if="tree">` 在 tab 整体切换时才挂载，分屏是在已有 tree 内部增减 leaf（由 `TerminalTreeNode` 递归渲染）。因此真正需要包的是 **TerminalTreeNode 里 leaf 节点的挂载点**，而非 workspace 根。

- [ ] **Step 1: 检查 TerminalTreeNode 的 leaf 渲染结构**

  Run: `sed -n '1,80p' src/modules/terminal/TerminalTreeNode.vue`
  找到 leaf（非 split）节点渲染的元素与条件，确认在哪一层加 Transition 最合适（应是 `TerminalPane` 的包裹元素）。

- [ ] **Step 2: 在 leaf 挂载处包 opacity-only Transition**

  在 `TerminalTreeNode.vue` 中，给 leaf 分支的容器元素包 `<Transition name="v2-fade" appear>`（仅 opacity）。**不要**给 split 容器或 resizer 加 transform 动画。如果 leaf 容器本身就是条件渲染（v-if），直接外包 Transition；若是常驻，则跳过本任务（分屏靠 Pane 内部处理）。具体改法以 Step 1 看到的结构为准，原则：只加 `name="v2-fade"`，不引入任何 `scale`/`translate`。

- [ ] **Step 3: 类型检查**

  Run: `pnpm exec vue-tsc --noEmit 2>&1 | tail -5`
  Expected: PASS。

- [ ] **Step 4: Commit**

  ```bash
  git add src/modules/terminal/TerminalTreeNode.vue
  git commit -m "feat(ui): 新分屏 leaf 加纯 opacity 淡入（禁用 transform 避免 FitAddon 竞态）"
  ```

---

## Task 8: Monaco 按需加载——EditorPane / DiffEditor / MarkdownPreviewPane

**Files:**
- Modify: `src/app/shell/Workbench.vue:7`（EditorPane import + 使用处）
- Modify: `src/modules/editor/GitDiffPane.vue:6`（DiffEditor import）
- Modify: `src/modules/markdown/MarkdownStack.vue:4`（MarkdownPreviewPane import）
- Test: 依赖 `pnpm build` 验证 chunk 拆分；现有编辑器/Markdown 测试需通过。

**Interfaces:**
- Consumes: 无
- Produces: monaco chunk（~4MB）从主 bundle 移出，仅在首次打开编辑器/diff/markdown 标签时加载。`registerMonacoThemes` 仍随组件模块求值执行（idempotent，themes.ts 已有 `registered` 守卫）。

**关键事实（来自调研）：**
- 三个组件当前都是**静态 import**。
- `EditorPane.vue:2` 与 `DiffEditor.vue:2` 顶层 `import * as monaco`，并在 setup 顶层调用 `registerMonacoThemes(monaco)`（idempotent）。改成 `defineAsyncComponent` 后，这些模块求值（含 monaco 加载）推迟到首次渲染。
- `themes.ts:1`、`editorRuntime.ts:1`、`vim.ts:1` 是 eager value import，会自动随组件进入异步 chunk。
- `editorConfig.ts`、`editorPaneLsp.ts`、`lsp/manager.ts` 已是 `import type`，不受影响。

- [ ] **Step 1: Workbench.vue 中 EditorPane 改异步**

  编辑 `src/app/shell/Workbench.vue:7`，把：
  ```ts
  import EditorPane from "@/modules/editor/EditorPane.vue";
  ```
  改为：
  ```ts
  import { defineAsyncComponent } from "vue";
  const EditorPane = defineAsyncComponent(() => import("@/modules/editor/EditorPane.vue"));
  ```
  （`defineAsyncComponent` 若已被 auto-import，可省略 import；但显式 import 更安全。模板里 `<EditorPane>` 使用处 `Workbench.vue:312` 不变。）

- [ ] **Step 2: GitDiffPane.vue 中 DiffEditor 改异步**

  编辑 `src/modules/editor/GitDiffPane.vue:6`，把：
  ```ts
  import DiffEditor from "./DiffEditor.vue";
  ```
  改为：
  ```ts
  import { defineAsyncComponent } from "vue";
  const DiffEditor = defineAsyncComponent(() => import("./DiffEditor.vue"));
  ```

- [ ] **Step 3: MarkdownStack.vue 中 MarkdownPreviewPane 改异步**

  编辑 `src/modules/markdown/MarkdownStack.vue:4`，把：
  ```ts
  import MarkdownPreviewPane from "./MarkdownPreviewPane.vue";
  ```
  改为：
  ```ts
  import { defineAsyncComponent } from "vue";
  const MarkdownPreviewPane = defineAsyncComponent(() => import("./MarkdownPreviewPane.vue"));
  ```

- [ ] **Step 4: 运行类型检查 + 构建，确认 chunk 拆分**

  Run: `pnpm build`
  Expected: 构建成功。检查 `dist/assets/` 下：应出现独立的 editor/markdown 异步 chunk（如 `EditorPane-*.js` 或合并到 monaco 相关 chunk），且**主 `index-*.js` 体积较改前下降**（monaco 不再在主入口）。可用 `ls -la dist/assets/ | sort -k5 -n -r | head` 确认 monaco chunk 仍是独立大 chunk、且不随 index 预加载。

  Run: `pnpm test`（确认编辑器/markdown 相关测试仍通过；jsdom 下 defineAsyncComponent 同步返回，组件仍可 mount）
  Expected: 除 main 上两个已知失败用例外，全 PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/shell/Workbench.vue src/modules/editor/GitDiffPane.vue src/modules/markdown/MarkdownStack.vue
  git commit -m "perf(ui): Monaco 改 defineAsyncComponent 按需加载

  EditorPane/DiffEditor/MarkdownPreviewPane 三个静态 import 改异步，
  monaco chunk(~4MB) 移出冷启动主路径，首次打开编辑器标签时才加载。
  registerMonacoThemes 随组件模块求值执行（idempotent）。"
  ```

---

## Task 9: Git 历史提交列表虚拟化 + v-memo + 搜索 debounce + 加载骨架屏

**Files:**
- Modify: `src/modules/git-history/GitHistoryPane.vue`（`ROW_HEIGHT` 已存在 `:77`；列表 `:516-583`；`filteredCommits` `:143-154`；`search` `:452`；初始加载态 `:470-478`）
- Modify: `src/styles/globals.css` — 新增 `.v2-skeleton` 骨架样式（breathe 动画）。
- Test: 依赖现有 GitHistoryPane 测试（若有）+ 手动验证滚动。

**Interfaces:**
- Consumes: 无
- Produces: 提交列表 >阈值 时窗口化渲染，单行 `v-memo`，搜索输入 debounce ~120ms；初始加载用骨架屏替代 NSpin+文字。

**复用模式：** 模仿 `FileExplorer.vue:85-141` 的定高窗口化（`VIRTUAL_THRESHOLD`、`ROW_HEIGHT`、`VIRTUAL_OVERSCAN`、`virtualRange`、`virtualRows`、top/bottom padding、`onTreeScroll`、ResizeObserver）。`ROW_HEIGHT = 32`（GitHistoryPane `:77` 已定义，行高 `h-8`）。

**注意：** `graphRows` computed（`:131`）按 `commits` 全量计算，保持不变（超范围）；虚拟化只影响 `filteredCommits` 的 DOM 渲染范围。GraphRail 对不可见行不渲染——可接受（图表在滚动时按可见区重建，体感正常）。

- [ ] **Step 1: 确认是否有 GitHistoryPane 测试**

  Run: `ls src/modules/git-history/GitHistoryPane*.test.ts 2>/dev/null || echo NONE`

- [ ] **Step 2: 新增窗口化状态与计算**

  在 `GitHistoryPane.vue` `<script setup>` 中（`ROW_HEIGHT` 定义之后），仿 FileExplorer 加入：
  ```ts
  // ── Virtual scroll window（定高 32px，复用 FileExplorer 模式）──
  const VIRTUAL_THRESHOLD = 200;
  const VIRTUAL_OVERSCAN = 6;
  const listScrollEl = ref<HTMLElement | null>(null);
  const listScrollTop = ref(0);
  const listViewportH = ref(0);
  let listRO: ResizeObserver | null = null;

  const filteredAll = computed(() => filteredCommits.value);
  const virtualRange = computed(() => {
    const total = filteredAll.value.length;
    if (total < VIRTUAL_THRESHOLD) return { start: 0, end: total, virtual: false };
    const start = Math.max(0, Math.floor(listScrollTop.value / ROW_HEIGHT) - VIRTUAL_OVERSCAN);
    const end = Math.min(total, start + Math.ceil(listViewportH.value / ROW_HEIGHT) + VIRTUAL_OVERSCAN * 2);
    return { start, end, virtual: true };
  });
  const visibleCommits = computed(() => {
    const { start, end } = virtualRange.value;
    return filteredAll.value.slice(start, end);
  });
  const topPad = computed(() => (virtualRange.value.virtual ? virtualRange.value.start * ROW_HEIGHT : 0));
  const bottomPad = computed(() =>
    virtualRange.value.virtual
      ? Math.max(0, (filteredAll.value.length - virtualRange.value.end) * ROW_HEIGHT)
      : 0,
  );
  function onListScroll(e: Event) {
    listScrollTop.value = (e.target as HTMLElement).scrollTop;
  }
  watch(listScrollEl, (el, prev) => {
    if (prev) listRO?.unobserve(prev);
    listRO?.disconnect();
    listRO = null;
    if (el && typeof ResizeObserver === "function") {
      listRO = new ResizeObserver((entries) => {
        for (const entry of entries) listViewportH.value = entry.contentRect.height;
      });
      listRO.observe(el);
      listViewportH.value = el.clientHeight;
    }
  }, { flush: "post" });
  ```
  并给 `filteredCommits` 的 `search` 输入加 debounce：新增一个 `debouncedSearch = ref("")`，watch `search` 用 120ms setTimeout 写入 `debouncedSearch`，`filteredCommits` 改为基于 `debouncedSearch.value` 计算（替换原 `activeSearch` 读 `search.value`）。

- [ ] **Step 3: 改模板列表渲染**

  编辑 `:516-583`，把滚动容器 `:516` 的 `<div class="min-h-0 min-w-0 flex-1 overflow-auto">` 加 `ref="listScrollEl" @scroll.passive="onListScroll"`。把内层 `v-for="commit in filteredCommits"` 改为 `v-for="commit in visibleCommits"`，并在列表前后各加一个高度占位 div：
  ```html
  <div ref="listScrollEl" class="min-h-0 min-w-0 flex-1 overflow-auto" @scroll.passive="onListScroll">
    <div v-if="topPad" :style="{ height: `${topPad}px` }" aria-hidden="true" />
    <button
      v-for="commit in visibleCommits"
      :key="commit.sha"
      v-memo="[commit.sha, selectedSha === commit.sha, graphRows.byCommit.get(commit.sha) !== undefined]"
      ...
    >
    ...
    </button>
    <div v-if="bottomPad" :style="{ height: `${bottomPad}px` }" aria-hidden="true" />
  </div>
  ```

- [ ] **Step 4: 新增骨架样式并替换初始加载态**

  在 `globals.css`（`.v2-anim-*` 附近）新增：
  ```css
  /* 骨架屏：breathe 闪烁，复用 token 被 reduced-motion 覆盖 */
  .v2-skeleton {
    background: linear-gradient(
      90deg,
      var(--muted) 0%,
      color-mix(in srgb, var(--muted) 60%, transparent) 50%,
      var(--muted) 100%
    );
    background-size: 200% 100%;
    animation: v2-skeleton-shimmer 1.6s var(--ease-out) infinite;
    border-radius: 4px;
  }
  @keyframes v2-skeleton-shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  ```
  然后把 `GitHistoryPane.vue:470-478` 的初始加载态（`<NSpin/>` + `loadingCommits` 文字）替换为骨架行：渲染 8 个 `ROW_HEIGHT` 高的 `.v2-skeleton` 占位行（用 `v-for="n in 8"`），替代 NSpin。骨架仅在 `loadStatus === 'initial' && commits.length === 0` 时显示（条件不变）。

- [ ] **Step 5: 类型检查 + 测试**

  Run: `pnpm exec vue-tsc --noEmit 2>&1 | tail -5` → PASS
  Run: `pnpm test` → 除已知两失败外全 PASS。

- [ ] **Step 6: Commit**

  ```bash
  git add src/modules/git-history/GitHistoryPane.vue src/styles/globals.css
  git commit -m "perf(git-history): 提交列表定高虚拟化 + v-memo + 搜索 debounce + 骨架屏

  复用 FileExplorer 的 200 行阈值窗口化模式，单行加 v-memo 避免重渲，
  搜索输入 120ms debounce 避免每次按键全量重过滤；初始加载用骨架屏替代 NSpin。"
  ```

---

## Task 10: 文件树加载骨架屏

**Files:**
- Modify: `src/modules/explorer/FileExplorer.vue:840-846`（根加载态）
- Test: 依赖现有 `FileExplorer.vue.test.ts`（注意 main 上该测试有已知失败，本任务改动不应新增失败）。

**Interfaces:**
- Consumes: Task 9 Step 4 新增的 `.v2-skeleton` 样式
- Produces: 文件树根加载时显示骨架行，替代 NSpin+文字。

- [ ] **Step 1: 替换根加载态为骨架行**

  编辑 `FileExplorer.vue:840-846`，把：
  ```html
  <div
    v-if="rootState?.status === 'loading'"
    class="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground"
  >
    <NSpin size="small" />
    <span>{{ t("explorer.loading") }}</span>
  </div>
  ```
  改为渲染 ~10 行骨架（行高 24px，对齐 FileTreeRow 的 `h-6`）：
  ```html
  <div v-if="rootState?.status === 'loading'" class="px-1.5 py-1" aria-busy="true">
    <div
      v-for="n in 10"
      :key="n"
      class="v2-skeleton m-0.5 h-6 w-full"
    />
  </div>
  ```
  若 `NSpin` 在本文件其他位置仍被使用则保留 import；若不再使用，从 `:8` 的 import 中移除 `NSpin`（类型检查会提示）。

- [ ] **Step 2: 类型检查 + 测试**

  Run: `pnpm exec vue-tsc --noEmit 2>&1 | tail -5` → PASS
  Run: `pnpm test -- src/modules/explorer/FileExplorer.vue.test.ts` → 仅 main 已知那一条失败，无新增失败。

- [ ] **Step 3: Commit**

  ```bash
  git add src/modules/explorer/FileExplorer.vue
  git commit -m "feat(explorer): 文件树根加载用骨架屏替代 NSpin"
  ```

---

## Task 11: FindInFiles 结果分页（先渲染上限 + 触底加载）

**Files:**
- Modify: `src/modules/search/FindInFilesPanel.vue:149-171`（结果滚动区）
- Test: 依赖手动验证 + 类型检查。

**Interfaces:**
- Consumes: 无
- Produces: 结果按「先渲染 N 组 + 滚动到底加载更多 N 组」分页，避免大范围 grep 一次渲染上千行。

**方案选择：** FindInFiles 的命中行高度不一（行文本长度差异），定高窗口化不可靠。用分页回退：维护 `renderedGroupCount`，初始渲染前 N 组，滚动接近底部时 `+= N`。

- [ ] **Step 1: 新增分页状态**

  在 `FindInFilesPanel.vue` `<script setup>` 加：
  ```ts
  const INITIAL_GROUPS = 40;
  const LOAD_STEP = 40;
  const renderedGroups = ref(INITIAL_GROUPS);
  const visibleGroups = computed(() => groupedHits.value.slice(0, renderedGroups.value));
  const hasMoreGroups = computed(() => renderedGroups.value < groupedHits.value.length);

  function onResultsScroll(e: Event) {
    const el = e.target as HTMLElement;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 120 && hasMoreGroups.value) {
      renderedGroups.value += LOAD_STEP;
    }
  }
  // 结果变化时重置分页
  watch(groupedHits, () => { renderedGroups.value = INITIAL_GROUPS; });
  ```

- [ ] **Step 2: 改模板渲染 + 滚动监听**

  编辑 `:149-171`，把：
  ```html
  <div class="min-h-0 flex-1 overflow-y-auto py-1">
    <div
      v-for="group in groupedHits"
      ...
    >
  ```
  改为：
  ```html
  <div class="min-h-0 flex-1 overflow-y-auto py-1" @scroll.passive="onResultsScroll">
    <div
      v-for="group in visibleGroups"
      ...
    >
  ```
  在列表末尾、容器闭合前，加「加载更多」提示：
  ```html
  <div v-if="hasMoreGroups" class="px-3 py-2 text-[10px] text-muted-foreground">
    {{ t("findInFiles.scrollForMore") }}
  </div>
  ```

- [ ] **Step 3: 补 i18n key**

  Run: `grep -rn "findInFiles" src/modules/i18n/locales/ | head`
  在 `zh-CN` 与 `en-US` 的 `findInFiles` 对象各加 `"scrollForMore"`：zh `"滚动加载更多结果"`，en `"Scroll for more results"`。

- [ ] **Step 4: 类型检查 + 测试**

  Run: `pnpm exec vue-tsc --noEmit 2>&1 | tail -5` → PASS
  Run: `pnpm test` → 除已知两失败外全 PASS。

- [ ] **Step 5: Commit**

  ```bash
  git add src/modules/search/FindInFilesPanel.vue src/modules/i18n/
  git commit -m "perf(search): FindInFiles 结果分页渲染，滚动触底加载更多

  大范围 grep 不再一次渲染上千行；初始 40 组，触底再加载 40 组。"
  ```

---

## Task 12: 拖拽 ghost / resizer 的 will-change 瞬态提示

**Files:**
- Modify: `src/app/shell/TabBar.vue`（拖拽开始/结束时给 ghost 加 `will-change: transform`）
- Modify: `src/modules/terminal/TerminalResizer.vue`（拖拽期间加 will-change）

**Interfaces:**
- Consumes: 无
- Produces: 交互进行时 GPU 提示，结束即移除，减少 paint 抖动。

**注意：** will-change 只在交互期间加，避免常驻占用内存。ghost 已是 `v-if="dragGhost"`，离开 DOM 即销毁，天然无需手动清除；但显式声明可让浏览器提前为 transform 升层。resizer 拖拽有明确 start/end。

- [ ] **Step 1: TabBar ghost 加 will-change**

  在 `TabBar.vue` 模板 ghost div（`:352-358`）的 `:style` 已有 transform；在 class 中加 `will-change-transform`（Tailwind 类，编译为 `will-change: transform`）。ghost 仅拖拽时存在，无需清除逻辑。
  ```html
  class="v2-glass-float will-change-transform pointer-events-none fixed ..."
  ```

- [ ] **Step 2: TerminalResizer 拖拽期间加 will-change**

  Run: `sed -n '1,60p' src/modules/terminal/TerminalResizer.vue` 找到 `dragging` 状态。
  在 resizer 把手元素的 class 上，用 `:class="dragging ? 'will-change-transform' : ''"` 绑定（dragging 是组件内 ref），拖拽结束自动移除。

- [ ] **Step 3: 类型检查**

  Run: `pnpm exec vue-tsc --noEmit 2>&1 | tail -5` → PASS

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/shell/TabBar.vue src/modules/terminal/TerminalResizer.vue
  git commit -m "perf(ui): 拖拽 ghost 与 resizer 加瞬态 will-change: transform"
  ```

---

## Task 13: 全量验证 + 完成检查

**Files:** 无（验证任务）

- [ ] **Step 1: 全量测试**

  Run: `pnpm test`
  Expected: 除 main 上已知两失败（FileExplorer git tones、SourceControlPanel fetch/pull/push）外全 PASS。

- [ ] **Step 2: 类型检查 + 构建**

  Run: `pnpm build`
  Expected: `vue-tsc --noEmit` PASS，Vite 构建成功，无新增 warning。

- [ ] **Step 3: 确认 chunk 拆分效果**

  Run: `ls -la dist/assets/ | sort -k5 -n -r | head -8`
  Expected: monaco chunk 仍是独立大 chunk，主 `index` chunk 较改动前变小。

- [ ] **Step 4: 手动验证动效（如可运行 tauri dev）**

  逐项确认：命令面板开关、标签右键菜单、标签增删/拖拽、侧栏切换、新分屏淡入，均有过渡且 `prefers-reduced-motion` 下降为 ~1ms。

- [ ] **Step 5: 最终 commit（如有遗留改动）**

  若前序 commit 已覆盖所有改动，本步跳过；否则收尾 commit。
