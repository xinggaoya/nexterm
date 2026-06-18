# 设置模块

## 概述

设置模块负责管理用户偏好设置的持久化和同步。

## 主要组件

### 前端组件

- `src/modules/settings/` - 模块根目录
- `store.ts` - 底层持久化层
- `preferencesPinia.ts` - 响应式 Pinia store
- `preferences.ts` - 偏好设置类型
- `preferencesSnapshot.ts` - 偏好快照
- `tabs.ts` - 设置面板标签页

## 依赖关系

- `@tauri-apps/plugin-store` - LazyStore 持久化
- `@tauri-apps/api/event` - 跨窗口同步
- `@/modules/commands/types` - 快捷键类型
- `@/modules/i18n/types` - 语言类型

## 接口定义

### 偏好设置类型

```typescript
type Preferences = {
  theme: ThemePref
  language: LanguagePref
  editorTheme: EditorThemeId
  autostart: boolean
  restoreWindowState: boolean
  vimMode: boolean
  fileOpenMode: FileOpenMode
  showHidden: boolean
  terminalWebglEnabled: boolean
  terminalContextMenuEnabled: boolean
  terminalFontFamily: string
  terminalLetterSpacing: number
  terminalFontSize: number
  terminalScrollback: number
  keybindings: KeybindingOverrides
  lastWslDistro: string | null
  lastWorkspace: StoredWorkspace | null
  recentWorkspaces: StoredWorkspace[]
  zoomLevel: number
  sourceControlPanelWidth: number
  explorerPanelWidth: number
  touchOptimizations: TouchMode
  editorFontSize: number
  editorTabSize: number
  editorWordWrap: boolean
}

type ThemePref = "system" | "light" | "dark"
type FileOpenMode = "preview" | "pinned"
type TouchMode = "auto" | "on" | "off"
```

## 配置选项

- 存储文件：`nexterm-settings.json`
- 自动保存延迟：200ms
- 终端字体大小：8-32（默认 14）
- 编辑器字体大小：10-24（默认 13）
- 终端回滚行数：200-50000（默认 2000）

## 相关文档

- [详细设计](./detailed-design.md)