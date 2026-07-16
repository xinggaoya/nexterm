# Git 历史 git-history

## 1. 概述

Git 历史模块提供提交历史浏览、提交详情、提交内 diff 视图、远程 web 跳转。

核心能力：

- **显式 ref / 全分支范围**: 每个 `GitHistoryTab` 同时携带 `repoRoot` + `refName | null` + `allRefs: boolean` 三个字段，决定 `git_log` 的查询范围：
  - `refName` 非空 → 仅该 ref（branch / tag / rev）；
  - `refName === null && allRefs === false` → HEAD（即工作区当前分支）；
  - `allRefs === true` → 跨所有 local + remote ref 的整库历史（语义上 `refName` 强制为 null）。
- **分页**：`PAGE_SIZE = 30`；后端用 `--max-count=limit+1` 探测下一页是否存在（`hasMore`），前端按 `offset += PAGE_SIZE` 推进。
- **ref 标签**：每条 entry 附带 `refs: GitLogRef[]`，类型枚举为 `head | local-branch | remote-branch | tag`，UI 用不同颜色徽章渲染。
- **标签页身份**：去重 / 切换以 `(repoRoot, refName, allRefs)` 为 key，避免 HEAD 与同名分支各自重复打开。
- 提交列表支持 subject / author / email / shortSha 过滤。
- 图形轨道由 `lib/graph.ts` 计算（lane + 颜色 + 上下边）。
- 远程 web 链接：`lib/remoteWebUrl.ts` 解析 `git@github.com:owner/repo.git` / `https://...` 等格式到 `RemoteWebInfo`。

## 2. 目录与文件

```
src/modules/git-history/
  GitHistoryPane.vue             # 单 repo + ref 的历史面板
  GitHistoryStack.vue            # 多 tab 适配：拆 active tab，向 Pane 传 refName/allRefs
  GraphRail.vue                  # SVG 图形轨道
  lib/
    graph.ts                     # 图形布局算法
    remoteWebUrl.ts              # 远程 URL 解析（GitHub/GitLab/Bitbucket）
  index.ts
```

## 3. 依赖

### 3.1 内部

- `@/lib/native` -- `git_log` / `git_commit_files` / `git_commit_file_diff` / `git_remote_url` / `git_branch_list`
- `@/lib/clipboard` -- 复制 SHA
- `@/modules/explorer/lib/iconResolver` -- 文件图标
- `@/modules/i18n/translate` -- 国际化
- `@/modules/notifications/notificationCenter`
- `@/modules/tabs` -- `GitHistoryTab` / `GitCommitFileDiffTab` 状态（含 `openCommitHistoryTab` / `updateGitHistoryTabRef`）

## 4. 数据契约

### 4.1 公共类型

```ts
// ref 范围与 ref 名 + allRefs 的组合，三者共同决定 git_log 的查询范围。
type GitHistoryTab = {
  id: number;
  kind: "git-history";
  title: string;            // "History · <refName>" 或 "All branches"
  repoRoot: string;
  refName: string | null;   // null 表示 HEAD 或 "all branches"
  allRefs: boolean;
};

type GitLogOptions = {
  limit: number | null;     // 每页条数；后端 clamp 到 [1, MAX_LOG_LIMIT]
  offset: number | null;    // 跳过的条数
  refName: string | null;   // 指定 ref；后端会校验非空、不以 `-` 开头、无控制字符
  all: boolean;             // true 时覆盖 refName，传 --all
};

type GitLogEntry = {
  sha: string;
  shortSha: string;
  author: string;
  authorEmail: string;
  timestampSecs: number;
  parents: string[];
  subject: string;
  filesChanged: number;
  insertions: number;
  deletions: number;
  refs: GitLogRef[];        // 经 parse_log_refs 解析的标签
};

type GitLogRef = {
  name: string;             // 短名，例如 "main" / "origin/main" / "v1.0"
  kind: "head" | "local-branch" | "remote-branch" | "tag";
  isHead: boolean;
};

type GitLogPage = {
  entries: GitLogEntry[];
  hasMore: boolean;         // 由后端用 limit+1 探测得到
};

type GitCommitFileDiffOpenInput = {
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
| `git_log` | 分页提交历史，返回 `GitLogPage { entries, hasMore }`；接收 `GitLogOptions { limit, offset, refName, all }` |
| `git_commit_files` | 提交内变更文件列表（含 `GitCommitFileChange { path, originalPath, status, statusLabel, added, removed, isBinary }`） |
| `git_commit_file_diff` | 提交内单文件 diff 内容（`GitDiffContentResult`） |
| `git_remote_url` | 当前 remote URL（默认 `origin`） |
| `git_branch_list` | 分支下拉框数据源 |

注意：`git_show_commit` 命令虽然在后端注册，但前端 `native.ts` 没有对应的 `gitShowCommit` wrapper，前端不调用它（提交详情通过 `git_commit_files` + `git_commit_file_diff` 组合实现）。

### 4.3 事件

无。

## 5. Pinia 状态

无独立 store。

`GitHistoryStack` 监听 `tabs` / `activeId`，把当前激活的 `GitHistoryTab` 传给 `GitHistoryPane`，并把 ref 切换事件回写到 `tabsPinia.updateGitHistoryTabRef`。

`tabsPinia.openCommitHistoryTab` 的去重 key = `(repoRoot, refName, allRefs)`；`allRefs=true` 时强制 `refName=null`，确保 dedup 不被偶然传入的 `branch` 字段干扰。

## 6. 关键算法

- `lib/graph.ts` 为每个提交分配 lane + 颜色 + 上下边。
- `lib/remoteWebUrl.ts` 解析 `git@github.com:owner/repo.git` / `https://...` 等格式到 `RemoteWebInfo`。
- 提交列表分页：`PAGE_SIZE = 30`；后端用 `--max-count = limit + 1` 探测下一页；前端初始 `offset = PAGE_SIZE`，每次 `loadMore` 后 `offset += PAGE_SIZE`（即使返回不足 PAGE_SIZE 条，也保证测试稳定与下次请求的 offset 一致）。
- ref 解析：`parser.rs::parse_log_refs` + `collect_ref_kind_map`（`for-each-ref`）做 `head / local-branch / remote-branch / tag` 分类，避免短名歧义。
- ref 选择器：默认选项是 `__all__`（在 allRefs 模式下）或 `__head__`（HEAD 模式）或 `ref:<refName>`，其后追加所有本地分支（`branch:<name>`）。
- 空仓处理：仓库无 commits 时，`git_log` 返回 `empty_log_page()`（`entries=[], hasMore=false`），前端用 "No commits yet" 文案占位。

## 7. 配置项

- `PAGE_SIZE = 30`（前端 `GitHistoryPane` 内部常量）
- `ROW_HEIGHT = 32`
- `MAX_LOG_LIMIT`：后端 Rust 常量，限制单页最大条数
- ref 选择器最大宽度 `max-w-44`
- 搜索过滤最少 2 个字符

## 8. 测试

- `GitHistoryPane.vue.test.ts`：分页 + ref 切换 + 远程链接 + 提交详情流程。
- `GitHistoryStack.vue.test.ts`：tabs -> pane 路由、ref 切换事件回传。
- `gitHistoryVueBoundary.test.ts`：模块下不允许 React 残留。
- 后端 `operations.rs::log` 测试覆盖 default / refName / all / ref 分类 / 分页 offset / hasMore / 无效 ref / 空仓。

## 9. 相关文档

- [详细设计](./detailed-design.md)