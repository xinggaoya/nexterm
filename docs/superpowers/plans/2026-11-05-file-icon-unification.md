# 文件图标统一化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把散落在 `explorer` 内部的图标能力收口成共享模块，给 Git 变更面板补上文件类型 / 编程语言 Logo，并修正浅色主题下图标对比度。

**Architecture:** 新建 `src/modules/icons` 模块作为图标唯一出口（内部持 catppuccin 图标集 + 自维护映射表，对外只暴露 `fileIconUrl` / `folderIconUrl`）。所有展示文件的界面（文件树、搜索、命令面板、文件选择器、Git 历史、Git 变更、标签条）统一从该模块取图标。`src/lib/path.ts` 增加 `splitPathLabel` 供"文件名 + 目录"两段式展示复用。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript strict、Naive UI、Tailwind CSS v4、Vitest、`@iconify-json/catppuccin`（已有依赖，不新增）。

**Spec:** 本文件既是设计决策也是实施计划（用户已确认选型：复用现有 catppuccin / 统一收口 + 补齐源控面板 / basename + 灰色目录前缀）。

## Global Constraints

- **不新增任何 npm 依赖**：图标库继续使用 `@iconify-json/catppuccin`（已安装）。
- **不改变任何现有功能与交互**：Git 变更面板的勾选框、状态标签、暂存/取消暂存/丢弃按钮、分组与虚拟滚动逻辑全部保持原样。
- **不改变现有图标视觉风格**：继续使用 catppuccin 细线描边 + 品牌色，只补覆盖范围，不换风格。
- **IPC 边界不变**：本计划不触碰 `src/lib/native.ts` 与 `src-tauri/`，纯前端重构。
- 所有新增/修改的 `.vue` / `.ts` 必须通过 `vue-tsc --noEmit` 与 `vitest run`。
- 提交信息用中文，Conventional Commit 前缀（`feat:` / `refactor:` / `fix:` / `docs:` / `test:`）。

## Review Focus

以下五类输入/条件最容易被漏测，实现时必须为每一条补上对应断言：

1. **传入的是完整路径而非文件名**（如 `apps/cli/package.json`）——必须仍解析出 JSON 图标，不能回落通用文件图标。
2. **无扩展名的文件**（`Makefile`、`Dockerfile`、`LICENSE`）——必须命中按文件名映射的具体图标。
3. **点开头��隐藏文件**（`.gitignore`、`.env.local`）——必须命中按文件名映射的图标，而不是按扩展名回落。
4. **单段路径无目录**（`package.json`）——目录前缀必须为空字符串，不能出现 `/` 或空标签。
5. **浅色主题**——Catppuccin 图标是写死的 Latte 浅色调色板，浅色背景下必须经过滤镜压暗，否则几乎不可见。

---

### Task 1: 建立 `src/modules/icons` 共享模块

**Files:**
- Create: `src/modules/icons/lib/iconSet.ts` — 加载 catppuccin 图标集、slug 归一、alias 解析、data-URL 构建与缓存
- Create: `src/modules/icons/lib/fileIcons.ts` — 从 `src/modules/explorer/lib/fileIcons.ts` 原样迁移
- Create: `src/modules/icons/lib/folderIcons.ts` — 从 `src/modules/explorer/lib/folderIcons.ts` 原样迁移
- Create: `src/modules/icons/lib/languageIds.ts` — 从 `src/modules/explorer/lib/constants.ts` 迁移 `EXT_TO_LANGUAGE_ID`
- Create: `src/modules/icons/fileIcon.ts` — `fileIconUrl` / `folderIconUrl`
- Create: `src/modules/icons/index.ts` — 模块公开出口
- Create: `src/modules/icons/fileIcon.test.ts` — 模块单测
- Delete: `src/modules/explorer/lib/iconResolver.ts`、`src/modules/explorer/lib/fileIcons.ts`、`src/modules/explorer/lib/folderIcons.ts`、`src/modules/explorer/lib/constants.ts`

**Interfaces:**
- Consumes: `@iconify-json/catppuccin/icons.json`
- Produces:
  - `fileIconUrl(name: string): string` — 返回 SVG data-URL
  - `folderIconUrl(name: string, expanded: boolean): string`
  - `EXT_TO_LANGUAGE_ID: Record<string, string>`

- [ ] **Step 1: 写失败测试** `src/modules/icons/fileIcon.test.ts`

