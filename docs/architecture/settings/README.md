# 设置 settings

## 1. 概述

设置模块是**唯一的偏好持久化层**，以 `store.ts` 的 `PREF_SPECS` 表为单一事实来源：每个偏好的存储键、读取规范化（read）与写入钳制（sanitize）都只在这一张表里声明。`preferencesPinia.ts` 把全部偏好暴露为响应式状态，更新统一走 `updatePref(key, value)`（sanitize → 乐观更新 ref → 快照 patch → 写盘）。设置面板本身在 `src/settings/`（作为抽屉挂在主窗口内）。

## 2. 目录与文件

```
src/modules/settings/
  store.ts                  # PREF_SPECS 表 + loadPreferences/setPreference/onPreferencesChange
  store.test.ts             # spec 表完整性与 clamp 行为测试
  preferencesPinia.ts       # 响应式 Pinia store（spec 驱动 + 具名 updateXxx 包装）
  preferencesSnapshot.ts    # 模块级偏好快照（跨窗口回灌 / 调试）
  tabs.ts                   # 设置面板 tab 列表
  index.ts

src/settings/
  SettingsPanel.vue         # 抽屉主组件
  sections/
    GeneralSection.vue
    AppearanceSection.vue
    EditorSection.vue       # 含 LSP 诊断实验性开关
    TerminalSection.vue     # 复合页，下挂三个子分区
    TerminalAppearanceSection.vue
    TerminalBehaviorSection.vue
    TerminalRendererSection.vue
    KeybindingsSection.vue
    AboutSection.vue
```

## 3. 依赖

### 3.1 内部

- `@tauri-apps/plugin-store` -- 底层 LazyStore
- `@tauri-apps/api/event` -- 跨窗口同步（`nexterm://prefs-changed`）
- `@/modules/commands/types` -- KeybindingOverrides
- `@/modules/i18n/types` -- LanguagePref
- `@/modules/workspace` -- StoredWorkspace / WorkspaceEnv

## 4. 数据契约

偏好类型的唯一事实来源是 `store.ts` 的 `Preferences` 类型与 `DEFAULT_PREFERENCES`（新增偏好 = 类型加字段 + 默认值 + `PREF_SPECS` 加一行）。`PREF_SPECS` 表受 `store.test.ts` 的"表覆盖 DEFAULT_PREFERENCES 每一个键"不变量测试保护。

spec 形状：

```ts
type PrefSpecMap = {
  [K in PrefKey]: {
    storageKey: string;              // 存储键（默认与字段同名，如 layout.leftSidebar）
    read: (raw: unknown) => Preferences[K];      // 磁盘值规范化 + 默认回落
    sanitize?: (v: Preferences[K]) => Preferences[K]; // 写盘/乐观更新前钳制
    legacyKey?: string;              // 旧键迁移（如 showHiddenDirectories）
  };
};
```

带 sanitize 的代表性字段：`terminalScrollback`（200–50000）、`sourceControlPanelWidth` /
`explorerPanelWidth`（240–520）、`editorFontSize`（10–24）、`tabFixedWidth`（步长 4，
80–240）、`terminalFontWeight`（100 的倍数）、`accent`/`leftSidebar`/`panelVisibility`
等枚举与结构体规范化。

### 4.2 Tauri 命令

不直接 invoke；通过 `tauri-plugin-store` API 间接访问。

### 4.3 事件

- `PREFS_CHANGED_EVENT`（`nexterm://prefs-changed`）：`writePref` 在每次写盘后 emit，
  `onPreferencesChange` 同时监听它与 `store.onChange`，把变更回灌到跨窗口的其它实例。

## 5. Pinia 状态

`usePreferencesPiniaStore` 是 setup-function 模式：全部偏好 ref 由 `DEFAULT_PREFERENCES`
键集生成，`hydrate()` 异步水合（app mount 前调用）后订阅 `onPreferencesChange` 回灌。
更新入口是 `updatePref(key, value)`；对外保留 `updateTheme` / `updateVimMode` 等
具名包装（一行委托），组件调用点无需感知表驱动实现。

## 6. 关键算法

- **单一更新路径**：`updatePref` = sanitize → 乐观写 ref → `patchPreferencesSnapshot`
  → `setPreference`（写盘时再次 sanitize，幂等）。
- **读规范化**：`loadPreferences` 逐键走 `spec.read`，损坏值回落默认而非透传。
- **回灌**：`onPreferencesChange` 的值视作已 sanitize，直接写 ref 与快照。
- **快照**：`preferencesSnapshot` 为模块级单例，供跨窗口同步对照与调试。

## 7. 配置项

- 存储文件：`nexterm-settings.json`（Tauri `LazyStore`，`autoSave: 200`）
- 终端字号：8-32（默认 14）；编辑器字号：10-24（默认 13）；回滚：200-50000（默认 2000）
- 最近文件：上限 50；最近工作区：上限 10
- `Rust 侧`：`restoreWindowState` 偏好在插件注册前由 `src-tauri/src/lib.rs` 直接读同一份
  JSON（`should_restore_window_state`），决定是否挂 window-state 插件

## 8. 测试

- `store.test.ts` -- spec 表覆盖不变量、默认回落、sanitize 幂等、数值 clamp
- `preferencesSnapshot.test.ts` -- 快照 / reset
- `src/settings/sections/*.test.ts` -- 9 个分区组件渲染与交互（含持久化路径断言）
- `src/settings/SettingsPanel.test.ts` -- 抽屉分区导航

## 9. 相关文档

- [详细设计](./detailed-design.md)
- [01-overview.md](./../01-overview.md) -- 启动流程（hydrate 时机）
