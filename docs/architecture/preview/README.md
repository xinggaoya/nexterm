# 预览模块

## 概述

预览模块提供网页预览功能，内嵌 webview 显示网页内容。

## 主要组件

### 前端组件

- `src/modules/preview/` - 模块根目录
- `PreviewPane.vue` - 预览面板
- `PreviewStack.vue` - 预览栈容器
- `PreviewAddressBar.vue` - 地址栏
- `previewUrl.ts` - URL 工具
- `previewTypes.ts` - 类型定义

## 依赖关系

- Vue - 组件系统

## 接口定义

### 类型

```typescript
type PreviewPaneHandle = {
  reload: () => void
  focusAddressBar: () => void
  getUrl: () => string
}
```

## 配置选项

- URL 协议验证（安全限制）

## 相关文档

- [详细设计](./detailed-design.md)