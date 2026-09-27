# 文件浏览 explorer

## 1. 概述

文件浏览模块提供工作区文件树、文件搜索、内容搜索、右键菜单、内联重命名，以及**批量搬运**（拖拽移动/复制、剪切粘贴、从系统拖文件进工作区）。文件树状态变化由 `useWorkspaceLifecycle` 注入的 FS watcher 事件驱动，渲染与计算都在前端完成；真正写盘的动作一律经 `fs_move_many` / `fs_copy_many` 交给 Rust。

组件被拆成三层 composable（数据 / 选择 / 搬运），依赖单向无环，详见 [详细设计](./detailed-design.md)。

## 2. 目录与文件

```
src/modules/explorer/
  FileExplorer.vue                    # 面板主组件（组装 + 模板）
  FileTreeRow.vue                     # 单行渲染（虚拟滚动用）
  ExplorerContextMenu.vue             # 右键菜单
  ExplorerSearch.vue                  # 顶部按名字搜索
  InlineTreeInput.vue                 # 内联重命名 / 新建输入
  FileTransferConflictDialog.vue      # 搬运冲突征询（覆盖/跳过/全部改名）
  explorerCommands.ts                 # 注册到 commands
  index.ts
  composables/
    useFileTreeData.ts                # 数据层：加载、展开态、行集、虚拟滚动、watcher 编排
    useTreeSelection.ts               # 选择层：多选、键盘光标、Shift 锚点、键盘导航
    useTreeTransfer.ts                # 搬运层：拖拽 / 剪贴板 / OS 拖入共用编排
  lib/
    fileTreeService.ts                # 树数据源（薄封装 fs_*）
    fileTreeRows.ts                   # 行集构建 / 增量 patch / 树过滤
    fileTreeRows.test.ts
    fileTreeRowsUpdate.test.ts
    fileTransfer.ts                   # 搬运计划器（纯函数）
    fileTransfer.test.ts
    fileClipboard.ts                  # per-instance 内存剪贴板
    fileClipboard.test.ts
    contextActions.ts                 # 右键菜单动作（复制路径 / 在文件管理器中显示）
    fileIcons.ts / folderIcons.ts / iconResolver.ts
    constants.ts
    menuItemClass.ts                  # Naive UI 菜单 class 工具
```

## 3. 依赖

### 3.1 内部

- `@/lib/native` -- `fsReadDir` / `fsSearch` / `fsCreate*` / `fsRename` / `fsDelete` / `fsMoveMany` / `fsCopyMany` / `onOsFileDragDrop`
- `@/lib/path` -- `basename` / `dirname` / `joinPath`（跨平台分隔符）
- `@/lib/usePointerDragReorder` -- 指针拖拽手势（与标签重排、工作区重排共用）
- `@/lib/useVirtualWindow` -- 定高行虚拟滚动
- `@/lib/useEventListener` -- 修饰键监听
- `@/modules/workspace` -- `isSameWorkspaceRoot` / `normalizeWorkspacePath`
- `@/modules/settings/preferencesPinia` -- `showHidden`
- `@/modules/notifications/notificationCenter` -- 结果与错误提示
- `@/modules/source-control` -- `GitDecorationMap`（文件树角标）

### 3.2 外部

- `naive-ui` -- 按钮、图标、对话框、输入框
- `@vicons/ionicons5` -- 图标

## 4. 数据契约

### 4.1 Tauri 命令

| 命令 | 说明 |
|------|------|
| `fs_read_dir` | 读目录条目 |
| `fs_search` / `fs_list_files` | 按名字搜索 |
| `fs_grep` / `fs_glob` | 按内容 / glob 搜索（Find in Files 面板） |
| `fs_create_file` / `fs_create_dir` / `fs_rename` / `fs_delete` / `fs_copy` | 单条文件操作（撞名即失败） |
| `fs_move_many` / `fs_copy_many` | **批量搬运**：逐条结算 + 冲突三策略；本地 / WSL / SSH 共用 `nexterm-fs-core` 的同一份实现 |

### 4.2 事件

- 监听 `nexterm://workspace-fs-changed` 触发树更新（180ms 防抖）。
- 监听 Tauri webview 的 drag-drop 事件（`native.onOsFileDragDrop`）实现"从系统拖文件进工作区"。

### 4.3 对外事件

| 事件 | 消费方 |
|------|--------|
| `pathRenamed` | WorkspaceHost → `tabs.followPath`：重命名/移动后让已打开的 tab 跟随 |
| `pathDeleted` | WorkspaceHost → `tabs.dropPath`：按前缀批量关 tab，脏编辑器保留 |
| `pathDuplicated` | 目前无消费方（通知型，见详细设计 §5） |
| `openFile` / `openFilePreview` / `openMarkdownPreview` / `openInTerminal` / `openSearchResult` | WorkspaceHost |

## 5. Pinia 状态

无独立 store。目录内容缓存在 `useFileTreeData` 的 `reactive` 对象里；展开集合 / 选择集 / 剪贴板由对应 composable 持有，随组件生命周期创建与销毁（每个工作区一份）。

## 6. 关键算法

详见 [详细设计](./detailed-design.md)：搬运计划与守卫、冲突三策略、树过滤的三条规则、虚拟滚动窗口、各类时序参数。

## 7. 配置项

- `preferencesPinia.showHidden` -- 是否显示隐藏文件
- `preferencesPinia.explorerPanelWidth` -- 面板宽度（宿主持有）

## 8. 测试

- `lib/fileTransfer.test.ts` / `lib/fileClipboard.test.ts` / `lib/fileTreeRows.test.ts` / `lib/fileTreeRowsUpdate.test.ts` / `lib/fileTreeService.test.ts` / `lib/contextActions.test.ts`
- `FileExplorer.vue.test.ts` -- 组件行为契约（加载、选择、键盘、拖拽、剪贴板、OS 拖入、过滤、折叠展开）
- `ExplorerContextMenu.vue.test.ts` / `ExplorerSearch.vue.test.ts`
- `explorerVueBoundary.test.ts` -- 模块边界

## 9. 相关文档

- [详细设计](./detailed-design.md)
- [共享搬运语义 crate](../../../src-tauri/fs-core/src/lib.rs)
