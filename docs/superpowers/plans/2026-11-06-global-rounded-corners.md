# 全局圆润化（分层圆角）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把散落四处的圆角收敛成 CSS 变量单一事实源，按「容器圆润 / 密集控件紧凑」分层重新标定档位，一次性落地，不新增用户设置项。

**Architecture:** 圆角定义从 Tailwind 的 `@theme inline` 块迁移到普通 `@theme` 块，使 `--radius-*` 真正落到 `:root`，从而被 Tailwind 工具类、手写 CSS、Naive UI `themeOverrides` 三条路径共同消费。Naive 侧直接传 `var(--radius-*)` 字符串（已验证 naive-ui 2.44.1 对 `borderRadius` 只做字符串透传、无任何数值运算）。控件档数值不变、容器档上调，因此密集区域自动保持紧凑。

**Tech Stack:** Vue 3 + `<script setup lang="ts">`、Tailwind CSS v4.2.3、Naive UI 2.44.1、Vitest

**Spec:** 本计划第 0 节「设计文档」（已与用户确认）

---

## Global Constraints

- 包管理器必须用 `pnpm`；Node 环境，不使用 Bun。
- 不得新增 ESLint / Prettier 配置；类型正确性由 `vue-tsc --noEmit` 保证。
- 所有 Tauri 调用必须走 `@/lib/native`；本计划不涉及 IPC，无需改动 Rust 侧。
- 路径别名统一用 `@/`，不用深层相对路径。
- 注释与 commit message 用中文，技术名词保留英文。
- **不得改动** `src/styles/globals.css` 中 `.nexterm-settings-group.n-card { border-radius: 0 !important }`（设置面板分组卡片去框，`src/styles/visualSystem.test.ts:117` 有断言）。
- **不得改动** `src/styles/globals.css` 中 edge-to-edge 窗口的 `#root { border-radius: 0 }`（`src/styles/windowChrome.test.ts:15` 有断言）。
- **不得改动** `src/styles/globals.css` 的 `@theme inline` 块中任何 `--color-*` 声明——它们的值是 `var(--primary)` 之类，inline 语义是运行时换肤生效的前提，本次只迁移 `--radius-*`。
- 不得删除 `src/styles/globals.css` 的 `:root { --radius: 10px; }`（Tailwind 裸 `rounded` 工具类的兜底，unlayered 优先级高于 Tailwind `@layer theme`，删掉会回落到 Tailwind 默认的 `0.25rem`）。
- 圆角档位只有 8 个：`xs(2) / sm(4) / md(6) / lg(12) / xl(16) / 2xl(20) / 3xl(24) / 4xl(28)`。不新增第 9 个档。
- 新增的圆角声明一律用 `var(--radius-*)` 或 Tailwind `rounded-*` 工具类，禁止再出现字面量 px。

## Review Focus

以下五类问题在本计划的单测覆盖不到，是最可能咬到使用者的地方：

1. **Naive 浮层（NSelect / NDropdown / NPopconfirm）的圆角没跟着变大**——它们走 Popover/Dropdown peer，不是 `common`。若只改 `common`，下拉菜单会保持 4px，与卡片割裂。
2. **文件树行 / 会话条 / 状态坞被误升为容器档**——`FileTreeRow` 行高 24px、`SessionStrip` 28px，任何超过 6px 的圆角都会破坏像素对齐并降低信息密度。
3. **裸 `rounded` 工具类漏改**——它等于 `var(--radius)` = 10px，夹在控件档(6) 与容器档(12) 之间，是"语义模糊档"。全部要么改成 `rounded-sm`（控件）要么改成 `rounded-lg`（容器）。
4. **`@theme inline` → `@theme` 迁移后 `@apply rounded-*` 失效**——`@apply` 在 `@layer components` 里，产物变成 `border-radius: var(--radius-md)`，需确认 `.nexterm-row` 等仍正常。
5. **深色主题下 `--radius-*` 被意外覆盖**——`@theme` 产物在 `@layer theme` 内，优先级低于 unlayered 的 `:root`；若将来有人在 `:root` 里写了同名 `--radius-*` 会静默覆盖 theme 值。

---

## 0. 设计文档（已确认，供参考）

### 0.1 档位表

