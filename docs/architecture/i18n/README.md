# 国际化模块

## 概述

国际化模块提供多语言支持，基于 vue-i18n。

## 主要组件

### 前端组件

- `src/modules/i18n/` - 模块根目录
- `index.ts` - i18n 实例
- `translate.ts` - 翻译函数
- `types.ts` - 类型定义
- `naive.ts` - Naive UI 适配
- `locales/en-US.ts` - 英文翻译
- `locales/zh-CN.ts` - 中文翻译

## 依赖关系

- `vue-i18n` - 国际化框架
- Vue - 组件系统

## 接口定义

### 类型

```typescript
type LanguagePref = "system" | "zh-CN" | "en-US"
type AppLocale = "zh-CN" | "en-US"

function t(key: string, params?: Record<string, unknown>): string
function currentLocale(): string
function applyLanguagePreference(preference: LanguagePref): Promise<AppLocale>
function resolveAppLocale(preference: LanguagePref, systemLanguages: string[]): AppLocale
```

## 配置选项

- 支持的语言：简体中文、英文
- 系统语言检测：通过 `navigator.languages`
- 中文检测：`zh` 或 `zh-*` 前缀

## 相关文档

- [详细设计](./detailed-design.md)