断言：
- `fileIconUrl("main.rs")` / `fileIconUrl("package.json")` / `fileIconUrl("app.vue")` / `fileIconUrl("AGENTS.md")` 互不相同（都命中具体图标而非通用回落）。
- `fileIconUrl("__no_such_file__")` 等于 `fileIconUrl("")`（通用回落）。
- `folderIconUrl("src", false)` 与 `folderIconUrl("src", true)` 返回不同 URL（展开态切换）。
- `folderIconUrl("unknown-dir-xyz", false)` 回落到通用目录图标。

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm exec vitest run src/modules/icons/fileIcon.test.ts`
Expected: FAIL —— 模块尚不存在（`Cannot find module '@/modules/icons'`）。

- [ ] **Step 3: 实现模块**

`iconSet.ts` 负责一切 SVG 细节：`toIconifySlug`（`_` → `-`）、`catBody`（直查 + alias 解析）、`buildDataUrl`（带 `Map` 缓存）。`fileIcon.ts` 只做查表策略：文件名 → 扩展名 → 语言 ID → 通用回落；扩展名逐段回退（`tar.gz` → `gz`）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm exec vitest run src/modules/icons/fileIcon.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add src/modules/icons src/modules/explorer/lib/iconResolver.ts src/modules/explorer/lib/fileIcons.ts src/modules/explorer/lib/folderIcons.ts src/modules/explorer/lib/constants.ts
git commit -m "refactor: 抽出 icons 共享模块，收口文件图标能力"
```

---

### Task 2: 全量迁移图标引用

**Files:**
- Modify: `src/modules/explorer/FileTreeRow.vue`、`src/modules/explorer/FileExplorer.vue`、`src/modules/explorer/ExplorerSearch.vue`
- Modify: `src/modules/git-history/GitHistoryPane.vue`、`src/modules/search/FindInFilesPanel.vue`、`src/modules/picker/FilePickerDialog.vue`、`src/modules/commands/CommandPalette.vue`、`src/app/shell/SessionStrip.vue`
- Modify: 对应测试 mock：`src/modules/explorer/FileExplorer.vue.test.ts`、`src/modules/explorer/ExplorerSearch.vue.test.ts`、`src/modules/search/FindInFilesPanel.vue.test.ts`、`src/modules/picker/FilePickerDialog.vue.test.ts`、`src/app/shell/SessionStrip.vue.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `@/modules/icons` 出口
- Produces: 无新接口

- [ ] **Step 1: 把生产代码的 import 全部改成 `@/modules/icons`**

用 `Grep` 确认 `src/` 下不再出现 `@/modules/explorer/lib/iconResolver`。

- [ ] **Step 2: 同步更新测试里的 `vi.mock` 路径**

`vi.mock("@/modules/explorer/lib/iconResolver", ...)` → `vi.mock("@/modules/icons", ...)`。

- [ ] **Step 3: 运行全量测试**

Run: `pnpm test`
Expected: 全部 PASS。

- [ ] **Step 4: 类型检查**

Run: `pnpm exec vue-tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git commit -am "refactor: 全部文件展示面改用 icons 共享模块"
```

---

### Task 3: 路径归一与 `splitPathLabel`

**Files:**
- Modify: `src/lib/path.ts` — 新增 `splitPathLabel(path: string): { name: string; dir: string }`
- Modify: `src/modules/icons/fileIcon.ts` — `fileIconUrl` / `folderIconUrl` 内部先取 basename
- Create: `src/lib/path.test.ts`（若不存在则新建；已存在则追加用例）

**Interfaces:**
- Produces:
  - `splitPathLabel(path: string): { name: string; dir: string }` —— `dir` 为 `""`（不是 `"/"`）当路径只有一段；同时支持 `/` 与 `\` 分隔符

- [ ] **Step 1: 写失败测试**

- `splitPathLabel("apps/cli/package.json")` → `{ name: "package.json", dir: "apps/cli" }`
- `splitPathLabel("package.json")` → `{ name: "package.json", dir: "" }`
- `splitPathLabel("src\\main.rs")` → `{ name: "main.rs", dir: "src" }`
- `fileIconUrl("apps/cli/package.json")` === `fileIconUrl("package.json")`

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/lib/path.test.ts src/modules/icons/fileIcon.test.ts`
Expected: FAIL —— `splitPathLabel` 未定义 / 路径未归一。