| 变量 | 旧值 | 新值 | 档位 | 典型用途 |
|---|---|---|---|---|
| `--radius-xs` | (Tailwind 默认 2px) | **2px** | 控件 | 极小内嵌元素、Tag |
| `--radius-sm` | 4px | **4px** | 控件 | 图标按钮、文件树行、chip |
| `--radius-md` | 6px | **6px** | 控件 | 按钮、输入框、菜单项 |
| `--radius-lg` | 10px | **12px** | 容器 | 卡片、面板、通知 |
| `--radius-xl` | 12px | **16px** | 容器 | 下拉、popover、tooltip、菜单浮层 |
| `--radius-2xl` | 16px | **20px** | 容器 | 对话框、抽屉 |
| `--radius-3xl` | 18px | **24px** | 容器 | 大型浮层 |
| `--radius-4xl` | 22px | **28px** | 容器 | 超大面板 |
| `--radius`（裸 `rounded`） | 10px | **10px（不变）** | 兜底 | Tailwind 裸 `rounded` |

控件档数值不变 → 密集区域自动保持紧凑；容器档上调 → 卡片/浮层/弹窗自动变圆润。

### 0.2 Naive UI 覆盖清单

`common.borderRadius` 保持控件档（4px），容器类组件逐个显式上调：

```ts
common:       { borderRadius: "var(--radius-sm)", borderRadiusSmall: "var(--radius-xs)" }
Button:       { borderRadiusTiny: "var(--radius-xs)", borderRadiusSmall: "var(--radius-sm)",
                borderRadiusMedium: "var(--radius-md)", borderRadiusLarge: "var(--radius-md)" }
Input:        { borderRadius: "var(--radius-sm)" }
Tag:          { borderRadius: "var(--radius-xs)" }
Card:         { borderRadius: "var(--radius-lg)" }
Dialog:       { borderRadius: "var(--radius-2xl)" }
Dropdown:     { borderRadius: "var(--radius-xl)" }
Popover:      { borderRadius: "var(--radius-xl)" }
Menu:         { borderRadius: "var(--radius-lg)" }
Notification: { borderRadius: "var(--radius-lg)" }
Message:      { borderRadius: "var(--radius-lg)" }
```

`Drawer` 保持继承 `common`（4px）——贴边抽屉整体圆角会露出生硬缺口。

### 0.3 已核实的技术前提（实施者不必重新验证）

- Tailwind v4.2.3：`@theme inline` → 工具类产物为字面量（`border-radius:6px`）且变量不落到 `:root`；普通 `@theme` → 产物为 `:root, :host { --radius-md: 6px }` + `.rounded-md { border-radius: var(--radius-md) }`，且包在 `@layer theme` 内（unlayered 优先级更高）。
- Tailwind 默认 `theme.css` 已定义 `--radius-xs…--radius-4xl` 与裸 `--radius`，本计划在 `@theme` 块中全部显式覆盖，避免依赖默认值。
- naive-ui 2.44.1：`use-theme.mjs` 中 `mergedCommon = merge({}, …, selfCommonOverrides)`，`self(vars)` 从 common 解构 `borderRadius` → `themeOverrides.common.borderRadius` 流到全部派生组件。`borderRadius` 全库无任何数值运算，仅 `'--n-border-radius': borderRadius` 字符串透传 → 可直接传 `var(--radius-*)`。
- naive-ui 组件实际使用的圆角槽位：`button / card / dialog / drawer / dropdown / input / menu / notification / popover / tooltip / tag / tabs / radio / slider / switch / message` 全部从 common 派生；`popconfirm` 通过 `peers.Popover` 继承。

---

## Task 1: 建立圆角 token 单一事实源

**Files:**
- Modify: `src/styles/globals.css`（`@theme inline` 块 + 新增 `@theme` 块）
- Test: `src/styles/visualSystem.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/styles/visualSystem.test.ts` 的 `describe("visual system contract", …)` 内追加：

