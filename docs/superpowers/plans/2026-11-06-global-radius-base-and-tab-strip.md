# 全局圆角基准 + 顶部栏标签页重做 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把圆角收敛成**一个全局基准值**（档位由它派生、所有组件继承），并把顶部栏标签页从"顶栏中间的一排胶囊"重做成独立一行的现代标签条。

**Architecture:** `globals.css` 的 `@theme` 里只留一个手工值 `--radius-base`，其余 8 个档位全部用 `calc()` 从它派生。Tailwind 工具类、手写 CSS、Naive UI `themeOverrides` 三条路径引用同一组派生值 —— 改 `--radius-base` 一处，全应用圆角等比生效。Naive 侧以 `common.borderRadius`（Naive 的全局旋钮）为基准，容器类组件用派生档位覆盖。标签页则从 `TopBar` 的 center slot 移到独立一行，视觉归入全局圆角档位，交互去掉 hover-only 与难辨认的拖拽指示器。

**Tech Stack:** Vue 3 `<script setup lang="ts">`、Tailwind CSS v4.2.3、Naive UI 2.44.1、Vitest

**Spec:** 本计划第 0 节（已与用户确认）

---

## Global Constraints

- 包管理器用 `pnpm`；Node 环境，不使用 Bun。
- 所有 Tauri 调用必须走 `@/lib/native`；本计划不涉及 IPC 与 Rust 侧。
- 路径别名统一用 `@/`。
- 注释与 commit message 用中文，技术名词保留英文。
- **不得改动** `.nexterm-settings-group.n-card { border-radius: 0 !important }`（设置面板分组卡片去框，有契约断言）。
- **不得改动** edge-to-edge 窗口的 `#root { border-radius: 0 }`（有契约断言）。
- **不得改动** 自绘 window chrome 的 `html[data-chrome="borderless"] #root { border-radius: 8px }` —— 它是操作系统窗口的形状（跟着 OS 走，不跟主题走），不属于 UI 圆角档位体系，契约测试已把它排除。
- `TopBar` 高度保持 `h-11`（44px）不变 —— 它承载窗口拖拽区、macOS 红绿灯让位与既有契约断言。
- `StatusDock` 高度保持 `h-6`（24px）不变。
- 圆角档位固定 8 个：`xs / sm / md / lg / xl / 2xl / 3xl / 4xl`，不新增第 9 个。
- 新增的圆角声明一律用 `var(--radius-*)` 或 Tailwind `rounded-*` 工具类，禁止字面量 px（`0` / `999px` / `50%` 除外）。
- 组件里禁止裸 `rounded`（等于 `var(--radius)`，语义模糊）与 `rounded-[…]` 任意值。

---

## 0. 已确认的设计

### 0.1 全局圆角基准

```css
@theme {
    --radius-base: 6px;                                    /* 唯一手工值 */
    --radius-xs:   calc(var(--radius-base) / 3);           /* 2px  */
    --radius-sm:   calc(var(--radius-base) * 2 / 3);       /* 4px  */
    --radius-md:   var(--radius-base);                     /* 6px  */
    --radius-lg:   calc(var(--radius-base) * 2);           /* 12px */
    --radius-xl:   calc(var(--radius-base) * 8 / 3);       /* 16px */
    --radius-2xl:  calc(var(--radius-base) * 10 / 3);      /* 20px */
    --radius-3xl:  calc(var(--radius-base) * 4);           /* 24px */
    --radius-4xl:  calc(var(--radius-base) * 14 / 3);      /* 28px */
}
```

倍率刻意选成在 `base=6px` 时都落成整数像素。已实测 Tailwind 4.2.3 的 `@theme` 接受 `calc()` 派生并原样输出到 `:root, :host`。

### 0.2 档位归属

| 档位 | 值 | 归属 |
|---|---|---|
| `xs` | 2px | 极小内嵌：Tag、Checkbox |
| `sm` | 4px | 密集小控件：图标按钮、文件树行、chip |
| `md` | 6px | **全局基准**：按钮、输入框、菜单项、标签页 |
| `lg` | 12px | 容器：卡片、面板、通知、菜单浮层 |
| `xl` | 16px | 浮层：下拉、popover、popconfirm |
| `2xl` | 20px | 弹窗：Dialog、Drawer |
| `3xl` / `4xl` | 24 / 28px | 超大容器（备用） |

### 0.3 Naive 覆盖表

