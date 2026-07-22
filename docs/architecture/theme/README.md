# 主题 theme

## 1. 概述

主题模块从 `AppTokens`（`src/styles/tokens.ts`）派生 Naive UI 的 `themeOverrides`。它是**唯一**改 Naive UI 主题的地方；其他模块禁止写"颜色硬编码 + 主题覆盖"双轨。全局 CSS 同时提供 `nexterm-surface`、`nexterm-toolbar`、`nexterm-row`、`nexterm-icon-button` 与 `nexterm-overlay`，业务组件只表达表面角色。

## 2. 目录与文件

```
src/modules/theme/
  naiveTheme.ts        # getNaiveTheme / buildNaiveThemeOverrides
  index.ts
```

## 3. 依赖

### 3.1 内部

- `@/styles/tokens` -- `AppTokens` 来源
- `@/modules/settings/preferencesPinia` -- `theme` ("system" / "light" / "dark")
- `naive-ui` -- `GlobalTheme` / `GlobalThemeOverrides`

## 4. 数据契约

### 4.1 公共类型

```ts
type ResolvedTheme = "dark" | "light";

function getNaiveTheme(theme: ResolvedTheme): GlobalTheme | null;
function buildNaiveThemeOverrides(tokens: AppTokens): GlobalThemeOverrides;
```

### 4.2 Tauri 命令

不直接 invoke。

### 4.3 事件

通过 `preferencesPinia.theme` 变化触发重新生成；不引入单独事件。

## 5. Pinia 状态

无独立 store。

## 6. 关键算法

- 监听 `matchMedia("(prefers-color-scheme: dark)")` 解析 `system` -> 实际主题。
- `AppTokens` 的颜色已经是 RGB 解析后的（`tokens.ts`），不需要在这里再做色空间转换。
- `themeOverrides` 仅覆盖"必须改的"项，其他继承 Naive UI 默认。

## 7. 配置项

- 配色：深色优先的石墨外壳 + 电光青主色；浅色使用冷白外壳与深青主色
- 状态：`success` / `warning` / `info` / `destructive` 统一由语义 token 提供
- 圆角：3 / 4 / 6 / 8 px，常驻面板不使用阴影
- 字体：Inter Variable（UI）/ JetBrains Mono（代码）
- 通知宽度：300 px
- 标签页高度：34 px
- 主题切换平滑过渡：120 ms

## 8. 测试

- `naiveTheme.test.ts` -- 派生 / 覆盖

## 9. 相关文档

- [详细设计](./detailed-design.md)
- [01-overview.md](./../01-overview.md) -- 主题 token 体系
