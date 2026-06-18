# 通知模块

## 概述

通知模块提供全局通知功能，基于 Naive UI 通知 API。

## 主要组件

### 前端组件

- `src/modules/notifications/` - 模块根目录
- `NotificationBridge.vue` - 通知桥接组件
- `notificationCenter.ts` - 通知中心

## 依赖关系

- `naive-ui` - NotificationApi

## 接口定义

### API

```typescript
function bindNotificationApi(api: Pick<NotificationApi, "create"> | null): void
function notifySuccess(title: string, content?: string | null): void
function notifyInfo(title: string, content?: string | null): void
function notifyError(title: string, error: unknown): void
```

## 配置选项

- 成功/信息通知持续时间：4500ms
- 错误通知持续时间：6500ms
- 鼠标悬停时保持显示

## 相关文档

- [详细设计](./detailed-design.md)