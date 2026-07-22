# Windows WSL 工作区入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows 工作区栏和欢迎页提供显式 WSL 工作区入口，并保证所选 `WorkspaceEnv` 完整传递到目录选择与授权流程。

**Architecture:** 新增 `WorkspaceAddControl.vue` 封装本机按钮和 WSL 发行版菜单，并在图标/嵌入两种工作区栏布局间复用。所有 `add-workspace` 与 `chooseWorkspace` 事件改为显式携带 `WorkspaceEnv`，`MainApp` 仅负责调用既有 `startAddWorkspace(env)`，不新增全局状态或路径猜测。

**Tech Stack:** Vue 3、TypeScript、Pinia、Naive UI、Vitest、Vue Test Utils

---

### Task 1: 工作区添加控件

**Files:**
- Create: `src/app/components/WorkspaceAddControl.vue`
- Create: `src/app/components/WorkspaceAddControl.vue.test.ts`
- Modify: `src/modules/i18n/locales/zh-CN.ts`
- Modify: `src/modules/i18n/locales/en-US.ts`

- [x] **Step 1: 写出控件失败测试**

新增测试，模拟 Windows 平台和 Naive UI 下拉菜单，断言：本机按钮发出 `LOCAL_WORKSPACE`；有发行版时显示 WSL 入口；选择 `Ubuntu` 发出 `{ kind: "wsl", distro: "Ubuntu" }`；发行版列表为空时隐藏 WSL 入口。

```ts
await wrapper.find("[data-add-workspace-local]").trigger("click");
expect(wrapper.emitted("addWorkspace")).toEqual([[LOCAL_WORKSPACE]]);

await wrapper.find("[data-wsl-option='Ubuntu']").trigger("click");
expect(wrapper.emitted("addWorkspace")?.at(-1)).toEqual([
  { kind: "wsl", distro: "Ubuntu" },
]);
```

- [x] **Step 2: 运行测试并确认因组件不存在而失败**

Run: `pnpm exec vitest run src/app/components/WorkspaceAddControl.vue.test.ts`

Expected: FAIL，提示无法解析 `WorkspaceAddControl.vue`。

- [x] **Step 3: 实现最小控件与文案**

组件读取 `useWorkspaceEnvPiniaStore().distros`，以 `IS_WINDOWS && distros.length > 0` 控制 WSL 菜单。`embedded=false` 渲染图标按钮，`embedded=true` 渲染侧栏命令行；所有动作只发出显式环境。

```ts
const emit = defineEmits<{
  addWorkspace: [env: WorkspaceEnv];
}>();

function addWslWorkspace(key: string | number): void {
  emit("addWorkspace", { kind: "wsl", distro: String(key) });
}
```

新增 `app.workspaceBar.addLocal` 和 `app.workspaceBar.addWsl` 中英文文案。

- [x] **Step 4: 运行控件测试并确认通过**

Run: `pnpm exec vitest run src/app/components/WorkspaceAddControl.vue.test.ts`

Expected: PASS。

### Task 2: 工作区栏事件链

**Files:**
- Modify: `src/app/shell/WorkspaceBar.vue`
- Modify: `src/app/shell/TitleBar.vue`
- Modify: `src/app/shell/ActivityIcons.vue`
- Modify: `src/app/shell/LeftSidebar.vue`
- Modify: `src/app/shell/WorkspaceHost.vue`
- Modify: `src/app/shell/ActivityIcons.vue.test.ts`
- Modify: `src/app/shell/LeftSidebar.vue.test.ts`

- [x] **Step 1: 写出事件参数失败测试**

更新 stub 和断言，使活动栏本机入口必须发出 `LOCAL_WORKSPACE`，左侧栏必须原样转发 WSL 环境。

```ts
expect(wrapper.emitted("add-workspace")).toEqual([[LOCAL_WORKSPACE]]);

expect(wrapper.emitted("add-workspace")).toEqual([
  [{ kind: "wsl", distro: "Ubuntu" }],
]);
```

- [x] **Step 2: 运行测试并确认旧的无参数事件导致失败**

Run: `pnpm exec vitest run src/app/shell/ActivityIcons.vue.test.ts src/app/shell/LeftSidebar.vue.test.ts`

Expected: FAIL，收到空参数数组。

- [x] **Step 3: 接入控件并统一事件契约**