```ts
  it("declares corner radii on the shared two-tier scale", () => {
    // 圆角定义必须落在普通 @theme 块（变量真实输出到 :root），
    // 而不能留在 @theme inline 里（值被烘焙成字面量，手写 CSS / Naive 无法共用）。
    const inlineBlock = globalsCss.slice(
      globalsCss.indexOf("@theme inline {"),
      globalsCss.indexOf("@theme inline {") + 4000,
    );
    const inlineBlockEnd = inlineBlock.indexOf("}");
    const inlineOnly = inlineBlock.slice(0, inlineBlockEnd);
    expect(inlineOnly).not.toMatch(/--radius-/);

    // 控件档 sm/md 数值不变，容器档上调。
    expect(globalsCss).toContain("--radius-xs: 2px;");
    expect(globalsCss).toContain("--radius-sm: 4px;");
    expect(globalsCss).toContain("--radius-md: 6px;");
    expect(globalsCss).toContain("--radius-lg: 12px;");
    expect(globalsCss).toContain("--radius-xl: 16px;");
    expect(globalsCss).toContain("--radius-2xl: 20px;");
    expect(globalsCss).toContain("--radius-3xl: 24px;");
    expect(globalsCss).toContain("--radius-4xl: 28px;");

    // 裸 rounded 的兜底值保留在 unlayered :root，优先级高于 @layer theme。
    expect(globalsCss).toContain("--radius: 10px;");
  });
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm exec vitest run src/styles/visualSystem.test.ts
```

预期：新 `it` 失败（`inlineOnly` 仍含 `--radius-`，且 `--radius-lg: 12px;` 不存在）。

- [ ] **Step 3: 实现 token 迁移**

在 `src/styles/globals.css` 中：

1. 从 `@theme inline { … }` 块**删除**这 7 行（连同其后的 `--radius-sm` … `--radius-4xl`）：

```css
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 10px;
    --radius-xl: 12px;
    --radius-2xl: 16px;
    --radius-3xl: 18px;
    --radius-4xl: 22px;
```

2. 在 `@theme inline { … }` 块**之后**紧接着新增一个普通 `@theme` 块：

```css
/* ── 圆角：唯一事实源 ──────────────────────────────────────────────
 * 必须是普通 @theme（不是 @theme inline）：普通 @theme 会把变量真实
 * 输出到 :root，Tailwind 工具类 / 手写 CSS / Naive themeOverrides
 * 才能共用同一份数值。inline 会把值烘焙成字面量。
 *
 * 两档：控件档（密集小控件，数值收紧）/ 容器档（卡片浮层弹窗，数值放大）。
 */
@theme {
    --radius-xs: 2px;
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 12px;
    --radius-xl: 16px;
    --radius-2xl: 20px;
    --radius-3xl: 24px;
    --radius-4xl: 28px;
}
```

> 注意：块内缩进用 4 空格，与文件里 `@theme inline` 块保持一致。

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm exec vitest run src/styles/visualSystem.test.ts
```

预期：全部通过。

- [ ] **Step 5: 验证构建产物**

```bash
pnpm build
```

然后检查产物：

```bash
grep -o '\.rounded-lg{[^}]*}' dist/assets/index-*.css | head -1
grep -o '\.rounded-md{[^}]*}' dist/assets/index-*.css | head -1
grep -o -- '--radius-lg: *[^;]*;' dist/assets/index-*.css | head -1
```

预期：`.rounded-lg{border-radius:var(--radius-lg)}`、`.rounded-md{border-radius:var(--radius-md)}`、`--radius-lg: 12px;`。

- [ ] **Step 6: 提交**

```bash
git add src/styles/globals.css src/styles/visualSystem.test.ts
git commit -m "feat(theme): 圆角收敛为 CSS 变量单一事实源并按控件/容器两档重新标定"
```

---

## Task 2: Naive UI themeOverrides 分层

**Files:**
- Modify: `src/modules/theme/naiveTheme.ts`
- Test: `src/modules/theme/naiveTheme.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/modules/theme/naiveTheme.test.ts` 追加：

```ts
  it("derives Naive radii from the shared radius scale", () => {
    const { themeOverrides } = readCurrentNaiveThemeConfig();
    const common = themeOverrides.common ?? {};

    // common 保持控件档：密集控件（Switch / Checkbox / Slider / Tabs）不跟着变大。
    expect(common.borderRadius).toBe("var(--radius-sm)");
    expect(common.borderRadiusSmall).toBe("var(--radius-xs)");

    // 容器档组件显式上调。
    expect(themeOverrides.Card?.borderRadius).toBe("var(--radius-lg)");
    expect(themeOverrides.Dialog?.borderRadius).toBe("var(--radius-2xl)");
    expect(themeOverrides.Dropdown?.borderRadius).toBe("var(--radius-xl)");
    expect(themeOverrides.Popover?.borderRadius).toBe("var(--radius-xl)");
    expect(themeOverrides.Menu?.borderRadius).toBe("var(--radius-lg)");
    expect(themeOverrides.Notification?.borderRadius).toBe("var(--radius-lg)");
    expect(themeOverrides.Message?.borderRadius).toBe("var(--radius-lg)");

    // 控件档组件维持紧凑。
    expect(themeOverrides.Input?.borderRadius).toBe("var(--radius-sm)");
    expect(themeOverrides.Tag?.borderRadius).toBe("var(--radius-xs)");
    expect(themeOverrides.Button?.borderRadiusMedium).toBe("var(--radius-md)");

    // 圆角槽位里不允许再出现字面量 px。
    const radiusSlots = JSON.stringify(themeOverrides).match(/"borderRadius[A-Za-z]*":"[^"]*"/g) ?? [];
    expect(radiusSlots.length).toBeGreaterThan(0);
    for (const slot of radiusSlots) {
      expect(slot).not.toMatch(/:\s*"\d+px"/);
    }
  });
