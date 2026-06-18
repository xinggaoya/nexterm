# Pinia 状态管理模块

## 概述

Pinia 模块包含状态管理的边界测试和规范。

## 主要组件

### 测试文件

- `src/modules/pinia/` - 模块根目录
- `setupStoreBoundary.test.ts` - Store 规范测试

## 依赖关系

- Vitest - 测试框架

## 规范

### Store 规则

1. 所有 store 必须使用 setup-function 形式
2. 禁止使用 Options API 形式
3. 禁止在 store 文件中使用 `this.*`

### 允许的例外

- `workspaceEnvPinia.ts` - 待迁移
- `workspaceRootPinia.ts` - 待迁移

## 相关文档

- [详细设计](./detailed-design.md)