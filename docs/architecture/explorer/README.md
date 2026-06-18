# 文件浏览器模块

## 概述

文件浏览器模块提供文件树浏览、文件操作、搜索功能。

## 主要组件

### 前端组件

- `src/modules/explorer/` - 文件浏览器模块根目录
- `ExplorerPane.vue` - 文件浏览器面板组件
- `FileTree.vue` - 文件树组件
- `FileTreeNode.vue` - 文件树节点组件
- `useExplorer.ts` - 文件浏览器组合式函数
- `explorerTypes.ts` - 类型定义

### 后端模块

- `src-tauri/src/modules/fs/` - 文件系统操作
- `src-tauri/src/modules/workspace.rs` - 工作区管理

## 依赖关系

### 前端依赖

- `@/lib/native` - Tauri IPC 封装
- `naive-ui` - UI 组件

### 后端依赖

- `fs` 模块 - 文件操作
- `workspace` 模块 - 工作区管理
- `ignore` 模块 - .gitignore 支持

## 接口定义

### Tauri 命令

| 命令 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `fs_read_dir` | `path: String` | `DirEntry[]` | 读取目录内容 |
| `fs_stat` | `path: String` | `FileStat` | 获取文件信息 |
| `fs_create_file` | `path: String` | `void` | 创建文件 |
| `fs_create_dir` | `path: String` | `void` | 创建目录 |
| `fs_rename` | `from: String, to: String` | `void` | 重命名 |
| `fs_delete` | `path: String` | `void` | 删除 |
| `fs_search` | `pattern: String, root: String` | `SearchResult[]` | 搜索文件 |

### 前端接口

```typescript
interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
  isExpanded?: boolean
  isLoading?: boolean
}

interface ExplorerState {
  root: string
  tree: FileTreeNode[]
  selected: string | null
  expanded: Set<string>
  searchResults: SearchResult[]
}
```

## 配置选项

### 文件浏览器配置

```typescript
interface ExplorerSettings {
  showHidden: boolean
  sortBy: 'name' | 'type' | 'modified'
  sortOrder: 'asc' | 'desc'
  fileFilters: string[]
  excludePatterns: string[]
}
```

## 相关文档

- [详细设计](./detailed-design.md)