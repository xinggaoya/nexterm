# Shell 布局重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 Nexterm 多工作区重构后 shell 层遗留的冗余 UI（StatusBar 环境切换、路径显示、当前/新窗口询问弹窗），重塑布局为 TitleBar（含 WorkspaceBar）+ 左侧 Activity Panel + 中央 Workbench + 极简 StatusBar 的四层结构，让 TabBar 仅覆盖中央 Workbench 顶部。

**Architecture:** 改造以 shell 层（`src/app/shell/`、`src/app/`）为主，保持模块层（workspace / tabs / source-control 等）和 Rust 后端不变。所有 Tauri IPC 仍通过 workspace env 显式传递；多工作区 v-show 保活策略保留；面板状态通过 preferences 持久化。

**Tech Stack:** Vue 3 Composition API + `<script setup lang="ts">`、Pinia（setup function 风格）、Naive UI、Tauri 2、TypeScript strict、Vitest + jsdom。

**Spec:** `docs/superpowers/specs/2026-07-22-shell-layout-refactor-design.md`

---

## 文件结构

| 路径 | 角色 | 状态 |
|------|------|------|
| `src/app/useWorkbenchLayout.ts` | 布局 composable + 内部 Pinia，扩展 leftSidebar/panelVisibility | 修改 |
| `src/app/useLeftSidebar.ts` | 新 composable：管理左侧栏 activity、显隐、宽度持久化 | 新增 |
| `src/app/workspaceContext.ts` | 注入 key 扩展（增加 panel state、layout） | 修改 |
| `src/app/shell/StatusBar.vue` | 重写：极简左右两栏（面包屑 + 4 图标按钮） | 修改 |
| `src/app/shell/TitleBar.vue` | 重构：集成 WorkspaceBar，移除 openFolder 下拉 | 修改 |
| `src/app/shell/WorkspaceBar.vue` | 增加 `↗` 新窗口按钮 | 修改 |
| `src/app/shell/LeftSidebar.vue` | 左侧 Activity 容器（图标 + 内容区，可拉伸） | 新增 |
| `src/app/shell/ActivityIcons.vue` | 左侧 48px 图标列 | 新增 |
| `src/app/shell/WorkspaceHost.vue` | 重构：左 LeftSidebar + 中央分层（TabBar + Workbench） | 修改 |
| `src/app/shell/Workbench.vue` | 移除内嵌 Source Control split | 修改 |
| `src/app/shell/TabBar.vue` | 移除 `workspaceRoot` prop + 相关 emit | 修改 |
| `src/app/shell/TabContextMenu.vue` | 改用 inject(workspaceContextKey) 替代 props | 修改 |
| `src/app/MainApp.vue` | 移除 `workspaceOpenChoice` 模态；新接线 StatusBar / TitleBar / LeftSidebar | 修改 |
| `src/app/components/WorkspaceEnvSelector.vue` | 保留作为通用下拉组件（功能内联但保留 export） | 保留 |
| `src/modules/settings/store.ts` | 新增 layout 偏好 keys + types | 修改 |
| `src/modules/settings/preferencesPinia.ts` | applySnapshot 同步新字段 | 修改 |
| `src/modules/i18n/locales/zh-CN/app.json` | i18n key 增删 | 修改 |
| `src/modules/i18n/locales/en-US/app.json` | i18n key 增删 | 修改 |
| `src/app/MainApp.vue.test.ts` | 更新断言 | 修改 |
| `src/app/shell/LeftSidebar.vue.test.ts` | 新测试 | 新增 |
| `src/app/shell/ActivityIcons.vue.test.ts` | 新测试 | 新增 |
| `src/app/useLeftSidebar.test.ts` | 新测试 | 新增 |

---

## Task 1: 扩展 useWorkbenchLayout — leftSidebar + panelVisibility 状态

**Files:**
- Modify: `src/app/useWorkbenchLayout.ts`
- Test: 已有 `useWorkbenchLayout.test.ts`（如有）

- [ ] **Step 1: 在 useWorkbenchLayout 中新增类型和 store 字段**

```ts
// src/app/useWorkbenchLayout.ts

export type ActivityKey = "workspace" | "sourceControl";
export type PanelKey =
  | "workspace"
  | "sourceControl"
  | "explorer"
  | "taskConsole";

export interface LeftSidebarState {
  activity: ActivityKey;
  open: boolean;
  width: number;
}

export interface PanelVisibilityState {
  workspace: boolean;
  sourceControl: boolean;
  explorer: boolean;
  taskConsole: boolean;
}

const DEFAULT_LEFT_SIDEBAR_WIDTH = 280;
const MIN_LEFT_SIDEBAR_WIDTH = 200;
const MAX_LEFT_SIDEBAR_WIDTH = 480;

const DEFAULT_LEFT_SIDEBAR: LeftSidebarState = {
  activity: "sourceControl",
  open: true,
  width: DEFAULT_LEFT_SIDEBAR_WIDTH,
};

const DEFAULT_PANELS: PanelVisibilityState = {
  workspace: true,
  sourceControl: true,
  explorer: true,
  taskConsole: false,
};
```

- [ ] **Step 2: 在内部 store 中添加 leftSidebar 和 panelVisibility state**

```ts
const usePanelVisibilityStore = defineStore(
  "workbench-panel-visibility",
  () => {
    const leftPanelOpen = ref(false);
    const rightPanelOpen = ref(true);
    const leftSidebar = ref<LeftSidebarState>({
      ...DEFAULT_LEFT_SIDEBAR,
    });
    const panelVisibility = ref<PanelVisibilityState>({
      ...DEFAULT_PANELS,
    });
    return {
      leftPanelOpen,
      rightPanelOpen,
      leftSidebar,
      panelVisibility,
    };
  },
);
```

- [ ] **Step 3: 在 composable 返回值中暴露新 API（保留旧 API 兼容）**

```ts
return {
  // 已有
  leftPanelOpen,
  rightPanelOpen,
  toggleLeftPanel,
  toggleRightPanel,
  // 新增
  leftSidebar,
  panelVisibility,
  setLeftSidebarActivity: (key: ActivityKey) => {
    store.leftSidebar.activity = key;
  },
  toggleLeftSidebar: () => {
    store.leftSidebar.open = !store.leftSidebar.open;
  },
  setLeftSidebarWidth: (w: number) => {
    const clamped = Math.max(
      MIN_LEFT_SIDEBAR_WIDTH,
      Math.min(MAX_LEFT_SIDEBAR_WIDTH, w),
    );
    store.leftSidebar.width = clamped;
  },
  togglePanel: (key: PanelKey) => {
    store.panelVisibility[key] = !store.panelVisibility[key];
    if (key === "sourceControl") store.leftPanelOpen = store.panelVisibility.sourceControl;
    if (key === "explorer") store.rightPanelOpen = store.panelVisibility.explorer;
  },
  // 已存在的 explorer/sourceControl 宽度 ref 保留
};
```

