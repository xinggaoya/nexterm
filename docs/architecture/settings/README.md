# 设置 settings

## 1. 概述

设置模块是**唯一的偏好持久化层**。`store.ts` 走 Rust `LazyStore`（`@tauri-apps/plugin-store`）做底层存储，`preferencesPinia.ts` 把 21 个字段以 setup-function 模式暴露成响应式状态。设置面板本身在 `src/settings/`（作为抽屉挂在主窗口内）。

## 2. 目录与文件

```
src/modules/settings/
  store.ts                  # 底层 Tauri store 持久化
  preferencesPinia.ts       # 响应式 Pinia store（21 字段）
  preferences.ts            # 类型定义
  preferencesSnapshot.ts    # 偏好快照（用于 reset / export）
  tabs.ts                   # 设置面板 tab 列表
  index.ts

src/settings/
  SettingsPanel.vue         # 抽屉主组件
  sections/
    GeneralSection.vue
    AppearanceSection.vue
    EditorSection.vue
    TerminalSection.vue
    KeybindingsSection.vue
    AboutSection.vue
```

## 3. 依赖

### 3.1 内部

- `@tauri-apps/plugin-store` -- 底层 LazyStore
- `@tauri-apps/api/event` -- 跨窗口同步
- `@/modules/commands/types` -- KeybindingOverrides
- `@/modules/i18n/types` -- LanguagePref
- `@/modules/workspace` -- StoredWorkspace / WorkspaceEnv

## 4. 数据契约

### 4.1 偏好类型

```ts
type Preferences = {
  theme: ThemePref;
  language: LanguagePref;
  editorTheme: EditorThemeId;
  autostart: boolean;
  restoreWindowState: boolean;
  vimMode: boolean;
  fileOpenMode: FileOpenMode;
  showHidden: boolean;
  terminalWebglEnabled: boolean;
  terminalContextMenuEnabled: boolean;
  terminalFontFamily: string;
  terminalLetterSpacing: number;
  terminalFontSize: number;
  terminalScrollback: number;
  keybindings: KeybindingOverrides;
  lastWslDistro: string | null;
  lastWorkspace: StoredWorkspace | null;
  recentWorkspaces: StoredWorkspace[];
  zoomLevel: number;
  sourceControlPanelWidth: number;
  explorerPanelWidth: number;
  touchOptimizations: TouchMode;
  editorFontSize: number;
  editorTabSize: number;
  editorWordWrap: boolean;
};
```

### 4.2 Tauri 命令

不直接 invoke；通过 `tauri-plugin-store` API 间接访问。

### 4.3 事件

- 监听 `settings://changed`（store 自身 emit）实现跨窗口同步。

## 5. Pinia 状态

`usePreferencesPiniaStore` 是 setup-function 模式，21 个字段独立 `ref`。`hydrate()` 异步水合（必须在 app mount 前 await）。

## 6. 关键算法

- `store.ts` 维护一组 setter：调用时写入 Tauri store + emit 同步事件。
- `preferencesPinia` 通过 `watch` 监听字段变化，调用 store 同步。
- 写入防抖 200ms。
- `preferencesSnapshot` 用于 reset / 调试。

## 7. 配置项

- 存储文件：`nexterm-settings.json`（Tauri `LazyStore`）
- 防抖：200ms
- 终端字号：8-32（默认 14）
- 编辑器字号：10-24（默认 13）
- 回滚：200-50000（默认 2000）
- 最近工作区：上限 10

## 8. 测试

- `preferencesSnapshot.test.ts` -- 快照 / reset
- `src/settings/SettingsPanel.test.ts` / `src/settings/sections/*Section.test.ts` -- 抽屉 / 分区

## 9. 相关文档

- [详细设计](./detailed-design.md)
- [01-overview.md](./../01-overview.md) -- 启动流程（hydrate 时机）
