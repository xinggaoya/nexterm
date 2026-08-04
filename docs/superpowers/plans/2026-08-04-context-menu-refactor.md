# 终端与标签页右键菜单重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复终端右键菜单未准确跟随鼠标的问题，并将标签页右键菜单重构为紧凑、统一且保留全部平铺操作的 Naive UI 下拉菜单。

**Architecture:** 两个菜单统一使用 `NDropdown` 的 manual 模式与鼠标视口坐标定位。坐标直接通过 `x`、`y` props 交给 Naive UI，避免依赖 1px fixed 锚点的布局测量；标签页操作整理为 `computed<DropdownOption[]>`，继续由 `TabBar` 处理业务事件。

**Tech Stack:** Vue 3 Composition API、TypeScript、Naive UI `NDropdown`、Vitest、Vue Test Utils、pnpm。

## Global Constraints

- 标签页菜单保留当前全部操作，并保持平铺，不增加二级菜单。
- 仅重构终端和标签页菜单，不扩大到资源管理器菜单。
- 所有现有业务 emit 名称和参数保持兼容。
- 使用 `@/` 路径别名，不引入新依赖。
- 先写失败测试，再实现最小改动。

---

## File Structure

- `src/modules/terminal/TerminalContextMenu.vue`：终端菜单选项、事件分发和鼠标坐标定位。
- `src/modules/terminal/TerminalContextMenu.vue.test.ts`：终端菜单坐标透传及操作事件测试。
- `src/app/shell/TabContextMenu.vue`：标签页菜单选项生成、条件分组和事件分发。
- `src/app/shell/TabContextMenu.vue.test.ts`：标签页菜单可见性、坐标和业务事件测试。
- `src/styles/globals.css`：仅在现有 NDropdown 样式不足以达到紧凑密度时，调整共享 `.nexterm-dropdown-option` 样式；不新增另一套菜单视觉系统。

### Task 1: 修复终端菜单坐标定位

**Files:**
- Modify: `src/modules/terminal/TerminalContextMenu.vue:69-87`
- Test: `src/modules/terminal/TerminalContextMenu.vue.test.ts:11-67,73-145`

**Interfaces:**
- Consumes: `x: number`、`y: number`、`selection: string` props。
- Produces: 向 `NDropdown` 直接传递 `x`、`y`，保持 `close/copy/paste/selectAll` emits 不变。

- [ ] **Step 1: 扩展测试中的 NDropdown mock 并写坐标失败测试**

在 mock props 中加入 `x`、`y`，把它们暴露为 DOM data attribute：

```ts
NDropdown: defineComponent({
  props: ["options", "show", "x", "y"],
  emits: ["select", "clickoutside"],
  setup(props, { emit, slots }) {
    return () =>
      h(
        "div",
        {
          "data-dropdown-mock": "",
          "data-dropdown-x": String(props.x),
          "data-dropdown-y": String(props.y),
        },
        [slots.default?.(), /* 现有 option 节点 */],
      );
  },
}),
```

新增测试：

```ts
it("passes the pointer coordinates directly to the dropdown", async () => {
  const wrapper = mount(TerminalContextMenu, {
    props: { x: 123, y: 234, selection: "" },
  });
  await flush();

  const dropdown = wrapper.get("[data-dropdown-mock]");
  expect(dropdown.attributes("data-dropdown-x")).toBe("123");
  expect(dropdown.attributes("data-dropdown-y")).toBe("234");
});
```

- [ ] **Step 2: 运行定向测试并确认失败**

Run:

```bash
pnpm test -- src/modules/terminal/TerminalContextMenu.vue.test.ts
```

Expected: 新测试失败，`data-dropdown-x/y` 为 `undefined`，证明组件尚未直接传递坐标。

- [ ] **Step 3: 最小化修复终端菜单定位**

将模板改为直接坐标驱动，并用无尺寸默认槽满足 `NDropdown` 的 target 要求：

```vue
<NDropdown
  trigger="manual"
  placement="bottom-start"
  :show="true"
  :x="x"
  :y="y"
  :options="options"
  @select="handleSelect"
  @clickoutside="emit('close')"
>
  <span aria-hidden="true" />
</NDropdown>
```

删除原来的 `position: fixed`、`left/top`、`width/height` 1px 锚点。

- [ ] **Step 4: 运行终端菜单测试**

Run:

```bash
pnpm test -- src/modules/terminal/TerminalContextMenu.vue.test.ts
```

