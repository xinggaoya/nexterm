# Pinia 状态管理 pinia

## 1. 概述

`pinia` 目录**不是** store 库本体（那是 `pinia` npm 包），而是放 Pinia 边界测试的目录。仓库所有 store 都强制使用 setup-function 模式，本目录的 `setupStoreBoundary.test.ts` 守门。

## 2. 目录与文件

```
src/modules/pinia/
  setupStoreBoundary.test.ts
```

## 3. 依赖

### 3.1 内部

- vitest -- 静态扫描

## 4. 数据契约

无业务数据契约。约束：

1. 所有 store 必须使用 setup-function 形式。
2. 禁止 Options API 形式（`defineStore("x", { state: () => ({}), actions: {} })`）。
3. 禁止在 store 文件中使用 `this.*`。

### 4.1 容忍列表

`workspaceEnvPinia.ts` / `workspaceRootPinia.ts` 是历史遗留，新 store 不允许再起这种 `Pinia` 后缀的非常规名。

## 5. Pinia 状态

无（这是测试目录）。

## 6. 关键算法

- `setupStoreBoundary.test.ts` 用 `vi.hoisted` 扫描 `src/modules/**/*Pinia.ts` 文件源码：
  - 命中 `defineStore(` + 第二个参数是对象字面量 + 含 `state:` / `actions:` 键 -> 失败
  - 命中 `this.` 引用 -> 失败
  - 命中容忍列表 -> 通过

## 7. 配置项

无。

## 8. 测试

- `setupStoreBoundary.test.ts`

## 9. 相关文档

- [详细设计](./detailed-design.md)
- [02-module-contracts.md](./../02-module-contracts.md) -- Pinia 写法约束