```

> 若 `GlobalThemeOverrides` 类型里 `Message` / `Menu` / `Dropdown` / `Popover` 的 `borderRadius` 字段名不同，以 `node_modules/naive-ui/es/<component>/styles/light.d.ts` 的实际字段名为准，**不要**用 `as any` 绕过类型检查。

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm exec vitest run src/modules/theme/naiveTheme.test.ts
```

预期：新 `it` 失败（当前是 `"4px"` / `"6px"` 字面量）。

- [ ] **Step 3: 实现覆盖表**

在 `src/modules/theme/naiveTheme.ts` 的 `buildNaiveThemeOverrides` 返回值中：

`common` 段：

```ts
      borderRadius: "var(--radius-sm)",
      borderRadiusSmall: "var(--radius-xs)",
```

`Button` 段：

```ts
    Button: {
      borderRadiusTiny: "var(--radius-xs)",
      borderRadiusSmall: "var(--radius-sm)",
      borderRadiusMedium: "var(--radius-md)",
      borderRadiusLarge: "var(--radius-md)",
      textColorPrimary: t["primary-foreground"],
    },
```

其余组件段：

```ts
    Card: {
      borderRadius: "var(--radius-lg)",
    },
    Dialog: {
      borderRadius: "var(--radius-2xl)",
    },
    Dropdown: {
      borderRadius: "var(--radius-xl)",
    },
    Popover: {
      borderRadius: "var(--radius-xl)",
    },
    Menu: {
      borderRadius: "var(--radius-lg)",
    },
    Message: {
      borderRadius: "var(--radius-lg)",
    },
    Input: {
      borderRadius: "var(--radius-sm)",
    },
    Tag: {
      borderRadius: "var(--radius-xs)",
    },
```

在文件顶部加注释说明为什么可以直接传 `var()`：

```ts
/**
 * 圆角槽位直接写 var(--radius-*) 而不是 px 字面量：
 * naive-ui 对 borderRadius 只做字符串透传（'--n-border-radius': value），
 * 全库没有任何数值运算，因此 var() 可以安全穿过。
 * 这样 Tailwind 工具类 / 手写 CSS / Naive 三条路径共用同一份 token。
 */
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm exec vitest run src/modules/theme/naiveTheme.test.ts
```

- [ ] **Step 5: 类型检查**

```bash
pnpm exec vue-tsc --noEmit
```

预期：无错误（若 `Message` / `Menu` 等键在 `GlobalThemeOverrides` 中不存在，TS 会报错，此时按实际类型定义调整键名，**不要**用 `as any`）。

- [ ] **Step 6: 提交**

```bash
git add src/modules/theme/naiveTheme.ts src/modules/theme/naiveTheme.test.ts
git commit -m "feat(theme): Naive UI 圆角覆盖改为共享 token 并区分控件档与容器档"
```

---

## Task 3: 手写 CSS 与组件内硬编码 px 收敛

**Files:**
- Modify: `src/styles/globals.css`
- Modify: `src/app/components/DevBridgeUnavailable.vue`
- Modify: `src/modules/editor/MarkdownEditorPreview.vue`
- Modify: `src/modules/markdown/MarkdownPreviewPane.vue`
- Modify: `src/modules/terminal/TerminalPaneHeader.vue`
- Test: `src/styles/visualSystem.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/styles/visualSystem.test.ts` 追加：