```ts
common:       { borderRadius: "var(--radius-md)", borderRadiusSmall: "var(--radius-xs)" }
Button:       { borderRadiusTiny: "var(--radius-xs)", borderRadiusSmall: "var(--radius-sm)",
                borderRadiusMedium: "var(--radius-md)", borderRadiusLarge: "var(--radius-md)" }
Tag:          { borderRadius: "var(--radius-xs)" }
Card:         { borderRadius: "var(--radius-lg)" }
Menu:         { borderRadius: "var(--radius-lg)" }
Notification: { borderRadius: "var(--radius-lg)" }
Message:      { borderRadius: "var(--radius-lg)" }
Dropdown:     { borderRadius: "var(--radius-xl)" }
Popover:      { borderRadius: "var(--radius-xl)" }
Dialog:       { borderRadius: "var(--radius-2xl)" }
```

`Input` **不再单独覆盖** —— 继承 `common`（= 基准 6px）。`NSelect` 触发器的圆角硬链在 `common.borderRadius`（naive 的 `InternalSelectMenu` peer 直接从 common 解构，`themeOverrides.Select` 无此槽位，无法单独覆盖），因此提到 6px 后 `NInput` / `NSelect` / `NInputNumber` / 原生 `<input>`（已是 `rounded-md`）**全部 6px**，输入类自然统一。

连带影响（`common` 4px → 6px）：`NRadio`（圆形无影响）、`NSwitch`、`NSlider` 手柄、`NTabs` 标签、`NTooltip`（小气泡 6px 合理）、`NDrawer`（naive 只在**外侧两角**用 `--n-border-radius`，贴边侧保持直角，安全）。

### 0.4 顶部栏标签页重做（最终形态）

**结构**：标签条从 `TopBar` 的 center slot 移出，改为**中间内容列的顶部一行** —— 只覆盖画布，两侧停靠面板与它同高（VS Code 的布局）。

```
TopBar      h-11 (44px)   ← 全宽，不变
┌────────┬──────────────────────────┬────────┐
│ 左面板  │ TabStrip h-9 (36px)       │ 右面板  │   ← 标签行只盖中列
│        ├──────────────────────────┤        │
│        │ Canvas flex-1             │        │
└────────┴──────────────────────────┴────────┘
StatusDock  h-6 (24px)   ← 全宽，不变
```

代价：垂直空间 +36px。收益：标签再多也**不会挤掉顶栏的身份区与动作按钮**，也不会横向挤压两侧面板。

`TopBar` 移除 `center` slot；`WorkspaceHost` 把 `SessionStrip` 放进中列容器（`flex min-w-0 flex-1 flex-col`），`Canvas` 成为它的兄弟。

**视觉**（VS Code 的标签语言）：
- 标签：`h-8`（32px）、`rounded-t-sm`（顶部小圆角、底部直角）、`px-3`、`text-[12px]`
- 激活态：**与画布同色融合**（`bg-shell-bg`）+ 顶部 2px 主色条（`absolute inset-x-1 top-0 h-0.5 rounded-full bg-primary`）
- 非激活：透明 + `hover:bg-surface-hover`
- 配色：标题栏/标签行比画布暗一档（`--title-bar` 调暗），激活项用画布色，于是它像是从暗色条里“长”出来接上内容区
- 极简模式（单终端）：标签行**常驻**，显示一个与普通标签同形状的 cwd chip —— 避免开第二个终端时整行出现/消失导致布局跳动

**交互**：
1. 关闭按钮不再 hover-only：激活标签常显（60%）；非激活标签 hover 显示、键盘聚焦显示（`group-focus-within`）、触屏常显（`[@media(hover:none)]`）
2. 拖拽落点指示器重做：2px 细竖条 → **3px 满高主色条**
3. 溢出：移除左右翻页箭头，改为行尾「⋯」下拉菜单（列出全部标签，可直接跳转）
4. 宽度策略：`auto` 模式改为 `max-w-56`，去掉 `flex-[1_1_8rem]` 的拉伸；`fixed` 模式沿用偏好值

### 0.5 VS Code 化的其余两处

**源码管理行**：`NTag` 状态码胶囊 → **纯文字彩色字母**（M/A/D/U），位置在文件名之前（VS Code 的位置），复用已有的 `statusClass(statusKind)`。

**状态栏光标位置**：`PaneStatus` 加 `cursor?: { line, column }`，`TerminalPane` 订阅 xterm 的 `onCursorMove`（不带参数，位置从 `term.buffer.active.cursorX/Y` 读），用 rAF 合并到一帧一次且只在行列真的变了才上报；`StatusDock` 右侧显示 `Ln x, Col y`（VS Code 的写法）。

> `WorkspaceHost` 的 `paneStatus` 之前用的是**内联结构类型**而不是共享的 `PaneStatus` —— 字段一多就漂移（光标位置加不上就是这个原因）。已改回共享类型。

---

## Task A1: 全局圆角基准落地

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: 替换 `@theme` 块**

把现有 8 行固定值替换为基准 + 派生（保留块注释并扩写）。同时把 `:root` 里的裸 `--radius: 10px;` 改成 `--radius: var(--radius-md);`（不再有魔法数，同样由基准派生）。