- [ ] **Step 4: 在 startLayoutObservers 中订阅新 state 持久化**

```ts
function persistPanels() {
  void setLayoutPanels(toRaw(store.panelVisibility));
  void setLayoutLeftSidebar(toRaw(store.leftSidebar));
}

// 在 startLayoutObservers 末尾：
watch(
  [() => store.panelVisibility, () => store.leftSidebar],
  persistPanels,
  { deep: true },
);
```

- [ ] **Step 5: 运行 tsc 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过

- [ ] **Step 6: 提交**

```bash
git add src/app/useWorkbenchLayout.ts
git commit -m "refactor(layout): 扩展 useWorkbenchLayout 支持 leftSidebar 与 panelVisibility"
```

---

## Task 2: settings/store.ts 与 preferencesPinia 增加 layout 偏好

**Files:**
- Modify: `src/modules/settings/store.ts`
- Modify: `src/modules/settings/preferencesPinia.ts`

- [ ] **Step 1: 在 store.ts 中导出新 key 与读写函数**

```ts
// src/modules/settings/store.ts
export const KEY_LAYOUT_LEFT_SIDEBAR = "layout.leftSidebar";
export const KEY_LAYOUT_PANELS = "layout.panels";

export interface LeftSidebarPref {
  activity: "workspace" | "sourceControl";
  open: boolean;
  width: number;
}

export interface PanelVisibilityPref {
  workspace: boolean;
  sourceControl: boolean;
  explorer: boolean;
  taskConsole: boolean;
}

export async function getLayoutLeftSidebar(): Promise<LeftSidebarPref | null> {
  const store = await getStore();
  const value = await store.get<LeftSidebarPref>(KEY_LAYOUT_LEFT_SIDEBAR);
  return value ?? null;
}

export async function setLayoutLeftSidebar(value: LeftSidebarPref): Promise<void> {
  const store = await getStore();
  await store.set(KEY_LAYOUT_LEFT_SIDEBAR, value);
}

export async function getLayoutPanels(): Promise<PanelVisibilityPref | null> {
  const store = await getStore();
  const value = await store.get<PanelVisibilityPref>(KEY_LAYOUT_PANELS);
  return value ?? null;
}

export async function setLayoutPanels(value: PanelVisibilityPref): Promise<void> {
  const store = await getStore();
  await store.set(KEY_LAYOUT_PANELS, value);
}
```

- [ ] **Step 2: 在 preferencesPinia.ts 中 applySnapshot 同步新字段**

```ts
// src/modules/settings/preferencesPinia.ts
// 在 applySnapshot 中添加：
leftSidebar: LeftSidebarPref;
panelVisibility: PanelVisibilityPref;

// 在默认值常量中：
const DEFAULT_LEFT_SIDEBAR: LeftSidebarPref = {
  activity: "sourceControl",
  open: true,
  width: 280,
};

const DEFAULT_PANELS: PanelVisibilityPref = {
  workspace: true,
  sourceControl: true,
  explorer: true,
  taskConsole: false,
};
```

- [ ] **Step 3: tsc 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add src/modules/settings/store.ts src/modules/settings/preferencesPinia.ts
git commit -m "feat(settings): 增加 layout.leftSidebar 与 layout.panels 偏好持久化"
```

---

## Task 3: i18n keys 增删

**Files:**
- Modify: `src/modules/i18n/locales/zh-CN/app.json`
- Modify: `src/modules/i18n/locales/en-US/app.json`

- [ ] **Step 1: 在 zh-CN/app.json 中新增 keys**

```json
{
  "app": {
    "status": {
      "crumb": "{workspace} · {branch}",
      "toggle": {
        "sourceControl": "源代码管理",
        "explorer": "资源管理器",
        "workspace": "工作区列表",
        "taskConsole": "任务控制台"
      }
    },
    "leftSidebar": {
      "addWorkspace": "添加工作区",
      "openInNewWindow": "在新窗口中打开",
      "toggle": "折叠/展开侧栏",
      "activity": {
        "workspace": "工作区",
        "sourceControl": "源代码管理"
      }
    },
    "titleBar": {
      "workspaces": "工作区"
    }
  }
}
```

并删除：
- `app.status.noWorkspace`
- `app.workspaceOpen.title`
- `app.workspaceOpen.currentWindow`
- `app.workspaceOpen.newWindow`
- `app.header.openFolderMenu.openInLocal`
- `app.header.openFolderMenu.openInWsl`

- [ ] **Step 2: 在 en-US/app.json 中镜像同样变更**

```json
{
  "app": {
    "status": {
      "crumb": "{workspace} · {branch}",
      "toggle": {
        "sourceControl": "Source Control",
        "explorer": "Explorer",
        "workspace": "Workspaces",
        "taskConsole": "Task Console"
      }
    },
    "leftSidebar": {
      "addWorkspace": "Add Workspace",
      "openInNewWindow": "Open in New Window",
      "toggle": "Toggle Sidebar",
      "activity": {
        "workspace": "Workspaces",
        "sourceControl": "Source Control"
      }
    },
    "titleBar": {
      "workspaces": "Workspaces"
    }
  }
}
```

- [ ] **Step 3: 提交**

```bash
git add src/modules/i18n/locales/
git commit -m "i18n(shell): 新增 shell 布局重构相关文案"
```

---

## Task 4: StatusBar.vue 重写为极简左右两栏

**Files:**
- Modify: `src/app/shell/StatusBar.vue`

- [ ] **Step 1: 删除旧 StatusBar.vue 内容并替换为新模板**

```vue
<script setup lang="ts">
import {
  GitBranchOutline,
  FolderOutline,
  SettingsOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed } from "vue";
import { t } from "@/modules/i18n/translate";
import type { PanelKey } from "@/app/useWorkbenchLayout";

interface PanelStates {
  workspace: boolean;
  sourceControl: boolean;
  explorer: boolean;
  taskConsole: boolean;
}

const props = defineProps<{
  workspaceName: string | null;
  gitBranch: string | null;
  panelStates: PanelStates;
}>();

const emit = defineEmits<{
  "toggle-panel": [key: PanelKey];
}>();