```ts
  it("keeps hand-written radii on the shared radius scale", () => {
    // 手写 CSS 里的圆角必须引用 token，不再出现字面量 px。
    const cssRadius = [...globalsCss.matchAll(/border-radius:\s*([^;]+);/g)].map(
      (m) => m[1].trim(),
    );
    for (const value of cssRadius) {
      // 0 / 999px（胶囊与圆形）/ 50%（椭圆）是刻意的例外。
      expect(value).toMatch(
        /^(0|999px|50%|var\(--radius-[a-z0-9-]+\))$/,
      );
    }
  });
```

并新增一个扫描组件源码的断言：

```ts
  it("keeps component radii on the shared radius scale", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".vue") && !entry.name.endsWith(".ts")) continue;
        const source = readFileSync(full, "utf8");
        source.split("\n").forEach((line, index) => {
          // 任意值圆角（如 rounded-[6px]）必须换成档位工具类。
          if (/rounded-\[[^\]]+\]/.test(line)) {
            offenders.push(`${full}:${index + 1} 任意值圆角`);
          }
          // 字面量 px 圆角（999px 圆形除外）。
          const hit = line.match(/border-radius:\s*(\d+px)/);
          if (hit && hit[1] !== "999px") {
            offenders.push(`${full}:${index + 1} 字面量圆角 ${hit[1]}`);
          }
        });
      }
    };
    walk(new URL("../", import.meta.url).pathname);
    expect(offenders).toEqual([]);
  });
```

需要在文件顶部补 import：`import { readdirSync } from "node:fs";`（`readFileSync` 已导入）。

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm exec vitest run src/styles/visualSystem.test.ts
```

预期：两条新 `it` 均失败（`globals.css` 有 `border-radius: 4px;` 等；组件有 `rounded-[6px]`、`border-radius: 5px` 等）。

- [ ] **Step 3: 收敛 `src/styles/globals.css`**

在 `@layer components` 内：

| 选择器 | 原值 | 新值 | 档位 |
|---|---|---|---|
| `.nexterm-icon-button` | `border-radius: 4px;` | `border-radius: var(--radius-sm);` | 控件 |
| `.nexterm-row` | `@apply rounded-md transition-colors;` | `@apply rounded-sm transition-colors;` | 控件 |
| `.nexterm-overlay` | `border-radius: 8px;` | `border-radius: var(--radius-xl);` | 容器 |
| `.nexterm-card` | `border-radius: 6px;` | `border-radius: var(--radius-lg);` | 容器 |
| `.nexterm-card-elevated` | `border-radius: 8px;` | `border-radius: var(--radius-lg);` | 容器 |
| `.v2-skeleton`（骨架屏） | `border-radius: 4px;` | `border-radius: var(--radius-sm);` | 控件 |

**保持不变**（刻意例外，勿动）：

- `.nexterm-settings-group.n-card { border-radius: 0 !important; }`
- edge-to-edge 的 `#root { border-radius: 0; }`
- `border-radius: 999px !important;`（胶囊）
- `border-radius: 50%`（若有）

- [ ] **Step 4: 收敛组件内硬编码**

| 文件:行 | 原值 | 新值 | 档位 |
|---|---|---|---|
| `src/app/components/DevBridgeUnavailable.vue:89` | `border-radius: 12px;` | `border-radius: var(--radius-lg);` | 容器 |
| `src/app/components/DevBridgeUnavailable.vue:123` | `border-radius: 4px;` | `border-radius: var(--radius-sm);` | 控件 |
| `src/app/components/DevBridgeUnavailable.vue:135` | `border-radius: 8px;` | `border-radius: var(--radius-lg);` | 容器 |
| `src/app/components/DevBridgeUnavailable.vue:161` | `border-radius: 8px;` | `border-radius: var(--radius-lg);` | 容器 |
| `src/modules/editor/MarkdownEditorPreview.vue:79` | `border-radius: 5px;` | `border-radius: var(--radius-sm);` | 控件 |
| `src/modules/editor/MarkdownEditorPreview.vue:89` | `border-radius: 8px;` | `border-radius: var(--radius-lg);` | 容器 |
| `src/modules/markdown/MarkdownPreviewPane.vue:173` | `border-radius: 5px;` | `border-radius: var(--radius-sm);` | 控件 |
| `src/modules/markdown/MarkdownPreviewPane.vue:183` | `border-radius: 8px;` | `border-radius: var(--radius-lg);` | 容器 |
| `src/modules/terminal/TerminalPaneHeader.vue:183` | `border-radius: 4px;` | `border-radius: var(--radius-sm);` | 控件 |

