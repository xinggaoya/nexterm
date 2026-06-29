# <模块名>

> 标准 README 模板。新模块按此格式补齐；旧模块按此格式核对。

## 1. 概述

<1~2 句话说明模块做什么、为什么存在。>

## 2. 目录与文件

```
src/modules/<module>/
  <Component>.vue
  <name>Pinia.ts
  lib/
    *.ts
  index.ts
```

## 3. 依赖

### 3.1 内部依赖

- `<其它模块>` -- <原因>

### 3.2 外部依赖

- `<npm 包>` -- <用途>

## 4. 数据契约

### 4.1 公共类型

```ts
// <关键类型>
```

### 4.2 Tauri 命令

| 命令 | 参数 | 返回 | 说明 |
|------|------|------|------|

### 4.3 事件

| 事件 | payload | 说明 |
|------|---------|------|

## 5. Pinia 状态

> 若无 Pinia store，写"无"。若有，列字段 / getter / action。

## 6. 关键算法 / 数据流

> 用 3~6 行 + 一段 mermaid 说明核心数据流；不要长篇累牍。

## 7. 配置项

> 关键常量、阈值、配置开关；引用 `preferencesPinia` 的字段要列字段名。

## 8. 测试

- `*.test.ts` -- 单元 / 集成
- `*.vue.test.ts` -- 组件
- `*Boundary.test.ts` -- 边界（如有）

## 9. 相关文档

- [详细设计](./detailed-design.md)
- [跨模块相关] -- <01-overview / 02-module-contracts / 04-security-model 章节>