- [ ] **Step 3: 实现**

`fileIcon.ts` 里 `const base = basename(name.toLowerCase())` 后再走查表。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/lib/path.test.ts src/modules/icons/fileIcon.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git commit -am "feat: 图标解析支持完整路径，新增 splitPathLabel"
```

---

### Task 4: Git 变更面板接入文件类型 Logo

**Files:**
- Modify: `src/modules/source-control/SourceControlChangeRow.vue`
- Modify: `src/modules/source-control/sourceControlFormat.ts` — 如需新增展示辅助函数则放这里
- Create: `src/modules/source-control/SourceControlChangeRow.vue.test.ts`

**Interfaces:**
- Consumes: `fileIconUrl`（`@/modules/icons`）、`splitPathLabel`（`@/lib/path`）
- Produces: 无新接口（组件 props / emits 不变）

- [ ] **Step 1: 写失败测试**

挂载组件，断言：
- 渲染出的图标 `img` 的 `src` 等于 `fileIconUrl("package.json")`（用 `vi.mock("@/modules/icons")` 断言）。
- 目录前缀元素存在且文本为 `apps/cli`。
- 状态标签 `M` 仍渲染（功能不变）。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/modules/source-control/SourceControlChangeRow.vue.test.ts`
Expected: FAIL —— 还没有图标 img 与目录前缀。

- [ ] **Step 3: 实现**

- 图标：`fileIconUrl(label.name)`，尺寸 `size-3.5`，**不再用状态色染色**（状态信息已由文件名文字色 + 右侧状态标签承载，颜色语义不丢）。
- 布局：`[图标] [文件名] [灰色目录前缀]`，文件名 `truncate`，目录前缀 `text-muted-foreground` 且 `truncate`。
- 保留 `entry.path` 在 `:data-source-file` 与 `:aria-label` 上（自动化与无障碍不受影响）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/modules/source-control/SourceControlChangeRow.vue.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git commit -am "feat: Git 变更面板展示文件类型 Logo 与目录前缀"
```

---

### Task 5: 浅色主题图标对比度

**Files:**
- Modify: `src/styles/globals.css` — 新增 `.light .nexterm-file-icon` 滤镜规则
- Modify: 所有渲染图标 `<img>` 的 `.vue` — 追加 `nexterm-file-icon` class
- Modify: `src/styles/visualSystem.test.ts` — 追加契约断言

**Interfaces:**
- Produces: CSS class `nexterm-file-icon`

- [ ] **Step 1: 写失败测试**（`visualSystem.test.ts`）

断言 `globalsCss` 包含 `.nexterm-file-icon`，且包含针对 `.light` 的滤镜规则；同时断言至少一个消费方组件源码包含 `nexterm-file-icon`。

- [ ] **Step 2: 运行确认失败**

Run: `pnpm exec vitest run src/styles/visualSystem.test.ts`
Expected: FAIL —— 规则还不存在。

- [ ] **Step 3: 实现**

```css
/* Catppuccin 图标使用写死的 Latte 浅色调色板；浅色主题下需要压暗提亮，
   否则图标几乎与背景同色。深色主题保持原色。 */
.light .nexterm-file-icon {
    filter: brightness(0.62) saturate(1.15);
}
```

给所有文件图标 `<img>` 追加 `nexterm-file-icon`。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm exec vitest run src/styles/visualSystem.test.ts`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git commit -am "fix: 修复浅色主题下文件图标对比度"
```

---

### Task 6: 文档与全量验证

**Files:**
- Create: `docs/architecture/icons/README.md`
- Modify: `docs/architecture/README.md`（模块索引加一行）
- Modify: `docs/architecture/explorer/README.md`（移除图标实现归属说明）
- Modify: `docs/architecture/source-control/README.md`（依赖指向 `@/modules/icons`）

- [ ] **Step 1: 写 `docs/architecture/icons/README.md`**

按 `_template.md` 的 1~8 节结构写：职责 / 目录结构 / 公开 API / 数据来源 / 依赖 / 主题适配 / 测试 / 边界。

- [ ] **Step 2: 更新其余三份文档**

- [ ] **Step 3: 全量验证**

Run: `pnpm test` → 全部 PASS
Run: `pnpm build` → `vue-tsc --noEmit && vite build` 成功

- [ ] **Step 4: 提交**

```bash
git commit -am "docs: 补充 icons 模块架构文档"
```