Expected: 全部通过，包括原有 copy/paste/selectAll 和新坐标测试。

- [ ] **Step 5: 提交终端定位修复**

```bash
git add src/modules/terminal/TerminalContextMenu.vue src/modules/terminal/TerminalContextMenu.vue.test.ts
git commit -m "fix(terminal): 修复右键菜单鼠标定位"
```

### Task 2: 将标签页菜单迁移到紧凑 NDropdown

**Files:**
- Modify: `src/app/shell/TabContextMenu.vue:1-276`
- Test: `src/app/shell/TabContextMenu.vue.test.ts:1-122`

**Interfaces:**
- Consumes: `target: TabContextMenuTarget | null`、`WORKSPACE_CONTEXT_KEY` 注入的 `workspace.rootPath`。
- Produces: `computed<DropdownOption[]>`；继续发出 `close`、`closeTab`、`closeOthers`、`closeToRight`、`closeAll`、`duplicateTerminal`、`renameTab`、`pinEditor`、`copyPath`、`copyRelativePath`、`moveToNewWindow`、`requestRename`。

- [ ] **Step 1: 在标签菜单测试中加入 NDropdown mock**

复用终端测试的行为型 mock，支持 divider、disabled、`x/y`、select 和 clickoutside：

```ts
vi.mock("naive-ui", async () => {
  const actual = await vi.importActual<typeof import("naive-ui")>("naive-ui");
  return {
    ...actual,
    NDropdown: defineComponent({
      props: ["options", "show", "x", "y"],
      emits: ["select", "clickoutside"],
      setup(props, { emit, slots }) {
        return () =>
          h("div", {
            "data-dropdown-mock": "",
            "data-dropdown-x": String(props.x),
            "data-dropdown-y": String(props.y),
          }, [
            slots.default?.(),
            ...((props.options as Array<{ key: string; label?: string; disabled?: boolean; type?: string }>) ?? [])
              .filter((option) => option.type !== "divider")
              .map((option) =>
                h("div", {
                  "data-menu-action": option.key,
                  "data-disabled": option.disabled ? "true" : undefined,
                  onClick: () => {
                    if (!option.disabled) emit("select", option.key);
                  },
                }, option.label),
              ),
          ]);
      },
    }),
  };
});
```

测试挂载时通过 `global.provide` 提供 workspace context，不再传未声明的 `rootPath` attribute。

- [ ] **Step 2: 写迁移后的结构与坐标失败测试**

新增以下断言：

```ts
it("renders a coordinate-driven dropdown", async () => {
  const wrapper = mountMenu({ ...baseTarget, tab: terminalTab });
  const dropdown = wrapper.get("[data-dropdown-mock]");

  expect(dropdown.attributes("data-dropdown-x")).toBe("10");
  expect(dropdown.attributes("data-dropdown-y")).toBe("20");
  expect(wrapper.find(".nexterm-overlay").exists()).toBe(false);
});
```

再保留并适配现有断言，确保 terminal、editor、markdown、preview 和路径相关动作仍按原条件出现。

- [ ] **Step 3: 运行标签菜单测试并确认失败**

Run:

```bash
pnpm test -- src/app/shell/TabContextMenu.vue.test.ts
```

Expected: 因当前组件仍使用手写 overlay 和 `NButton`，坐标驱动 dropdown 测试失败。

- [ ] **Step 4: 把模板迁移为 manual NDropdown**

导入并使用：

```ts
import { h, NDropdown, type DropdownOption } from "naive-ui";
```

增加与其他菜单一致的渲染函数：

```ts
function renderOption(action: string) {
  return (option: DropdownOption) =>
    h(
      "div",
      {
        class: "nexterm-dropdown-option",
        "data-menu-action": action,
        style: "padding: 0;",
      },
      { default: () => option.label },
    );
}
```

模板替换为：

```vue
<NDropdown
  v-if="target"
  trigger="manual"
  placement="bottom-start"
  :show="true"
  :x="target.x"
  :y="target.y"
  :options="options"
  @select="handleSelect"
  @clickoutside="emit('close')"
>
  <span aria-hidden="true" />
</NDropdown>
```

删除 `Transition`、`.nexterm-overlay`、手写 `NButton` 列表，以及全局 pointerdown、keydown、blur 的挂载和卸载逻辑。

- [ ] **Step 5: 用 computed options 保留全部平铺操作**

构造顺序必须保持清晰分组：

