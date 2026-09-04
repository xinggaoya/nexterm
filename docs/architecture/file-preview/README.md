# File Preview file-preview

## 1. 概述

File Preview 模块在 `FilePreviewTab` 中渲染图片文件(png/jpg/jpeg/gif/webp/bmp/ico/avif/svg)。文件字节经 `native.fsReadFileBase64` 以 base64 返回,前端拼成 `data:` URL 交给 `<img>`;svg 走同一通道,`<img>` 渲染不会执行内嵌脚本。

## 2. 目录与文件

```
src/modules/file-preview/
  FilePreviewPane.vue            # 单个预览:工具栏 + 状态分支 + <img>
  FilePreviewStack.vue           # 渲染所有 file-preview tab,v-show 切换
  lib/
    imageFiles.ts                # 扩展名判定 + mime 映射
    filePreviewDocumentService.ts # 读取 + 状态机(不抛错)
  index.ts
```

## 3. 依赖

### 3.1 内部依赖

- `@/lib/native` -- `fsReadFileBase64`
- `@/modules/tabs` -- `FilePreviewTab` 状态
- `@/app/workspaceContext` -- Pane 内获取 `wsNative`

### 3.2 外部依赖

- `naive-ui` -- `NIcon` / `NSpin`
- `@vicons/ionicons5` -- `ImageOutline`

## 4. 数据契约

### 4.1 公共类型

```ts
type FilePreviewState =
  | { status: "loading" }
  | { status: "ready"; src: string; size: number }
  | { status: "unsupported" }
  | { status: "toolarge"; size: number; limit: number }
  | { status: "error"; message: string };

function readFilePreview(wsNative: WorkspaceNative, path: string): Promise<FilePreviewState>;
function isBinaryImagePath(path: string): boolean;   // 双击路由:二进制图片
function isPreviewableImagePath(path: string): boolean; // 菜单项:二进制图片 + svg
```

### 4.2 Tauri 命令

`fs_read_file_base64`(经 `native.fsReadFileBase64`)。返回 `{ kind: "content", content, size }` 或 `{ kind: "toolarge", size, limit }`;上限与 `fs_read_file` 同为 10MB。

### 4.3 事件

无。

## 5. Pinia 状态

无独立 store;tab 生命周期在 `tabsPinia.newFilePreviewTab`(按 path 去重合并),文档状态是 Pane 内 ref。

## 6. 关键算法

- 双击路由在 `WorkspaceHost.openFileTab`:二进制图片直接开预览 tab;svg 是文本,双击仍进编辑器,预览走资源管理器右键"打开预览"。
- `filePreviewDocumentService` 扩展名白名单校验(前端过滤,后端不做类型限制)-> base64 -> `data:<mime>;base64,<content>`。

## 7. 配置项

- 大小限制(后端常量 `MAX_READ_BYTES`,10MB)
- 支持的扩展名与 mime 映射(`lib/imageFiles.ts` 内部常量)

## 8. 测试

- `lib/imageFiles.test.ts` -- 扩展名/mime 判定
- `lib/filePreviewDocumentService.test.ts` -- 状态机映射
- `FilePreviewPane.vue.test.ts` -- 渲染分支

## 9. 相关文档

- [tabs 模块](../tabs/README.md) -- tab 类型与生命周期
