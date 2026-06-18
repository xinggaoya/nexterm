# 编辑器模块

## 概述

编辑器模块提供基于 CodeMirror 6 的代码编辑功能，支持语法高亮、自动补全、diff 视图等。

## 主要组件

### 前端组件

- `src/modules/editor/` - 编辑器模块根目录
- `EditorPane.vue` - 编辑器面板组件
- `EditorView.vue` - CodeMirror 视图组件
- `useEditor.ts` - 编辑器组合式函数
- `editorTypes.ts` - 类型定义
- `editorThemes.ts` - 主题配置
- `editorLanguages.ts` - 语言支持

### 后端模块

- `src-tauri/src/modules/fs/` - 文件系统操作
- `src-tauri/src/modules/git/` - Git 操作

## 依赖关系

### 前端依赖

- `@codemirror/*` - CodeMirror 核心和扩展
- `@uiw/codemirror-themes-*` - 主题包
- `@/lib/native` - Tauri IPC 封装

### 后端依赖

- `fs` 模块 - 文件读写
- `git` 模块 - Git 操作

## 接口定义

### Tauri 命令

| 命令 | 参数 | 返回值 | 描述 |
|------|------|--------|------|
| `fs_read_file` | `path: String` | `FileContent` | 读取文件内容 |
| `fs_write_file` | `path: String, content: String` | `void` | 写入文件内容 |
| `git_diff_content` | `path: String` | `DiffContent` | 获取文件 diff |

### 前端接口

```typescript
interface EditorInstance {
  id: number
  view: EditorView
  state: EditorState
  config: EditorConfig
}

interface EditorConfig {
  language: string
  theme: string
  fontSize: number
  tabSize: number
  lineNumbers: boolean
  wordWrap: boolean
  vimMode: boolean
}
```

## 配置选项

### 编辑器配置

```typescript
interface EditorSettings {
  fontSize: number
  fontFamily: string
  tabSize: number
  insertSpaces: boolean
  lineNumbers: boolean
  wordWrap: 'off' | 'on' | 'wordWrapColumn'
  minimap: boolean
  autoSave: boolean
  formatOnSave: boolean
}
```

## 相关文档

- [详细设计](./detailed-design.md)