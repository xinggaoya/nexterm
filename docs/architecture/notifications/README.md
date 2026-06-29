# 通知 notifications

## 1. 概述

通知模块是 Naive UI 通知 API 的薄封装。它通过 `NotificationBridge.vue` 注入 `NotificationApi`，业务模块用 `notifySuccess` / `notifyInfo` / `notifyError` 调用。

## 2. 目录与文件

```
src/modules/notifications/
  NotificationBridge.vue      # 注入 NotificationApi
  notificationCenter.ts       # 通知函数
  index.ts
```

## 3. 依赖

### 3.1 内部

- `naive-ui` -- `NotificationApi`
- `@/lib/normalizeError` -- 错误规整

## 4. 数据契约

### 4.1 公共 API

```ts
function bindNotificationApi(api: Pick<NotificationApi, "create"> | null): void;
function notifySuccess(title: string, content?: string | null): void;
function notifyInfo(title: string, content?: string | null): void;
function notifyError(title: string, error: unknown): void;
```

### 4.2 Tauri 命令

不直接 invoke；`tauri-plugin-notification` 已被注册，但前端通知走 Naive UI。

## 5. Pinia 状态

无独立 store。

## 6. 关键算法

- `notifyError` 用 `normalizeError` 规整 `unknown`，确保消息可读。
- 通知持续时间：成功 / 信息 4500ms，错误 6500ms。
- 鼠标悬停时保持显示。

## 7. 配置项

无运行时配置。

## 8. 测试

- `notificationCenter.test.ts`

## 9. 相关文档

- [详细设计](./detailed-design.md)