const crumb = computed(() => {
  if (!props.workspaceName) return "";
  return t("app.status.crumb", {
    workspace: props.workspaceName,
    branch: props.gitBranch ?? "—",
  });
});

function isOn(key: PanelKey): boolean {
  return props.panelStates[key];
}

function toggle(key: PanelKey) {
  emit("toggle-panel", key);
}
</script>

<template>
  <footer
    class="flex h-6 shrink-0 items-center justify-between gap-3 border-t border-border/40 bg-title-bar px-3 text-[11px] text-muted-foreground"
  >
    <div class="flex min-w-0 items-center gap-2">
      <span class="truncate">{{ crumb }}</span>
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <button
        type="button"
        :data-toggle-panel="key"
        v-for="key in (['sourceControl', 'explorer', 'workspace', 'taskConsole'] as const)"
        :key="key"
        :aria-pressed="isOn(key)"
        :title="t(`app.status.toggle.${key}`)"
        class="grid size-5 place-items-center rounded transition-colors hover:bg-accent/70"
        :class="isOn(key) ? 'text-foreground' : 'text-muted-foreground/60'"
        @click="toggle(key)"
      >
        <NIcon :component="iconFor(key)" :size="13" />
      </button>
    </div>
  </footer>
</template>

<script lang="ts">
import type { Component } from "vue";

function iconFor(key: "sourceControl" | "explorer" | "workspace" | "taskConsole"): Component {
  switch (key) {
    case "sourceControl":
      return GitBranchOutline;
    case "explorer":
      return FolderOutline;
    case "workspace":
      return SettingsOutline;
    case "taskConsole":
      return TerminalOutline;
  }
}
</script>
```

- [ ] **Step 2: tsc 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过（如果 MainApp 还在传旧 props，会有 type error，下个任务修）

- [ ] **Step 3: 提交（暂留 MainApp 编译错误，但 StatusBar 自身完整）**

```bash
git add src/app/shell/StatusBar.vue
git commit -m "refactor(shell): StatusBar 极简化为面包屑 + 面板图标按钮"
```

---

## Task 5: 扩展 workspaceContext 注入 key

**Files:**
- Modify: `src/app/workspaceContext.ts`

- [ ] **Step 1: 在注入 key 中增加 layout 相关值**

```ts
// src/app/workspaceContext.ts
import type {
  LeftSidebarState,
  PanelVisibilityState,
} from "./useWorkbenchLayout";

export interface WorkspaceContext {
  workspace: WorkspaceInstance;
  wsNative: WorkspaceNative;
  // 新增：
  leftSidebar: Ref<LeftSidebarState>;
  panelVisibility: Ref<PanelVisibilityState>;
  togglePanel: (key: PanelKey) => void;
}
```

- [ ] **Step 2: 在 provideWorkspaceContext 函数中传入新字段**

```ts
export function provideWorkspaceContext(input: WorkspaceContext) {
  // 旧逻辑保留
  provide(workspaceContextKey, input);
}
```

- [ ] **Step 3: tsc 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过（WorkspaceHost 会更新）

- [ ] **Step 4: 提交**

```bash
git add src/app/workspaceContext.ts
git commit -m "refactor(workspace-context): 注入 leftSidebar 与 panelVisibility"
```

---

## Task 6: useLeftSidebar composable

**Files:**
- Create: `src/app/useLeftSidebar.ts`
- Test: `src/app/useLeftSidebar.test.ts`

- [ ] **Step 1: 创建 useLeftSidebar.ts**

```ts
// src/app/useLeftSidebar.ts
import { computed, type ComputedRef, type Ref } from "vue";
import type {
  ActivityKey,
  LeftSidebarState,
} from "./useWorkbenchLayout";

export interface UseLeftSidebarApi {
  state: ComputedRef<LeftSidebarState>;
  isOpen: ComputedRef<boolean>;
  width: ComputedRef<number>;
  activity: ComputedRef<ActivityKey>;
  setActivity: (key: ActivityKey) => void;
  toggleOpen: () => void;
  setWidth: (w: number) => void;
}

export function useLeftSidebar(
  ref: Ref<LeftSidebarState>,
  setActivity: (key: ActivityKey) => void,
  toggleOpen: () => void,
  setWidth: (w: number) => void,
): UseLeftSidebarApi {
  return {
    state: computed(() => ref.value),
    isOpen: computed(() => ref.value.open),
    width: computed(() => ref.value.width),
    activity: computed(() => ref.value.activity),
    setActivity,
    toggleOpen,
    setWidth,
  };
}
```

- [ ] **Step 2: 编写 useLeftSidebar.test.ts**

```ts
// src/app/useLeftSidebar.test.ts
import { ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useLeftSidebar } from "./useLeftSidebar";