- [ ] **Step 2: 验证**

```bash
pnpm exec vitest run src/styles/visualSystem.test.ts
```

预期：Task A2 的契约测试此时尚未更新，本任务不要求它通过；先确认 `pnpm build` 产物里 `--radius-base:6px` 与 `calc(...)` 派生都在。

---

## Task A2: 视觉契约测试更新

**Files:**
- Modify: `src/styles/visualSystem.test.ts`

- [ ] **Step 1: 写失败测试**

把"八个固定 px"的断言换成"基准 + 派生结构"的断言：

```ts
  it("derives every corner radius from one global base", () => {
    const themeStart = globalsCss.indexOf("@theme {");
    const themeBlock = globalsCss.slice(themeStart, globalsCss.indexOf("\n}", themeStart));

    // 唯一的手工值：全局圆角基准。
    expect(themeBlock).toContain("--radius-base: 6px;");

    // 其余档位全部由基准派生，不允许出现第二个手工值。
    const derived = [
      "--radius-xs:   calc(var(--radius-base) / 3);",
      "--radius-sm:   calc(var(--radius-base) * 2 / 3);",
      "--radius-md:   var(--radius-base);",
      "--radius-lg:   calc(var(--radius-base) * 2);",
      "--radius-xl:   calc(var(--radius-base) * 8 / 3);",
      "--radius-2xl:  calc(var(--radius-base) * 10 / 3);",
      "--radius-3xl:  calc(var(--radius-base) * 4);",
      "--radius-4xl:  calc(var(--radius-base) * 14 / 3);",
    ];
    for (const line of derived) {
      expect(themeBlock.replace(/\s+/g, " ")).toContain(line.replace(/\s+/g, " "));
    }

    // 基准之外不允许再有裸的 px 圆角档位。
    const radiusDecls = [...themeBlock.matchAll(/--radius-[a-z0-9-]+:\s*([^;]+);/g)].map((m) => m[1].trim());
    for (const value of radiusDecls) {
      expect(value === "6px" || value.startsWith("calc(var(--radius-base)") || value === "var(--radius-base)").toBe(true);
    }
  });
```

- [ ] **Step 2: 运行确认失败 → Step 3: 实现 A1 → Step 4: 运行确认通过**

- [ ] **Step 5: 提交**

```bash
git add src/styles/globals.css src/styles/visualSystem.test.ts
git commit -m "feat(theme): 圆角收敛为单一全局基准值，档位全部由它派生"
```

---

## Task A3: Naive 覆盖表收敛到全局基准

**Files:**
- Modify: `src/modules/theme/naiveTheme.ts`
- Modify: `src/modules/theme/naiveTheme.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
  it("drives Naive radii from the global base", () => {
    const overrides = buildNaiveThemeOverrides(mockTokens);

    // common = 全局基准，所有组件继承它。
    expect(overrides.common?.borderRadius).toBe("var(--radius-md)");
    expect(overrides.common?.borderRadiusSmall).toBe("var(--radius-xs)");

    // 容器档用派生档位。
    expect(overrides.Card?.borderRadius).toBe("var(--radius-lg)");
    expect(overrides.Menu?.borderRadius).toBe("var(--radius-lg)");
    expect(overrides.Notification?.borderRadius).toBe("var(--radius-lg)");
    expect(overrides.Message?.borderRadius).toBe("var(--radius-lg)");
    expect(overrides.Dropdown?.borderRadius).toBe("var(--radius-xl)");
    expect(overrides.Popover?.borderRadius).toBe("var(--radius-xl)");
    expect(overrides.Dialog?.borderRadius).toBe("var(--radius-2xl)");

    // Input 不再单独覆盖 —— 继承 common 即可，输入类因此天然统一。
    expect(overrides.Input).toBeUndefined();

    // 圆角槽位里不允许出现字面量 px。
    const radiusSlots = JSON.stringify(overrides).match(/"borderRadius[A-Za-z]*":"[^"]*"/g) ?? [];
    expect(radiusSlots.length).toBeGreaterThan(0);
    for (const slot of radiusSlots) {
      expect(slot).not.toMatch(/:\s*"\d+px"/);
    }
  });
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现**

改 `buildNaiveThemeOverrides`：`common.borderRadius` → `var(--radius-md)`；删掉 `Input` 覆盖；容器档按 0.3 的表调整。

- [ ] **Step 4: 运行确认通过 + 类型检查 + 提交**

```bash
pnpm exec vitest run src/modules/theme/naiveTheme.test.ts
pnpm exec vue-tsc --noEmit
git add src/modules/theme && git commit -m "feat(theme): Naive 圆角覆盖改为继承全局基准，输入类统一 6px"
```

---

## Task B1: 标签条拆成独立行

**Files:**
- Modify: `src/app/shell/TopBar.vue`（移除 center slot）
- Modify: `src/app/shell/WorkspaceHost.vue`（`SessionStrip` 提为兄弟节点）
- Modify: `src/styles/visualSystem.test.ts`（壳层契约）

- [ ] **Step 1: 写失败测试**

```ts
  it("docks the session strip as its own row under the top bar", () => {
    const host = readSource("../app/shell/WorkspaceHost.vue");
    const topBar = readSource("../app/shell/TopBar.vue");

    // 标签条不再是顶栏的 center slot —— 它有自己的一行。
    expect(host).not.toContain("<template #center>");
    expect(host).toMatch(/<TopBar[\s\S]*?<\/TopBar>[\s\S]*?<SessionStrip/);
    expect(topBar).not.toContain('name="center"');
  });
