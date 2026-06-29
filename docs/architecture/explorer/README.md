# 文件浏览 explorer

## 1. 概述

文件浏览模块提供工作区文件树、文件搜索、右键菜单、内联重命名。文件树状态变化由 `useWorkspaceLifecycle` 注入的 FS watcher 事件驱动，渲染与计算都在前端完成。

## 2. 目录与文件

```
src/modules/explorer/
  FileExplorer.vue            # 面板主组件
  FileTreeRow.vue             # 单行渲染（虚拟滚动用）
  ExplorerContextMenu.vue     # 右键菜单
  ExplorerSearch.vue          # 顶部搜索框
  InlineTreeInput.vue         # 内联重命名输入
  explorerCommands.ts         # 注册到 commands
  index.ts
  lib/
    fileTreeService.ts        # 树数据源
    fileTreeRows.ts           # 树行计算
    fileIcons.ts              # 文件 -> 图标映射
    folderIcons.ts            # 文件夹图标
    iconResolver.ts           # 解析入口
    contextActions.ts         # 右键菜单动作
    constants.ts              # 常量
    menuItemClass.ts          # Naive UI 菜单 class 工具
```

## 3. 依赖

### 3.1 内部

- `@/lib/native` -- `fsReadDir` / `fsSearch` / `fsCreate*` / `fsRename` / `fsDelete`
- `@/lib/platform` -- 平台相关快捷键
- `@/modules/workspace/workspaceRootPinia` -- 根目录
- `@/modules/settings/preferencesPinia` -- `showHidden`
- `@/modules/notifications/notificationCenter` -- 错误提示
- `@/modules/tabs` -- 双击打开为 EditorTab

### 3.2 外部

- `naive-ui` -- 树、菜单、图标按钮
- `@vicons/ionicons5` / `@iconify-json/catppuccin` -- 图标

## 4. 数据契约

### 4.1 Tauri 命令

| 命令 | 说明 |
|------|------|
| `fs_read_dir` | 读目录条目 |
| `fs_search` | 按名字搜索 |
| `fs_list_files` | 递归列文件 |
| `fs_create_file` / `fs_create_dir` | 新建 |
| `fs_rename` | 重命名 |
| `fs_delete` | 删除 |
| `fs_canonicalize` | 路径归一化 |

### 4.2 事件

- 监听 `nexterm://workspace-fs-changed` 触发树更新。

## 5. Pinia 状态

无独立 store。文件树 rows 缓存在 `lib/fileTreeRows.ts` 的内部 ref；展开集合 / 选中行由 `FileExplorer.vue` 维护。

## 6. 关键算法

- `fileTreeRows` 把后端 `FsDirEntry` 列表展开成"行视图"，支持虚拟滚动。
- 路径分隔符在 `@/lib/path` 归一化，兼容 Windows / Unix。
- 右键菜单的可见性由 `contextActions` 决定，根据节点类型（文件 / 目录 / 隐藏）筛选。

## 7. 配置项

- `preferencesPinia.showHidden` -- 是否显示隐藏文件
- `preferencesPinia.explorerPanelWidth` -- 面板宽度

## 8. 测试

- `lib/fileTreeService.test.ts` / `lib/fileTreeRows.test.ts` / `lib/fileTreeRowsUpdate.test.ts` / `lib/contextActions.test.ts`
- `FileExplorer.vue.test.ts` -- 组件（含 git tones 测试，main 上有 1 个预存在失败）
- `explorerVueBoundary.test.ts` -- 边界

## 9. 相关文档

- [详细设计](./detailed-design.md)
