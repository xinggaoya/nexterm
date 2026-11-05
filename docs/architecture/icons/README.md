# 文件图标 icons

## 1. 概述

`icons` 模块是全应用**文件 / 目录类型图标的唯一出口**：把文件名或路径映射成一枚可识别的图标（编程语言 Logo、框架 Logo、通用文件 / 目录图标）。

它存在的原因很直接：文件图标是跨模块复用的基础能力，此前实现寄居在 `modules/explorer/lib/` 下，却被 source-control、search、picker、commands、git-history 五个模块反向依赖——explorer 的内部实现事实上变成了全局工具。本模块把这块能力收口到独立目录，依赖方向变成 `各业务模块 -> icons`，不再有人从 explorer 内部取图标。

图标全部**离线内置**，运行时不发起任何网络请求。

## 2. 目录与文件

```
src/modules/icons/
  fileIcon.ts                 # 对外 API：fileIconUrl / folderIconUrl（查表策略）
  fileIcon.test.ts            # 解析规则单测
  index.ts                    # 模块出口
  lib/
    iconSet.ts                # 图标集底层：slug 归一 / alias 解析 / data-URL 构建 + 缓存
    fileIcons.ts              # 文件类型 -> 图标名映射（392 类）
    folderIcons.ts            # 目录名 -> 图标名映射（113 类）
    languageIds.ts            # 扩展名 -> 语言 ID 回退表
```

## 3. 依赖

### 3.1 内部依赖

- `@/lib/path` -- `basename`（解析前先取文件名，入参可以是完整路径）

### 3.2 外部依赖

- `@iconify-json/catppuccin` -- Catppuccin 官方图标集（659 个图标，含编程语言 / 框架 / 文件类型 Logo），构建期直接内联进产物

## 4. 数据契约

### 4.1 公共 API

```ts
/** 文件图标 data-URL。入参可以是文件名，也可以是完整路径。 */
export function fileIconUrl(name: string): string;

/** 目录图标 data-URL。expanded 决定用展开态还是收起态图标。 */
export function folderIconUrl(name: string, expanded: boolean): string;
```

返回值是 `data:image/svg+xml;utf8,...`，可直接用作 `<img src>`。

### 4.2 Tauri 命令 / 事件

无。本模块是纯前端渲染能力，不触碰 IPC。

## 5. Pinia 状态

无。

## 6. 关键算法 / 数据流

解析顺序：**精确文件名 → 扩展名 → 语言 ID → 通用回落图标**。

```
        fileIconUrl("apps/cli/package.json")
                     │
             basename → "package.json"
                     │
      ┌──────────────┼───────────────┐
      ▼              ▼               ▼
  fileNames     fileExtensions   EXT_TO_LANGUAGE_ID
  "package.json" → "json"          → languageIds
      │              │               │
      └──────────────┴───────────────┘
                     │ 命中即用
                     ▼
              catppuccin icons.json
                     │  SVG body → data-URL（Map 缓存）
                     ▼
               <img src="data:image/svg+xml;utf8,…">
```

要点：

- **扩展名逐段回退**：`foo.tar.gz` 先试 `tar.gz`，再试 `gz`，命中即止。
- **入参先取 basename**：因此 `fileIconUrl("apps/cli/package.json")` 与 `fileIconUrl("package.json")` 结果一致，避免调用方漏切路径导致回落成通用图标。
- **缓存**：`iconSet.ts` 用 `Map` 缓存 data-URL；未命中（空结果）也会缓存，避免同一个未知图标反复走查表。
- **slug 归一**：Catppuccin 的清单里名字是 `folder_src` 形式，Iconify 导出统一成连字符 slug，`iconSet.ts` 内部做 `_ -> -` 转换。

## 7. 配置项

- 图标集：`@iconify-json/catppuccin`（`icons.json` 约 300 KB，随包内置）
- 主题适配：`.nexterm-file-icon` 是所有文件图标 `<img>` 的统一 class。Catppuccin 图标内置的是写死的 **Catppuccin Latte 浅色调色板**，深色主题下正好；浅色主题下几乎与背景同色，由 `globals.css` 里的 `.light .nexterm-file-icon { filter: brightness(0.6) saturate(1.2); }` 压暗提亮。

## 8. 测试

- `fileIcon.test.ts` -- 解析规则：常见文件类型各自命中不同图标、无扩展名文件（`Makefile`）、点开头隐藏文件（`.gitignore`）、复合扩展名回退、完整路径等价、大小写不敏感、目录展开态切换、未知类型回落
- `iconsBoundary.test.ts` -- 模块边界：图标实现不得回流 explorer、其它模块只能经 `@/modules/icons` barrel 取图标、映射表归属本模块

## 9. 相关文档

- [跨模块相关] -- `docs/architecture/02-module-contracts.md`（模块边界与依赖方向）
- [文件浏览 explorer](../explorer/README.md) -- 文件树消费本模块的图标
- [源代码控制 source-control](../source-control/README.md) -- Git 变更行消费本模块的图标