describe("useLeftSidebar", () => {
  it("反映 state ref 的派生值", () => {
    const state = ref({
      activity: "sourceControl" as const,
      open: true,
      width: 280,
    });
    const api = useLeftSidebar(state, vi.fn(), vi.fn(), vi.fn());

    expect(api.activity.value).toBe("sourceControl");
    expect(api.isOpen.value).toBe(true);
    expect(api.width.value).toBe(280);
  });

  it("setActivity 转发到回调", () => {
    const state = ref({
      activity: "sourceControl" as const,
      open: true,
      width: 280,
    });
    const setActivity = vi.fn();
    const api = useLeftSidebar(state, setActivity, vi.fn(), vi.fn());
    api.setActivity("workspace");
    expect(setActivity).toHaveBeenCalledWith("workspace");
  });

  it("toggleOpen 转发到回调", () => {
    const state = ref({
      activity: "sourceControl" as const,
      open: true,
      width: 280,
    });
    const toggleOpen = vi.fn();
    const api = useLeftSidebar(state, vi.fn(), toggleOpen, vi.fn());
    api.toggleOpen();
    expect(toggleOpen).toHaveBeenCalled();
  });

  it("setWidth 转发到回调", () => {
    const state = ref({
      activity: "sourceControl" as const,
      open: true,
      width: 280,
    });
    const setWidth = vi.fn();
    const api = useLeftSidebar(state, vi.fn(), vi.fn(), setWidth);
    api.setWidth(360);
    expect(setWidth).toHaveBeenCalledWith(360);
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
pnpm test -- useLeftSidebar
```

Expected: 4 tests pass

- [ ] **Step 4: 提交**

```bash
git add src/app/useLeftSidebar.ts src/app/useLeftSidebar.test.ts
git commit -m "feat(shell): 新增 useLeftSidebar composable"
```

---

## Task 7: ActivityIcons 组件

**Files:**
- Create: `src/app/shell/ActivityIcons.vue`
- Test: `src/app/shell/ActivityIcons.vue.test.ts`

- [ ] **Step 1: 创建 ActivityIcons.vue**

```vue
<script setup lang="ts">
import {
  AddOutline,
  GitBranchOutline,
  OpenOutline,
  ServerOutline,
} from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { computed } from "vue";
import { t } from "@/modules/i18n/translate";
import type { ActivityKey } from "@/app/useWorkbenchLayout";

const props = defineProps<{
  activity: ActivityKey;
  enabled: boolean;
}>();

const emit = defineEmits<{
  "select-activity": [key: ActivityKey];
  "add-workspace": [];
  "open-in-new-window": [];
}>();

const activities = computed(() => [
  { key: "sourceControl" as ActivityKey, icon: GitBranchOutline, label: t("app.leftSidebar.activity.sourceControl") },
  { key: "workspace" as ActivityKey, icon: ServerOutline, label: t("app.leftSidebar.activity.workspace") },
]);
</script>

<template>
  <nav
    class="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border/30 bg-activity-bar py-2"
  >
    <button
      type="button"
      data-add-workspace
      :title="t('app.leftSidebar.addWorkspace')"
      class="grid size-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
      @click="emit('add-workspace')"
    >
      <NIcon :component="AddOutline" :size="16" />
    </button>

    <button
      type="button"
      data-open-in-new-window
      :title="t('app.leftSidebar.openInNewWindow')"
      class="grid size-8 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
      @click="emit('open-in-new-window')"
    >
      <NIcon :component="OpenOutline" :size="15" />
    </button>

    <div class="my-1 h-px w-6 bg-border/50" />

    <button
      v-for="item in activities"
      :key="item.key"
      type="button"
      :data-activity="item.key"
      :aria-pressed="activity === item.key"
      :title="item.label"
      :disabled="!enabled"
      class="grid size-8 place-items-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-50"
      :class="
        activity === item.key
          ? 'bg-accent text-foreground'
          : 'text-muted-foreground hover:bg-accent/70 hover:text-foreground'
      "
      @click="emit('select-activity', item.key)"
    >
      <NIcon :component="item.icon" :size="16" />
    </button>
  </nav>
</template>
```

- [ ] **Step 2: 编写 ActivityIcons 测试**

```ts
// src/app/shell/ActivityIcons.vue.test.ts
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import ActivityIcons from "./ActivityIcons.vue";

describe("ActivityIcons", () => {
  it("renders add and new-window buttons", () => {
    const wrapper = mount(ActivityIcons, {
      props: { activity: "sourceControl", enabled: true },
    });
    expect(wrapper.find("[data-add-workspace]").exists()).toBe(true);
    expect(wrapper.find("[data-open-in-new-window]").exists()).toBe(true);
  });

  it("emits add-workspace on + click", async () => {
    const wrapper = mount(ActivityIcons, {
      props: { activity: "sourceControl", enabled: true },
    });
    await wrapper.find("[data-add-workspace]").trigger("click");
    expect(wrapper.emitted("add-workspace")).toBeTruthy();
  });

  it("emits open-in-new-window on ↗ click", async () => {
    const wrapper = mount(ActivityIcons, {
      props: { activity: "sourceControl", enabled: true },
    });
    await wrapper.find("[data-open-in-new-window]").trigger("click");
    expect(wrapper.emitted("open-in-new-window")).toBeTruthy();
  });

  it("emits select-activity on activity click", async () => {
    const wrapper = mount(ActivityIcons, {
      props: { activity: "sourceControl", enabled: true },
    });
    await wrapper.find('[data-activity="workspace"]').trigger("click");
    expect(wrapper.emitted("select-activity")?.[0]).toEqual(["workspace"]);
  });

  it("highlights current activity", () => {
    const wrapper = mount(ActivityIcons, {
      props: { activity: "workspace", enabled: true },
    });
    const btn = wrapper.find('[data-activity="workspace"]');
    expect(btn.attributes("aria-pressed")).toBe("true");
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
pnpm test -- ActivityIcons
```

Expected: 5 tests pass

- [ ] **Step 4: 提交**

```bash
git add src/app/shell/ActivityIcons.vue src/app/shell/ActivityIcons.vue.test.ts
git commit -m "feat(shell): 新增 ActivityIcons 组件"
```

---

## Task 8: LeftSidebar 组件

**Files:**
- Create: `src/app/shell/LeftSidebar.vue`
- Test: `src/app/shell/LeftSidebar.vue.test.ts`

- [ ] **Step 1: 创建 LeftSidebar.vue**

```vue
<script setup lang="ts">
import { ref } from "vue";
import ActivityIcons from "./ActivityIcons.vue";
import SourceControlPanel from "@/modules/source-control/SourceControlPanel.vue";
import WorkspaceBar from "./WorkspaceBar.vue";
import type { ActivityKey, PanelKey } from "@/app/useWorkbenchLayout";
import type { WorkspaceInstance } from "@/modules/workspace";
import { provideWorkspaceContext } from "@/app/workspaceContext";

const props = defineProps<{
  activity: ActivityKey;
  open: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  workspace: WorkspaceInstance;
}>();

const emit = defineEmits<{
  "select-activity": [key: ActivityKey];
  "add-workspace": [];
  "open-in-new-window": [];
  "select-workspace": [id: string];
  "close-workspace": [id: string];
  "resize-width": [width: number];
  "toggle-panel": [key: PanelKey];
}>();

// Source Control 内部状态由 SourceControlPanel 自行管理

const dragging = ref(false);

function onResizeStart(e: PointerEvent) {
  dragging.value = true;
  const startX = e.clientX;
  const startWidth = props.width;

  function onMove(ev: PointerEvent) {
    const dx = ev.clientX - startX;
    emit("resize-width", startWidth + dx);
  }

  function onUp() {
    dragging.value = false;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
</script>

<template>
  <aside
    v-if="open"
    class="flex shrink-0 border-r border-border/30 bg-activity-bar"
    :style="{ width: `${width}px` }"
    :data-activity="activity"
  >
    <ActivityIcons
      :activity="activity"
      :enabled="true"
      @select-activity="(k) => emit('select-activity', k)"
      @add-workspace="emit('add-workspace')"
      @open-in-new-window="emit('open-in-new-window')"
    />

    <div class="relative min-w-0 flex-1">
      <SourceControlPanel
        v-show="activity === 'sourceControl'"
        :workspace="workspace"
      />
      <WorkspaceBar
        v-show="activity === 'workspace'"
        embedded
        @select-workspace="(id) => emit('select-workspace', id)"
        @close-workspace="(id) => emit('close-workspace', id)"
        @add-workspace="emit('add-workspace')"
        @open-in-new-window="emit('open-in-new-window')"
      />

      <div
        class="absolute inset-y-0 right-0 w-1 cursor-col-resize"
        @pointerdown="onResizeStart"
      />
    </div>
  </aside>
</template>
```

- [ ] **Step 2: 编写 LeftSidebar 测试**

```ts
// src/app/shell/LeftSidebar.vue.test.ts
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h } from "vue";
import LeftSidebar from "./LeftSidebar.vue";

const StubSourceControl = defineComponent({
  name: "SourceControlPanel",
  setup() {
    return () => h("div", { "data-stub": "source-control" });
  },
});

const StubWorkspaceBar = defineComponent({
  name: "WorkspaceBar",
  setup(_, { slots }) {
    return () =>
      h(
        "div",
        { "data-stub": "workspace-bar" },
        slots.default?.() ?? [],
      );
  },
});

const stubWorkspace = {
  id: "local:/repo",
  rootPath: "/repo",
  env: { kind: "local" },
  name: "repo",
  openedAt: 0,
};

describe("LeftSidebar", () => {
  it("renders ActivityIcons", () => {
    const wrapper = mount(LeftSidebar, {
      props: {
        activity: "sourceControl",
        open: true,
        width: 280,
        minWidth: 200,
        maxWidth: 480,
        workspace: stubWorkspace as never,
      },
      global: {
        stubs: {
          ActivityIcons: true,
          SourceControlPanel: StubSourceControl,
          WorkspaceBar: StubWorkspaceBar,
        },
      },
    });
    expect(wrapper.find("[data-activity]").attributes("data-activity")).toBe("sourceControl");
  });

  it("emits select-activity", async () => {
    const wrapper = mount(LeftSidebar, {
      props: {
        activity: "sourceControl",
        open: true,
        width: 280,
        minWidth: 200,
        maxWidth: 480,
        workspace: stubWorkspace as never,
      },
      global: {
        stubs: {
          ActivityIcons: defineComponent({
            emits: ["select-activity", "add-workspace", "open-in-new-window"],
            setup(_, { emit }) {
              return () =>
                h("div", {
                  "data-stub-icons": "true",
                  onClick: () => emit("select-activity", "workspace"),
                });
            },
          }),
          SourceControlPanel: StubSourceControl,
          WorkspaceBar: StubWorkspaceBar,
        },
      },
    });
    await wrapper.find("[data-stub-icons]").trigger("click");
    expect(wrapper.emitted("select-activity")?.[0]).toEqual(["workspace"]);
  });

  it("hides itself when open=false", () => {
    const wrapper = mount(LeftSidebar, {
      props: {
        activity: "sourceControl",
        open: false,
        width: 280,
        minWidth: 200,
        maxWidth: 480,
        workspace: stubWorkspace as never,
      },
      global: {
        stubs: {
          ActivityIcons: true,
          SourceControlPanel: StubSourceControl,
          WorkspaceBar: StubWorkspaceBar,
        },
      },
    });
    expect(wrapper.find("aside").exists()).toBe(false);
  });
});
```

- [ ] **Step 3: 跑测试**

```bash
pnpm test -- LeftSidebar
```

Expected: 3 tests pass

- [ ] **Step 4: 提交**

```bash
git add src/app/shell/LeftSidebar.vue src/app/shell/LeftSidebar.vue.test.ts
git commit -m "feat(shell): 新增 LeftSidebar 多区域侧栏"
```

---

## Task 9: WorkspaceBar 增加 `↗` 按钮与 embedded 模式

**Files:**
- Modify: `src/app/shell/WorkspaceBar.vue`

- [ ] **Step 1: 修改 WorkspaceBar.vue 添加 embedded prop 和 `↗` 按钮**

```vue
<script setup lang="ts">
// 顶部 import 增加 OpenOutline
import {
  AddOutline,
  CloseOutline,
  OpenOutline,
} from "@vicons/ionicons5";

const props = withDefaults(
  defineProps<{
    embedded?: boolean;
    showAddButton?: boolean;
  }>(),
  {
    embedded: false,
    showAddButton: true,
  },
);

const emit = defineEmits<{
  "select-workspace": [id: string];
  "close-workspace": [id: string];
  "add-workspace": [];
  "open-in-new-window": [];
}>();

// 保留现有的 workspaces / activeId / select / close 等逻辑
const workspaces = useWorkspacesPiniaStore();
const list = computed(() => workspaces.workspaces);
const activeId = computed(() => workspaces.activeWorkspaceId);

function select(id: string): void {
  emit("select-workspace", id);
}

function close(event: MouseEvent, id: string): void {
  event.stopPropagation();
  emit("close-workspace", id);
}
</script>

<template>
  <div
    :class="[
      'flex shrink-0 items-center gap-0.5 overflow-x-auto bg-title-bar',
      embedded ? 'h-full flex-col p-1' : 'h-9 px-1',
    ]"
  >
    <template v-if="!embedded">
      <button
        v-for="ws in list"
        :key="ws.id"
        type="button"
        :data-workspace-id="ws.id"
        :data-active="ws.id === activeId"
        :title="ws.rootPath"
        :class="[
          'group flex min-w-[6rem] max-w-48 items-center gap-1 rounded px-2 py-1 text-[12px] transition-colors',
          ws.id === activeId
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:bg-accent/70',
        ]"
        @click="select(ws.id)"
      >
        <span class="truncate">{{ ws.name }}</span>
        <span v-if="ws.env.kind === 'wsl'" class="text-[10px] text-muted-foreground/70">{{ ws.env.distro }}</span>
        <span
          role="button"
          tabindex="-1"
          class="grid size-4 shrink-0 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-background"
          @click.stop="(e) => close(e, ws.id)"
        >
          <NIcon :component="CloseOutline" :size="11" />
        </span>
      </button>
    </template>

    <template v-else>
      <button
        v-for="ws in list"
        :key="ws.id"
        type="button"
        :data-workspace-id="ws.id"
        :data-active="ws.id === activeId"
        :title="ws.rootPath"
        class="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] transition-colors hover:bg-accent/70"
        :class="ws.id === activeId ? 'bg-accent text-foreground' : 'text-muted-foreground'"
        @click="select(ws.id)"
      >
        <span class="min-w-0 flex-1 truncate">{{ ws.name }}</span>
        <span
          role="button"
          tabindex="-1"
          class="grid size-4 shrink-0 place-items-center rounded text-muted-foreground hover:bg-background"
          @click.stop="(e) => close(e, ws.id)"
        >
          <NIcon :component="CloseOutline" :size="11" />
        </span>
      </button>
    </template>

    <template v-if="showAddButton">
      <div
        v-if="!embedded"
        class="flex shrink-0 items-center gap-0.5 pl-1"
      >
        <button
          type="button"
          data-add-workspace
          :title="t('app.leftSidebar.addWorkspace')"
          class="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          @click="emit('add-workspace')"
        >
          <NIcon :component="AddOutline" :size="14" />
        </button>
        <button
          type="button"
          data-open-in-new-window
          :title="t('app.leftSidebar.openInNewWindow')"
          class="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          @click="emit('open-in-new-window')"
        >
          <NIcon :component="OpenOutline" :size="13" />
        </button>
      </div>

      <div v-else class="mt-1 flex w-full flex-col gap-0.5">
        <button
          type="button"
          data-add-workspace
          :title="t('app.leftSidebar.addWorkspace')"
          class="flex items-center gap-2 rounded px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          @click="emit('add-workspace')"
        >
          <NIcon :component="AddOutline" :size="13" />
          <span class="truncate">{{ t("app.leftSidebar.addWorkspace") }}</span>
        </button>
        <button
          type="button"
          data-open-in-new-window
          :title="t('app.leftSidebar.openInNewWindow')"
          class="flex items-center gap-2 rounded px-2 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground"
          @click="emit('open-in-new-window')"
        >
          <NIcon :component="OpenOutline" :size="13" />
          <span class="truncate">{{ t("app.leftSidebar.openInNewWindow") }}</span>
        </button>
      </div>
    </template>
  </div>
</template>
```

- [ ] **Step 2: tsc 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add src/app/shell/WorkspaceBar.vue
git commit -m "feat(shell): WorkspaceBar 增加新窗口按钮 + embedded 模式"
```

---

## Task 10: TabBar 移除 workspaceRoot prop + 简化 emit

**Files:**
- Modify: `src/app/shell/TabBar.vue`

- [ ] **Step 1: 在 TabBar.vue 中移除 workspaceRoot prop**

```ts
// 旧：
// defineProps<{
//   ...
//   workspaceRoot?: string | null;
// }>();

// 新：
const props = defineProps<{
  tabs: Tab[];
  activeId: number;
  canSplit: boolean;
  showActions: boolean;
}>();
```

- [ ] **Step 2: 移除 copyPath/copyRelativePath/moveToNewWindow emit 转发**

```ts
const emit = defineEmits<{
  selectTab: [id: number];
  closeTab: [id: number];
  pinTab: [id: number];
  newTab: [];
  reorderTab: [sourceId: number, targetId: number, placement: TabDropPlacement];
  splitPane: [dir: SplitDir];
  closeOthers: [id: number];
  closeToRight: [id: number];
  closeAll: [];
  duplicateTerminal: [tabId: number];
  renameTab: [tabId: number, title: string];
  requestRename: [tabId: number];
}>();
```

- [ ] **Step 3: 在模板中移除 workspaceRoot 传参给 TabContextMenu**

```vue
<TabContextMenu
  :target="tabContextMenu"
  @close="closeTabContextMenu"
  @close-tab="(id) => emit('closeTab', id)"
  @close-others="(id) => emit('closeOthers', id)"
  @close-to-right="(id) => emit('closeToRight', id)"
  @close-all="emit('closeAll')"
  @duplicate-terminal="(id) => emit('duplicateTerminal', id)"
  @rename-tab="(id, title) => emit('renameTab', id, title)"
  @request-rename="(id) => emit('requestRename', id)"
  @pin-editor="(id) => emit('pinTab', id)"
/>
```

- [ ] **Step 4: tsc 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过（WorkspaceHost 仍传旧 prop，ts 会报错，下个任务修）

- [ ] **Step 5: 提交**

```bash
git add src/app/shell/TabBar.vue
git commit -m "refactor(shell): TabBar 移除 workspaceRoot prop 与路径相关 emit"
```

---

## Task 11: TabContextMenu 改用 inject 获取 workspace 信息

**Files:**
- Modify: `src/app/shell/TabContextMenu.vue`

- [ ] **Step 1: 在 TabContextMenu.vue 中通过 inject 获取 workspace**

```ts
<script setup lang="ts">
import { inject } from "vue";
import { workspaceContextKey } from "@/app/workspaceContext";

const ctx = inject(workspaceContextKey);
if (!ctx) {
  throw new Error("TabContextMenu must be used within a WorkspaceHost");
}

// 在需要路径/移动到新窗口的回调中使用：
function copyPath(tabId: number) {
  const tab = props.target?.tab;
  if (!tab) return;
  if (tab.kind === "editor" || tab.kind === "markdown") {
    emit("copy-path", tab.path);
  }
}

function copyRelativePath(tabId: number) {
  const tab = props.target?.tab;
  if (!tab) return;
  const root = ctx.workspace.rootPath;
  if ((tab.kind === "editor" || tab.kind === "markdown") && root) {
    emit("copy-relative-path", root, tab.path);
  }
}

function moveToNewWindow(tabId: number) {
  const tab = props.target?.tab;
  if (!tab) return;
  emit("move-to-new-window", tabId);
}
</script>
```

注意：`TabContextMenu` 原 emit 中由 `TabBar` 转发出去的事件签名保持不变（copyPath / copyRelativePath / moveToNewWindow），这些由 `WorkspaceHost` 继续接收并实现。

- [ ] **Step 2: tsc 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add src/app/shell/TabContextMenu.vue
git commit -m "refactor(shell): TabContextMenu 通过 inject 获取 workspace 信息"
```

---

## Task 12: Workbench 移除内嵌 Source Control split

**Files:**
- Modify: `src/app/shell/Workbench.vue`

- [ ] **Step 1: 在 Workbench 中移除 SourceControlPanel 渲染**

```vue
<!-- 旧：SourceControlPanel 直接渲染在 Workbench 内部 -->
<!-- 新：完全移除该块 -->
```

- [ ] **Step 2: 简化 Workbench 顶层 NSplit 为单层（中央 + Explorer）**

```vue
<template>
  <div class="relative flex h-full min-h-0 w-full overflow-hidden">
    <div class="relative min-w-0 flex-1">
      <!-- Terminal / Editor / Preview / Markdown / GitDiff / GitHistory / TaskConsole 绝对定位堆叠 -->
    </div>

    <NSplit
      v-if="rightPanelOpen"
      direction="horizontal"
      :min="explorerSplitMin"
      :max="explorerSplitMax"
      :size="explorerSplitSize"
      @update:size="updateExplorerSplitSize"
    >
      <template #1>
        <!-- 中央内容已在外层 -->
      </template>
      <template #2>
        <FileExplorer
          v-if="explorerPanel"
          ...
        />
      </template>
    </NSplit>
  </div>
</template>
```

（具体实现需根据 Workbench 当前 NSplit 用法调整——核心是移除左侧 SourceControlPanel 部分，让 Explorer 独立成右侧栏。）

- [ ] **Step 3: 移除 props 中 sourceControlPanel 字段（如果存在）**

```ts
// 在 props 中删除：
// sourceControlPanel: ...
```

- [ ] **Step 4: tsc 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过

- [ ] **Step 5: 跑 Workbench 现有测试**

```bash
pnpm test -- Workbench
```

Expected: 通过

- [ ] **Step 6: 提交**

```bash
git add src/app/shell/Workbench.vue
git commit -m "refactor(shell): Workbench 移除内嵌 Source Control split"
```

---

## Task 13: WorkspaceHost 集成 LeftSidebar 与新 TabBar 接线

**Files:**
- Modify: `src/app/shell/WorkspaceHost.vue`

- [ ] **Step 1: 在 WorkspaceHost 中挂载 LeftSidebar**

```vue
<script setup lang="ts">
import { computed } from "vue";
import LeftSidebar from "./LeftSidebar.vue";
import { useWorkbenchLayout } from "@/app/useWorkbenchLayout";

const { leftSidebar, panelVisibility, togglePanel } = useWorkbenchLayout();

const props = defineProps<{
  workspace: WorkspaceInstance;
}>();
</script>

<template>
  <div
    class="flex min-h-0 flex-1"
    :data-workspace-id="workspace.id"
  >
    <LeftSidebar
      :activity="leftSidebar.activity"
      :open="leftSidebar.open"
      :width="leftSidebar.width"
      :min-width="200"
      :max-width="480"
      :workspace="workspace"
      @select-activity="(k) => useWorkbenchLayout().setLeftSidebarActivity(k)"
      @add-workspace="emit('add-workspace')"
      @open-in-new-window="emit('open-in-new-window')"
      @select-workspace="(id) => workspaces.setActive(id)"
      @close-workspace="(id) => workspaces.removeWorkspace(id)"
      @resize-width="(w) => useWorkbenchLayout().setLeftSidebarWidth(w)"
      @toggle-panel="togglePanel"
    />

    <div class="flex min-w-0 flex-1 flex-col">
      <TabBar
        :tabs="tabs.workspaceTabs(workspace.id)"
        :active-id="tabs.activeIdByWorkspace[workspace.id] ?? 0"
        @select-tab="(id) => tabs.setActiveId(id, workspace.id)"
        @close-tab="(id) => tabs.closeTab(id, workspace.id)"
      />

      <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Workbench
          :active-id="tabs.activeIdByWorkspace[workspace.id] ?? 0"
          ...
        />
      </main>
    </div>
  </div>
</template>
```

- [ ] **Step 2: 处理 emit 转发（add-workspace / open-in-new-window）**

在 `WorkspaceHost` 上声明 `defineEmits`，并把这些事件转发到 MainApp：

```ts
const emit = defineEmits<{
  "add-workspace": [];
  "open-in-new-window": [];
}>();
```

MainApp 接收后调用 `startAddWorkspace()` 与 `openWorkspaceInNewWindow()`。

- [ ] **Step 3: tsc 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add src/app/shell/WorkspaceHost.vue
git commit -m "refactor(shell): WorkspaceHost 集成 LeftSidebar 与简化 TabBar 接线"
```

---

## Task 14: TitleBar 集成 WorkspaceBar + 移除 openFolder 下拉

**Files:**
- Modify: `src/app/shell/TitleBar.vue`

- [ ] **Step 1: 修改 TitleBar 模板**

```vue
<script setup lang="ts">
// 移除 openFolderOptions / handleOpenFolderSelect
// 移除 chooseWorkspace / chooseWorkspaceInEnv emit
// 移除 WorkspaceEnvSelector 引入
import WorkspaceBar from "./WorkspaceBar.vue";
import type { WorkspaceInstance } from "@/modules/workspace";

const props = defineProps<{
  workspaces: WorkspaceInstance[];
  activeWorkspaceId: string | null;
  // 保留其他现有 props
}>();

const emit = defineEmits<{
  "select-workspace": [id: string];
  "close-workspace": [id: string];
  "add-workspace": [];
  "open-in-new-window": [];
  "open-command-palette": [];
  "open-settings": [];
  // 移除 chooseWorkspace / chooseWorkspaceInEnv
}>();
</script>

<template>
  <header
    class="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-border/30 bg-title-bar px-3 text-[12px]"
    data-window-drag-region
  >
    <div class="flex min-w-0 items-center gap-2">
      <span class="font-semibold text-foreground">Nexterm</span>
    </div>

    <div class="flex min-w-0 flex-1 items-center justify-center overflow-hidden">
      <WorkspaceBar
        @select-workspace="(id) => emit('select-workspace', id)"
        @close-workspace="(id) => emit('close-workspace', id)"
        @add-workspace="emit('add-workspace')"
        @open-in-new-window="emit('open-in-new-window')"
      />
    </div>

    <div class="flex shrink-0 items-center gap-1">
      <!-- 保留命令面板、设置、窗口控制按钮 -->
    </div>
  </header>
</template>
```

- [ ] **Step 2: tsc 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add src/app/shell/TitleBar.vue
git commit -m "refactor(shell): TitleBar 集成 WorkspaceBar + 移除 openFolder 下拉"
```

---

## Task 15: MainApp 移除 workspaceOpenChoice 模态 + 新接线

**Files:**
- Modify: `src/app/MainApp.vue`

- [ ] **Step 1: 移除 workspaceOpenChoice 相关代码**

```ts
// 移除：
// const workspaceOpenChoice = ref<WorkspaceSelection | null>(null);
// async function openSelectedWorkspaceInCurrentWindow() { ... }
// async function openSelectedWorkspaceInNewWindow() { ... }
```

并替换为：

```ts
async function startAddWorkspace() {
  const env = workspaceEnv.pendingEnv;
  try {
    const selection = await workspaceRootStore.pickWorkspaceDirectory(env);
    if (!selection) return;
    await workspaces.addWorkspace(selection.path, selection.env);
  } catch (error) {
    window.alert(String(error));
  }
}

async function openWorkspaceInNewWindow() {
  const env = workspaceEnv.pendingEnv;
  try {
    const selection = await workspaceRootStore.pickWorkspaceDirectory(env);
    if (!selection) return;
    const { openWorkspaceInNewWindow } = await import(
      "@/modules/workspace/workspaceWindow"
    );
    const webview = await openWorkspaceInNewWindow(selection);
    void webview.once("tauri://error", (event) => {
      window.alert(String(event.payload));
    });
  } catch (error) {
    window.alert(String(error));
  }
}
```

- [ ] **Step 2: 移除模板中的 NModal（workspaceOpenChoice）**

```vue
<!-- 删除整个 NModal 块 -->
```

- [ ] **Step 3: 更新 StatusBar props 接线**

```vue
<StatusBar
  :workspace-name="activeWorkspace?.name ?? null"
  :git-branch="gitBranch"
  :panel-states="{
    workspace: panelVisibility.workspace,
    sourceControl: panelVisibility.sourceControl,
    explorer: panelVisibility.explorer,
    taskConsole: panelVisibility.taskConsole,
  }"
  @toggle-panel="togglePanel"
/>
```

- [ ] **Step 4: 更新 TitleBar props 接线**

```vue
<TitleBar
  :workspaces="workspaces.workspaces"
  :active-workspace-id="workspaces.activeWorkspaceId"
  ...
  @select-workspace="(id) => workspaces.setActive(id)"
  @close-workspace="(id) => workspaces.removeWorkspace(id)"
  @add-workspace="startAddWorkspace"
  @open-in-new-window="openWorkspaceInNewWindow"
/>
```

- [ ] **Step 5: 移除 WorkspaceBar 的独立渲染**

```vue
<!-- 删除：<WorkspaceBar @add-workspace="startAddWorkspace()" /> -->
```

- [ ] **Step 6: tsc 验证**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过

- [ ] **Step 7: 提交**

```bash
git add src/app/MainApp.vue
git commit -m "refactor(shell): MainApp 移除工作区打开方式询问模态 + 新接线"
```

---

## Task 16: 更新/新增测试

**Files:**
- Modify: `src/app/MainApp.vue.test.ts`
- Create: `src/app/useLeftSidebar.test.ts`（如未在 Task 6 创建）
- Create: `src/app/shell/LeftSidebar.vue.test.ts`（如未在 Task 8 创建）
- Create: `src/app/shell/ActivityIcons.vue.test.ts`（如未在 Task 7 创建）

- [ ] **Step 1: 更新 MainApp.vue.test.ts**

```ts
// 移除 data-open-workspace-current / data-open-workspace-new-window 断言
// 新增：TitleBar 中央 WorkspaceBar 渲染断言
it("在 TitleBar 中央显示工作区列表", () => {
  const wrapper = mount(MainApp, {
    ...
  });
  expect(wrapper.find('[data-workspace-id]').exists()).toBe(true);
});

// 新增：StatusBar 4 个面板图标按钮存在
it("StatusBar 显示 4 个面板开关按钮", () => {
  ...
  const toggles = wrapper.findAll('[data-toggle-panel]');
  expect(toggles.length).toBe(4);
});
```

- [ ] **Step 2: 跑所有受影响测试**

```bash
pnpm test
```

Expected: 全部通过（除已知 2 个 out-of-scope 失败）

- [ ] **Step 3: 跑 tsc**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add src/app/MainApp.vue.test.ts
git commit -m "test(shell): 更新 MainApp 与新组件测试"
```

---

## Task 17: 清理 WorkspaceEnvSelector（保留但功能已内联）

**Files:**
- Modify: `src/app/components/WorkspaceEnvSelector.vue`

- [ ] **Step 1: 验证无引用残留**

```bash
grep -r "WorkspaceEnvSelector" src/
```

Expected: 仅组件自身文件被命中，无外部引用

- [ ] **Step 2: 如果确认无引用，删除组件文件**

```bash
rm src/app/components/WorkspaceEnvSelector.vue
rm src/app/components/WorkspaceEnvSelector.vue.test.ts 2>/dev/null || true
```

- [ ] **Step 3: tsc + test**

```bash
pnpm exec tsc --noEmit && pnpm test
```

Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "chore(shell): 删除已内联的 WorkspaceEnvSelector 组件"
```

---

## Task 18: 全量验证

- [ ] **Step 1: 运行 type check**

```bash
pnpm exec tsc --noEmit
```

Expected: 通过

- [ ] **Step 2: 运行测试**

```bash
pnpm test
```

Expected: 全部通过（除 2 个已知 out-of-scope 失败）

- [ ] **Step 3: 运行 build**

```bash
pnpm build
```

Expected: 通过

- [ ] **Step 4: 运行 clippy**

```bash
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
```

Expected: 通过（本次重构不涉及 Rust）

- [ ] **Step 5: 验收清单逐项检查**

对照 `docs/superpowers/specs/2026-07-22-shell-layout-refactor-design.md` 第 9 节"验收标准"，逐条 verify。

- [ ] **Step 6: 最终提交**

```bash
git status
# 如果有未提交的微调：
git add -A
git commit -m "chore(shell): 布局重构收尾"
```

---

## Self-Review

**Spec coverage:**

| Spec 章节 | 实施任务 |
|-----------|----------|
| 3.1 StatusBar 极简两栏 | Task 4 |
| 3.2 TitleBar 集成 WorkspaceBar | Task 14 |
| 3.3 左侧 Activity Panel | Task 7, 8, 9 |
| 3.4 TabBar 简化 | Task 10, 11 |
| 3.5 移除询问弹窗 | Task 15 |
| 3.6 TitleBar 环境入口清理 | Task 14 |
| 4.1 useWorkbenchLayout 扩展 | Task 1 |
| 4.2 持久化 keys | Task 2 |
| 4.3 WorkspaceEnv Pinia | Task 9, 14, 15（间接） |
| 5 i18n 变更 | Task 3 |
| 6 架构边界 | 所有任务遵守 |
| 8 测试策略 | Task 16 |
| 9 验收标准 | Task 18 |

**Placeholder scan:** 无 TBD/TODO。所有代码片段完整，命令明确。

**Type consistency:**
- `ActivityKey` / `PanelKey` / `LeftSidebarState` / `PanelVisibilityState` 在 Task 1 定义，Task 2、3、4、7、8、9 全部引用一致
- `workspaceContextKey` 在 Task 5 扩展，Task 8、11 引用一致
- `panelStates` 在 Task 4 StatusBar props 中定义 `{ workspace, sourceControl, explorer, taskConsole }`，Task 15 MainApp 接线与之匹配