- [ ] **Step 5: 运行测试确认通过**

```bash
pnpm exec vitest run src/styles/visualSystem.test.ts
```

- [ ] **Step 6: 提交**

```bash
git add src/styles/globals.css src/app/components/DevBridgeUnavailable.vue \
  src/modules/editor/MarkdownEditorPreview.vue src/modules/markdown/MarkdownPreviewPane.vue \
  src/modules/terminal/TerminalPaneHeader.vue src/styles/visualSystem.test.ts
git commit -m "refactor(theme): 手写 CSS 与组件内硬编码圆角收敛到 radius token"
```

---

## Task 4: 档位复核 —— 壳层与设置

**Files:**
- Modify: `src/app/shell/TopBar.vue`
- Modify: `src/app/shell/PanelControlCluster.vue`
- Modify: `src/app/shell/WorkspaceSwitcher.vue`
- Modify: `src/app/components/WorkspaceDashboard.vue`
- Modify: `src/settings/sections/AppearanceSection.vue`
- Modify: `src/settings/sections/KeybindingsSection.vue`
- Modify: `src/modules/ssh/SshConnectDialog.vue`
- Modify: `src/modules/picker/FilePickerDialog.vue`

- [ ] **Step 1: 写失败测试**

在 `src/styles/visualSystem.test.ts` 的「组件圆角」扫描断言里补充一条规则：模板中不允许出现裸 `rounded`（必须带档位后缀），避免留下语义模糊的 10px 档。

