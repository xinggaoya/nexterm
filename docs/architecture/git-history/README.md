# Git 历史 git-history

## 1. 概述

Git 历史模块提供提交历史浏览、提交详情、提交内 diff 视图、远程 web 跳转。提交列表分页加载，图形布局由 `lib/graph.ts` 计算。

## 2. 目录与文件

```
src/modules/git-history/
  GitHistoryPane.vue
  GitHistoryStack.vue
  GraphRail.vue                    # SVG 图形轨道
  lib/
    graph.ts                       # 图形布局算法
    remoteWebUrl.ts                # 远程 URL 解析（GitHub/GitLab/Bitbucket）
  index.ts
```

## 3. 依赖

### 3.1 内部

- `@/lib/native` -- `gitLog` / `gitShowCommit` / `gitCommitFiles` / `gitCommitFileDiff` / `gitRemoteUrl`
- `@/lib/clipboard` -- 复制 SHA
- `@/modules/explorer/lib/iconResolver` -- 文件图标
- `@/modules/i18n/translate` -- 国际化
- `@/modules/notifications/notificationCenter`
- `@/modules/tabs` -- GitHistoryTab / GitCommitFileDiffTab

## 4. 数据契约

### 4.1 公共类型

```ts
type CommitFileDiffOpenInput = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

type GraphRow = {
  sha: string;
  lane: number;
  nodeColor: LaneColor;
  laneCount: number;
  topEdges: GraphEdge[];
  bottomEdges: GraphEdge[];
};

type RemoteWebInfo = {
  host: RemoteWebHost;
  hostname: string;
  owner: string;
  repo: string;
  baseUrl: string;
};

type RemoteWebHost = "github" | "gitlab" | "bitbucket" | "unknown";
```

### 4.2 Tauri 命令

| 命令 | 说明 |
|------|------|
| `git_log` | 分页提交历史 |
| `git_show_commit` | 单个提交 |
| `git_commit_files` | 提交内变更文件 |
| `git_commit_file_diff` | 单个文件 diff |
| `git_remote_url` | 远程 URL |

### 4.3 事件

无。

## 5. Pinia 状态

无独立 store。

## 6. 关键算法

- `graph.ts` 为每个提交分配 lane + 颜色 + 上下边。
- `remoteWebUrl.ts` 解析 `git@github.com:owner/repo.git` / `https://...` 等格式到 `RemoteWebInfo`。
- 提交列表分页：每页 30（`PAGE_SIZE`）。

## 7. 配置项

- `PAGE_SIZE = 30`
- `ROW_HEIGHT = 32`
- 支持提交搜索过滤

## 8. 测试

- `GitHistoryPane.vue.test.ts` / `GitHistoryStack.vue.test.ts`
- `gitHistoryVueBoundary.test.ts`

## 9. 相关文档

- [详细设计](./detailed-design.md)