`WorkspaceBar` 使用 `WorkspaceAddControl` 替换两套重复添加按钮；`TitleBar`、`LeftSidebar`、`WorkspaceHost` 的事件声明和转发全部改为 `[env: WorkspaceEnv]`。`ActivityIcons` 的旧“+”明确发出 `LOCAL_WORKSPACE`。

```ts
const emit = defineEmits<{
  "add-workspace": [env: WorkspaceEnv];
}>();
```

- [x] **Step 4: 运行事件链测试并确认通过**

Run: `pnpm exec vitest run src/app/components/WorkspaceAddControl.vue.test.ts src/app/shell/ActivityIcons.vue.test.ts src/app/shell/LeftSidebar.vue.test.ts`

Expected: PASS。

### Task 3: 欢迎页与 MainApp 行为

**Files:**
- Modify: `src/app/components/WorkspaceWelcome.vue`
- Modify: `src/app/components/WorkspaceWelcome.vue.test.ts`
- Modify: `src/app/MainApp.vue`
- Modify: `src/app/MainApp.vue.test.ts`

- [x] **Step 1: 写出欢迎页和 MainApp 失败测试**

欢迎页测试要求本机/WSL 快捷按钮直接发出带环境的 `chooseWorkspace`；MainApp stub 增加 WSL 添加动作，并断言目录选择器收到明确的 WSL 发行版。

```ts
expect(wrapper.emitted("chooseWorkspace")).toEqual([
  [{ kind: "wsl", distro: "Ubuntu-22.04" }],
]);

expect(workspaceRoot.pickWorkspaceDirectory).toHaveBeenCalledWith({
  kind: "wsl",
  distro: "Ubuntu",
});
```

- [x] **Step 2: 运行测试并确认旧行为失败**

Run: `pnpm exec vitest run src/app/components/WorkspaceWelcome.vue.test.ts src/app/MainApp.vue.test.ts`

Expected: FAIL，欢迎页仍发出 `workspaceEnvChange`，MainApp 添加事件未传递 WSL 环境。

- [x] **Step 3: 实现显式环境打开流程**

`WorkspaceWelcome` 的 `chooseWorkspace` 事件携带 `WorkspaceEnv`：主按钮使用当前 `pendingEnv`，本机/WSL 快捷按钮直接携带各自环境。`MainApp.chooseWorkspaceFromWelcome(env)` 和标题栏/WorkspaceHost 监听器直接调用 `startAddWorkspace(env)`。

```ts
async function chooseWorkspaceFromWelcome(env: WorkspaceEnv) {
  await startAddWorkspace(env);
}
```

- [x] **Step 4: 运行聚焦测试并确认通过**

Run: `pnpm exec vitest run src/app/components/WorkspaceAddControl.vue.test.ts src/app/components/WorkspaceWelcome.vue.test.ts src/app/shell/ActivityIcons.vue.test.ts src/app/shell/LeftSidebar.vue.test.ts src/app/MainApp.vue.test.ts`

Expected: PASS。

### Task 4: 完整验证与提交

**Files:**
- Verify: all modified files

- [x] **Step 1: 运行完整前端测试**

Run: `pnpm test`

Expected: 除项目文档记录的两个 main 既有失败外，无新增失败；如基线当前已修复，则全部通过。

- [x] **Step 2: 运行生产构建**

Run: `pnpm build`

Expected: `vue-tsc --noEmit` 与 Vite build 均成功。

- [x] **Step 3: 检查变更质量**

Run: `git diff --check && git status --short`

Expected: 无空白错误，状态仅包含计划内文件。

- [x] **Step 4: 提交功能变更**

```bash
git add docs/superpowers/plans/2026-07-22-wsl-workspace-entry.md \
  src/app/components/WorkspaceAddControl.vue \
  src/app/components/WorkspaceAddControl.vue.test.ts \
  src/app/components/WorkspaceWelcome.vue \
  src/app/components/WorkspaceWelcome.vue.test.ts \
  src/app/shell/WorkspaceBar.vue \
  src/app/shell/TitleBar.vue \
  src/app/shell/ActivityIcons.vue \
  src/app/shell/ActivityIcons.vue.test.ts \
  src/app/shell/LeftSidebar.vue \
  src/app/shell/LeftSidebar.vue.test.ts \
  src/app/shell/WorkspaceHost.vue \
  src/app/MainApp.vue \
  src/app/MainApp.vue.test.ts \
  src/modules/i18n/locales/zh-CN.ts \
  src/modules/i18n/locales/en-US.ts
git commit -m "fix(workspace): 增加 Windows WSL 工作区入口"
```
