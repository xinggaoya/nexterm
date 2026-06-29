# 国际化 i18n

## 1. 概述

i18n 模块基于 vue-i18n 9，提供 `zh-CN` / `en-US` 两种语言。`system` 偏好会根据 `navigator.languages` 自动解析。用户切换时同步更新 Naive UI 的 locale。

## 2. 目录与文件

```
src/modules/i18n/
  index.ts              # i18n 实例 + applyLanguagePreference
  translate.ts          # t() 包装
  types.ts              # LanguagePref / AppLocale
  naive.ts              # Naive UI locale 适配
  locales/
    zh-CN.ts
    en-US.ts
```

## 3. 依赖

### 3.1 内部

- `vue-i18n` -- i18n 框架
- `naive-ui` -- locale 适配
- `@/modules/settings/preferencesPinia` -- `language`

## 4. 数据契约

### 4.1 公共类型

```ts
type LanguagePref = "system" | "zh-CN" | "en-US";
type AppLocale = "zh-CN" | "en-US";

interface LanguageConfig {
  label: string;
  value: AppLocale;
  systemMatch: string[];   // 匹配 navigator.languages 的前缀
}
```

### 4.2 Tauri 命令

不直接 invoke。

### 4.3 事件

无；通过 `preferencesPinia.language` 触发。

## 5. Pinia 状态

无独立 store。

## 6. 关键算法

- `applyLanguagePreference(pref)` 解析 `system` -> `AppLocale`，再调 `i18n.global.locale.value`。
- `resolveAppLocale(pref, systemLanguages)` 支持 `zh` / `zh-*` 前缀匹配。

## 7. 配置项

- 默认 `LanguagePref` = "system"
- 默认 fallback locale：`en-US`

## 8. 测试

- `locale.test.ts` -- 语言解析
- `src/lib/translationTraces.test.ts` -- 边界（无 React 命名）

## 9. 相关文档

- [详细设计](./detailed-design.md)
