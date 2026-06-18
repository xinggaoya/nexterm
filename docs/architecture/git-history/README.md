# Git 历史模块

## 概述

Git 历史模块提供提交历史浏览、分支图形可视化和提交详情查看功能。

## 主要组件

### 前端组件

- `src/modules/git-history/` - 模块根目录
- `GitHistoryPane.vue` - 主历史面板
- `GitHistoryStack.vue` - 历史栈容器
- `GraphRail.vue` - SVG 图形轨道
- `lib/graph.ts` - 图形布局算法
- `lib/remoteWebUrl.ts` - 远程 URL 解析

## 依赖关系

- `@/lib/native` - Git 命令调用
- `@/lib/clipboard` - 复制 SHA
- `@/modules/explorer/lib/iconResolver` - 文件图标
- `@/modules/i18n/translate` - 国际化

## 接口定义

### 数据类型

```typescript
type CommitFileDiffOpenInput = {
  repoRoot: string
  sha: string
  shortSha: string
  subject: string
  path: string
  originalPath: string | null
}

type GraphRow = {
  sha: string
  lane: number
  nodeColor: LaneColor
  laneCount: number
  topEdges: GraphEdge[]
  bottomEdges: GraphEdge[]
}

type RemoteWebInfo = {
  host: RemoteWebHost
  hostname: string
  owner: string
  repo: string
  baseUrl: string
}
```

## 配置选项

- `PAGE_SIZE = 30` - 每页提交数量
- `ROW_HEIGHT = 32` - 图形行高
- 支持分页加载和提交搜索过滤

## 相关文档

- [详细设计](./detailed-design.md)