```ts
const options = computed<DropdownOption[]>(() => {
  const target = props.target;
  if (!target) return [];

  const items: DropdownOption[] = [
    menuOption("close", t("tabMenu.close")),
  ];

  if (target.total > 1) {
    items.push(menuOption("close-others", t("tabMenu.closeOthers")));
  }
  if (target.index < target.total - 1) {
    items.push(menuOption("close-right", t("tabMenu.closeRight")));
  }
  if (target.total > 1) {
    items.push(menuOption("close-all", t("tabMenu.closeAll")));
  }

  // 仅当下一组存在时插入 divider，然后按原条件加入 terminal、
  // editor/markdown/preview 和 path 操作，保持现有操作全集。
  return items;
});
```

使用明确 helper 避免重复：

```ts
function menuOption(key: string, label: string): DropdownOption {
  return { key, label, render: renderOption(key) };
}

function divider(key: string): DropdownOption {
  return { key, type: "divider" };
}
```

分组为：关闭操作；标签类型操作；路径操作。只有后一组确实存在时才插入 divider，避免空分隔线。

- [ ] **Step 6: 用单一 handleSelect 保持现有 emit 合约**

实现：

```ts
function handleSelect(key: string | number) {
  const target = props.target;
  if (!target || typeof key !== "string") return;

  switch (key) {
    case "close":
      emit("closeTab", target.tab.id);
      break;
    case "close-others":
      emit("closeOthers", target.tab.id);
      break;
    case "close-right":
      emit("closeToRight", target.tab.id);
      break;
    case "close-all":
      emit("closeAll");
      break;
    case "duplicate":
      emit("duplicateTerminal", target.tab.id);
      break;
    case "rename":
      emit("requestRename", target.tab.id);
      break;
    case "pin":
      emit("pinEditor", target.tab.id);
      break;
    case "move-to-new-window":
      emit("moveToNewWindow", target.tab.id);
      break;
    case "copy-path": {
      const path = pathFor(target.tab);
      if (path) emit("copyPath", path);
      break;
    }
    case "copy-relative-path": {
      const path = pathFor(target.tab);
      const rootPath = workspaceCtx?.workspace.rootPath;
      if (path && rootPath) emit("copyRelativePath", rootPath, path);
      break;
    }
  }

  emit("close");
}
```

保留已公开但当前未使用的 `renameTab` emit 声明，以免无关接口破坏。

- [ ] **Step 7: 运行标签菜单测试**

Run:

```bash
pnpm test -- src/app/shell/TabContextMenu.vue.test.ts
```

Expected: 坐标、可见性和全部事件测试通过。

- [ ] **Step 8: 提交标签菜单重构**

```bash
git add src/app/shell/TabContextMenu.vue src/app/shell/TabContextMenu.vue.test.ts
git commit -m "refactor(tabs): 统一紧凑右键菜单"
```

### Task 3: 回归验证菜单边界与构建

**Files:**
- Verify: `src/modules/terminal/TerminalContextMenu.vue`
- Verify: `src/app/shell/TabContextMenu.vue`
- Verify: `src/app/shell/TabBar.vue`
- Verify: `src/styles/visualSystem.test.ts`

**Interfaces:**
- Consumes: Task 1 和 Task 2 的坐标驱动 NDropdown。
- Produces: 通过完整前端测试和构建验证的菜单重构。

- [ ] **Step 1: 运行两类菜单定向测试**

```bash
pnpm test -- src/modules/terminal/TerminalContextMenu.vue.test.ts src/app/shell/TabContextMenu.vue.test.ts
```

Expected: 全部通过。

- [ ] **Step 2: 运行完整测试集**

```bash
pnpm test
```

Expected: 除仓库文档注明的两个 main 分支既有失败外，无新增失败：

- `src/modules/explorer/FileExplorer.vue.test.ts > renders git tones for changed files and parent folders`
- `src/modules/source-control/SourceControlPanel.vue.test.ts > runs fetch pull and push operations then refreshes status`

- [ ] **Step 3: 运行类型检查和生产构建**

```bash
pnpm build
```

Expected: `vue-tsc --noEmit` 与 Vite production build 均成功。

- [ ] **Step 4: 检查工作区差异**

```bash
git diff --check
git status --short
```

Expected: 无空白错误；仅出现本计划涉及的菜单组件、测试和计划文档改动。

- [ ] **Step 5: 提交验证后的计划文档（若尚未提交）**

```bash
git add docs/superpowers/plans/2026-08-04-context-menu-refactor.md
git commit -m "chore: 记录右键菜单重构计划"
```