```

- [ ] **Step 2: 运行确认失败 → Step 3: 实现 → Step 4: 运行确认通过**

- [ ] **Step 5: 提交**

```bash
git commit -m "refactor(shell): 会话条从顶栏 center slot 拆成独立一行"
```

---

## Task B2: 标签视觉重做

**Files:**
- Modify: `src/app/shell/SessionStrip.vue`
- Modify: `src/styles/visualSystem.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
  it("renders the session strip as rounded-rectangle tabs on the shared scale", () => {
    const strip = readSource("../app/shell/SessionStrip.vue");
    // 圆角矩形，纳入全局档位；不再用 rounded-full 胶囊。
    expect(strip).toContain("rounded-md");
    expect(strip).not.toContain("rounded-full");
    // 激活态用主色竖条指示（复用文件树行的既有语言）。
    expect(strip).toContain("before:bg-primary");
  });
```

- [ ] **Step 2: 运行确认失败 → Step 3: 实现 → Step 4: 运行确认通过**

- [ ] **Step 5: 提交**

```bash
git commit -m "refactor(shell): 标签改为圆角矩形 + 主色指示条，纳入全局圆角档位"
```

---

## Task B3: 标签交互重做

**Files:**
- Modify: `src/app/shell/SessionStrip.vue`
- Modify: `src/modules/i18n/locales/zh-CN.ts`
- Modify: `src/modules/i18n/locales/en-US.ts`

- [ ] **Step 1: 写失败测试**

```ts
  it("keeps tab close reachable without hover and exposes an overflow menu", () => {
    const strip = readSource("../app/shell/SessionStrip.vue");
    // 关闭按钮不能只靠 hover 出现：键盘聚焦与触屏都要拿得到。
    expect(strip).toContain("focus-visible:opacity-100");
    expect(strip).toContain("hover-none:opacity-60");
    // 溢出用下拉菜单，不再用左右翻页箭头。
    expect(strip).not.toContain("data-strip-scroll-left");
    expect(strip).not.toContain("data-strip-scroll-right");
    expect(strip).toContain("data-strip-overflow");
  });
```

- [ ] **Step 2: 运行确认失败**

- [ ] **Step 3: 实现**

1. 关闭按钮：`opacity-0 group-hover:opacity-60 focus-visible:opacity-100 hover-none:opacity-60`；激活标签额外 `opacity-60` 常显
2. 拖拽指示器：目标标签加半透明高亮 + 3px 主色插入条
3. 溢出菜单：`NDropdown` + `⋯` 按钮，列出全部标签；移除 `scrollStripBy` / 左右箭头
4. 宽度策略：`auto` → `min-w-24 max-w-56`

- [ ] **Step 4: 运行确认通过**

- [ ] **Step 5: i18n**：补 `app.header.allTabs`（中英）

- [ ] **Step 6: 提交**

```bash
git commit -m "feat(shell): 标签关闭按钮不再依赖 hover，新增溢出菜单与拖拽高亮"
```

---

## Task C: 全量验证

- [ ] **Step 1:** `pnpm test`
- [ ] **Step 2:** `pnpm build`
- [ ] **Step 3:** `cd src-tauri && cargo check --all-targets --locked`
- [ ] **Step 4:** 人工回归清单

  - [ ] 标签条独立成一行，顶栏身份区与右侧按钮不再被标签挤掉
  - [ ] 标签为圆角矩形，激活项有主色竖条
  - [ ] 单终端时标签行常驻（cwd chip），开第二个终端不跳动
  - [ ] 关闭按钮：激活标签常显、非激活 hover 显示、键盘可达
  - [ ] 标签溢出时行尾出现「⋯」菜单，可直接跳转
  - [ ] 拖拽重排时落点高亮清晰可见
  - [ ] 下拉框 / 菜单 / 弹窗 / 输入框圆角分别落在 12 / 16 / 6px
  - [ ] 设置抽屉分组卡片仍是无框的
  - [ ] 深浅两套主题圆角一致
