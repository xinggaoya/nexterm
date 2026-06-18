# 主题模块

## 概述

主题模块负责生成和应用 Naive UI 主题覆盖。

## 主要组件

### 前端组件

- `src/modules/theme/` - 模块根目录
- `naiveTheme.ts` - 主题生成器

## 依赖关系

- `@/styles/tokens` - 应用 token 系统
- `naive-ui` - 主题 API

## 接口定义

### 类型

```typescript
type ResolvedTheme = "dark" | "light"

function getNaiveTheme(theme: ResolvedTheme): GlobalTheme | null
function buildNaiveThemeOverrides(tokens: AppTokens): GlobalThemeOverrides
```

## 配置选项

- 圆角：6px（小）/ 8px（中/大）
- 字体：Inter Variable（UI）/ JetBrains Mono（代码）
- 通知宽度：300px
- 标签页高度：36px

## 相关文档

- [详细设计](./detailed-design.md)