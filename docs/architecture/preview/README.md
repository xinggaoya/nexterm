# 预览 preview

## 1. 概述

预览模块在内嵌 webview（`<iframe>`）中显示任意 URL，提供地址栏、刷新按钮。URL 在前端做白名单协议校验，避免 javascript: / data: / file: 等危险协议。

## 2. 目录与文件

```
src/modules/preview/
  PreviewPane.vue          # 主面板
  PreviewStack.vue         # 栈容器
  PreviewAddressBar.vue    # 地址栏
  previewUrl.ts            # URL 工具 / 协议校验
  previewTypes.ts
  index.ts
```

## 3. 依赖

### 3.1 内部

- `@/lib/platform` -- 平台快捷键
- `@/modules/tabs` -- PreviewTab 状态

## 4. 数据契约

### 4.1 公共类型

```ts
type PreviewPaneHandle = {
  reload: () => void;
  focusAddressBar: () => void;
  getUrl: () => string;
};
```

### 4.2 Tauri 命令

不直接 invoke。

### 4.3 事件

无。

## 5. Pinia 状态

无独立 store。

## 6. 关键算法

- `previewUrl.normalize(url)`：补全 `https://`、解析 host、返回规范化结果。
- `previewUrl.isSafeProtocol(url)`：白名单 `https` / `http`。
- `PreviewAddressBar` 提交时先校验协议再写入。

## 7. 配置项

- 默认 `sandbox` / `referrerPolicy="no-referrer"`（iframe 属性）。

## 8. 测试

- `previewUrl.test.ts` / `PreviewPane.test.ts` / `PreviewPane.vue.test.ts`
- `previewVueBoundary.test.ts`

## 9. 相关文档

- [详细设计](./detailed-design.md)