```ts
          // 裸 rounded 等于 var(--radius)=10px，夹在控件档(6)与容器档(12)之间，
          // 语义模糊，必须显式选档。
          if (/(^|[\s"'`])rounded([\s"'`])/.test(line)) {
            offenders.push(`${full}:${index + 1} 裸 rounded 未选档`);
          }
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm exec vitest run src/styles/visualSystem.test.ts
```

预期：失败，列出所有裸 `rounded` 与 `rounded-[…]` 的位置。

- [ ] **Step 3: 按档位表改（壳层与设置）**

| 文件:行 | 原 | 新 | 理由 |
|---|---|---|---|
| `app/shell/TopBar.vue:144` | `rounded-lg` | `rounded-md` | 顶栏内按钮组容器，控件档 |
| `app/shell/PanelControlCluster.vue:91` | `rounded-lg` | `rounded-md` | 分段控件容器，控件档 |
| `app/shell/WorkspaceSwitcher.vue:234` | `rounded-lg` | `rounded-md` | 触发器按钮（h-7），控件档 |
| `app/shell/WorkspaceSwitcher.vue:239` | `rounded-[5px]` | `rounded-sm` | 18px 工作区徽标，控件档 |
| `app/shell/WorkspaceSwitcher.vue:277` | `rounded-lg` | `rounded-md` | 浮层内列表行容器，控件档 |
| `app/shell/WorkspaceSwitcher.vue:285` | `rounded-lg` | `rounded-md` | 浮层内图标切换组，控件档 |
| `app/shell/WorkspaceSwitcher.vue:300` | `rounded-[5px]` | `rounded-sm` | 18px 环境徽标，控件档 |
| `app/shell/WorkspaceSwitcher.vue:391` | `rounded-lg` | `rounded-xl` | 玻璃拖拽浮层（`v2-glass-float`），容器档 |
| `app/components/WorkspaceDashboard.vue:76` | `rounded-xl` | `rounded-lg` | 主 CTA 按钮（h-11），控件档上界 |
| `app/components/WorkspaceDashboard.vue:103` | `rounded-lg` | `rounded-md` | 36px 图标底板，控件档 |
| `settings/sections/AppearanceSection.vue:92` | `rounded-md` | `rounded-lg` | 强调色色板卡片，容器档 |
| `settings/sections/KeybindingsSection.vue:204` | `rounded-md` | `rounded-lg` | 键位列表容器（divide-y），容器档 |
| `settings/sections/KeybindingsSection.vue:249` | `rounded-md` | `rounded-lg` | 下拉浮层（w-64 + shadow），容器档 |
| `modules/ssh/SshConnectDialog.vue:251` | `rounded-[6px]` | `rounded-lg` | 表单分组容器，容器档 |
| `modules/ssh/SshConnectDialog.vue:319` | `rounded-[6px]` | `rounded-md` | 错误提示条，控件档 |
| `modules/ssh/SshConnectDialog.vue:345` | `rounded-[6px]` | `rounded-md` | 条目行，控件档 |
| `modules/picker/FilePickerDialog.vue:397` | `rounded` | `rounded-sm` | 12px 文件名 chip，控件档 |
| `modules/picker/FilePickerDialog.vue:493` | `rounded-md` | `rounded-lg` | h-72 列表面板，容器档 |

**保持不变**（控件档，值本就正确）：

- `app/shell/WorkspaceSwitcher.vue:295, 328, 344, 352, 367, 379, 397`（`rounded-md`）
- `app/components/WorkspaceDashboard.vue:98`（`rounded-xl`，最近工作区卡片 → 容器档，16px 正确）
- `settings/sections/KeybindingsSection.vue:180, 239`（`rounded-md`）

- [ ] **Step 4: 运行测试确认通过（仅剩 Task 5 范围的违规）**

```bash
pnpm exec vitest run src/styles/visualSystem.test.ts
```

预期：剩余违规项全部落在 Task 5 的文件列表内。

- [ ] **Step 5: 提交**

```bash
git add src/app/shell src/app/components/WorkspaceDashboard.vue src/settings/sections \
  src/modules/ssh/SshConnectDialog.vue src/modules/picker/FilePickerDialog.vue src/styles/visualSystem.test.ts
git commit -m "refactor(theme): 壳层与设置面板圆角按控件档/容器档重新选档"
```

---

## Task 5: 档位复核 —— 工作区模块

**Files:**
- Modify: `src/modules/explorer/FileExplorer.vue`
- Modify: `src/modules/explorer/ExplorerSearchPanel.vue`
- Modify: `src/modules/explorer/ExplorerSearch.vue`
- Modify: `src/modules/explorer/lib/menuItemClass.ts`
- Modify: `src/modules/search/FindInFilesPanel.vue`
- Modify: `src/modules/commands/CommandPalette.vue`
- Modify: `src/modules/editor/EditorBreadcrumb.vue`
- Modify: `src/modules/preview/PreviewAddressBar.vue`
- Modify: `src/modules/source-control/SourceControlPanel.vue`

- [ ] **Step 1: 按档位表改**

| 文件:行 | 原 | 新 | 理由 |
|---|---|---|---|
| `modules/explorer/FileExplorer.vue:638` | `rounded` | `rounded-sm` | 10px 文件名徽标，控件档 |
| `modules/explorer/FileExplorer.vue:726` | `rounded-lg` | `rounded-xl` | 玻璃浮层容器（`v2-glass-float` + shadow-lg），容器档 |
| `modules/explorer/FileExplorer.vue:762` | `rounded-md` | `rounded-lg` | 拖拽 ghost 浮层，容器档 |
| `modules/explorer/ExplorerSearchPanel.vue:80` | `rounded-lg` | `rounded-md` | 分段控件容器，控件档 |
| `modules/explorer/ExplorerSearchPanel.vue:107` | `rounded` | `rounded-sm` | 20px 图标按钮，控件档 |
| `modules/explorer/ExplorerSearchPanel.vue:150` | `rounded` | `rounded-sm` | 20px 图标按钮，控件档 |
| `modules/explorer/ExplorerSearch.vue:167` | `rounded` | `rounded-sm` | 20px 图标按钮，控件档 |
| `modules/explorer/lib/menuItemClass.ts:4` | `rounded-xl` | `rounded-md` | 右键菜单项（`COMPACT_ITEM`），控件档 |
| `modules/explorer/lib/menuItemClass.ts:5` | `rounded-2xl` | `rounded-xl` | 右键菜单浮层（`COMPACT_CONTENT`），容器档 |
| `modules/search/FindInFilesPanel.vue:272` | `rounded` | `rounded-sm` | 24px 复选框，控件档 |
| `modules/search/FindInFilesPanel.vue:287` | `rounded` | `rounded-sm` | 24px 复选框，控件档 |
| `modules/search/FindInFilesPanel.vue:364` | `rounded` | `rounded-sm` | 搜索结果行，控件档 |
| `modules/commands/CommandPalette.vue:269` | `rounded` | `rounded-sm` | 10px 作用域 chip，控件档 |
| `modules/commands/CommandPalette.vue:338` | `rounded` | `rounded-sm` | 10px 作用域 chip，控件档 |
| `modules/editor/EditorBreadcrumb.vue:69` | `rounded` | `rounded-sm` | 面包屑路径段按钮，控件档 |
| `modules/editor/EditorBreadcrumb.vue:79` | `rounded` | `rounded-sm` | 面包屑路径段按钮，控件档 |
| `modules/preview/PreviewAddressBar.vue:175` | `rounded` | `rounded-sm` | 10px 操作按钮，控件档 |
| `modules/source-control/SourceControlPanel.vue:552` | `rounded` | `rounded-sm` | 小链接按钮，控件档 |
| `modules/source-control/SourceControlPanel.vue:561` | `rounded` | `rounded-sm` | 小链接按钮，控件档 |

**保持不变**（控件档，值本就正确）：

- `modules/explorer/FileTreeRow.vue:173`（`rounded-sm`，树行）
- `modules/explorer/ExplorerSearchPanel.vue:91, 141`
- `modules/explorer/ExplorerSearch.vue:160`
- `modules/search/FindInFilesPanel.vue:264, 303`
- `modules/git-history/GitHistoryPane.vue:722`
- `modules/source-control/SourceControlChangeList.vue:181`
- `modules/source-control/SourceControlGitWorkflows.vue:325`
- `modules/source-control/SourceControlRemotes.vue:184`
- `modules/source-control/SourceControlTags.vue:199`
- `modules/editor/EditorToolbar.vue:48`

- [ ] **Step 2: 运行测试确认全部通过**

```bash
pnpm exec vitest run src/styles/visualSystem.test.ts
```

预期：全部通过，`offenders` 为空数组。

- [ ] **Step 3: 全量测试**

```bash
pnpm test
```

- [ ] **Step 4: 提交**

```bash
git add src/modules/explorer src/modules/search src/modules/commands \
  src/modules/editor/EditorBreadcrumb.vue src/modules/preview/PreviewAddressBar.vue \
  src/modules/source-control/SourceControlPanel.vue
git commit -m "refactor(theme): 工作区模块圆角按控件档/容器档重新选档"
```

---

## Task 6: 全量验证与人工回归清单

**Files:** 无代码改动（仅在发现问题时回补对应任务）

- [ ] **Step 1: 全量前端测试**

```bash
pnpm test
```

- [ ] **Step 2: 类型检查 + 构建**

```bash
pnpm build
```

- [ ] **Step 3: Rust 侧无改动确认**

```bash
cd src-tauri && cargo check --all-targets --locked
```

预期：`Finished`（本次无 Rust 改动，应无新增编译错误）。

- [ ] **Step 4: 人工回归清单**

启动 `pnpm tauri dev`，逐项确认：

- [ ] 设置抽屉：分组卡片仍是无框的（分隔线分隔），**没有**被圆润化
- [ ] 命令面板：浮层圆角明显变大，作用域 chip 仍紧凑
- [ ] 文件树：行圆角保持 4px，未变圆；右键菜单项紧凑、菜单浮层 16px
- [ ] 右侧工作区面板 / 左侧面板：卡片与浮层 12–16px
- [ ] SSH 连接对话框：20px 圆角，表单分组 12px，错误条 6px
- [ ] 文件选择对话框：列表面板 12px，文件名 chip 4px
- [ ] 标签栏 / 会话条 / 状态坞：紧凑，未变圆
- [ ] 终端 pane header：按钮仍 4px
- [ ] Markdown 预览：代码块 12px、行内代码 4px
- [ ] 深色 / 浅色主题各走一遍，圆角一致（圆角与主题无关，只由 token 决定）

- [ ] **Step 5: 提交（若回归中发现问题）**

```bash
git add -A
git commit -m "fix(theme): 圆润化回归修复"
```

---

## 附：档位语义速查

| 元素 | 档位 | 工具类 |
|---|---|---|
| 图标按钮、树行、chip、badge、行内代码 | 控件 | `rounded-sm` (4px) |
| 按钮、输入框、菜单项、提示条 | 控件 | `rounded-md` (6px) |
| 卡片、面板、通知、菜单浮层 | 容器 | `rounded-lg` (12px) |
| 下拉、popover、tooltip 浮层、拖拽 ghost | 容器 | `rounded-xl` (16px) |
| 对话框、抽屉、大型浮层 | 容器 | `rounded-2xl` (20px) |
