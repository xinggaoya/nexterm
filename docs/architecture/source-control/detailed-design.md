# 源代码控制模块详细设计

## 架构设计

### 整体架构

```mermaid
graph TB
    subgraph "Frontend Source Control Module"
        A[SourceControlPanel.vue] --> AA[NSelect 仓库选择<br/>(>=2 repos 时)]
        A --> B[SourceControlToolbar.vue]
        A --> C[SourceControlGitWorkflows.vue]
        A --> D[SourceControlChangeList.vue]
        A --> E[SourceControlCommitBox.vue]
        A --> F[useSourceControlState.ts]
        A --> G[useSourceControlActions.ts]
        A --> H[useSourceControlGitMetadata.ts]
        A --> I[useGitRepositoryRegistry.ts]
    end

    subgraph "Backend Modules"
        J[git/commands.rs] --> K[git/operations.rs]
        K --> L[git/parser.rs]
        J --> M[workspace.rs]
    end

    subgraph "Tauri IPC"
        N[native.git*<br/>via src/lib/native.ts]
        A --> N
        N --> J
    end

    F --> N
    G --> N
    H --> N
    I --> N
```

### 数据流

1. **工作区下嵌套仓库发现**: 工作区根变更 → `useGitRepositoryRegistry.refresh()` → `native.gitDiscoverRepositories` → 返回 `GitWorkspaceRepo[]`（含 truncated 标志）；数量 ≥ 2 时显示仓库选择器，单仓库时直接使用工作区根。
2. **状态刷新**: 仓库切换 / FS watcher → `useSourceControlState.loadSnapshot` 或 `refreshStatus` → `git_panel_snapshot` / `git_status` → entries 重建 → 装饰（gitDecorations）合并。
3. **暂存 / 取消暂存 / 丢弃操作**: 用户点击 → `useSourceControlActions.stageFile / unstageFile / discardEntries` → IPC → `refreshStatus` 重新拉取。
4. **分支切换**: `SourceControlGitWorkflows` 触发 `checkoutBranch` → `native.gitCheckoutBranch(repoRoot, branchName, isRemote)`；remote 分支自动判断本地同名分支。
5. **Stash 操作**: 独立 Apply / Pop / Drop 动作（互不影响）；Save 弹窗收集 `message` / `includeUntracked` / `keepIndex`，再调用 `native.gitStashPush`。
6. **提交**: 输入 commit message → `git_commit` → 通知 + `committed` 事件。
7. **装饰回传**: `useSourceControlState` 通过 `decorationsChange` 把 `GitDecorationMap` 传到 `Workbench`，再分发到文件浏览器。

## 数据结构

### 文件条目

```typescript
interface SourceControlFileEntry {
  key: string;                 // `${group}:${path}`
  group: SourceControlGroupId; // "staged" | "changes"
  path: string;
  originalPath: string | null;
  statusCode: string;          // A/M/D/R/U
  statusLabel: string;
  statusKind: SourceControlStatusKind;
  diffMode: DiffMode;          // staged -> "+" / changes -> "-"
  checkState: CheckState;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
}
```

每个变更文件按 staged/unstaged 维度拆成两条 entry，分别带不同 `diffMode`，这样变更列表里既能看 `index → working tree` 的 staged diff，也能看 working tree 当前的 unstaged diff。

### Git 装饰

```typescript
interface GitPathDecoration {
  statusKind: SourceControlStatusKind;
  staged: boolean;
  unstaged: boolean;
  hasDescendantChanges: boolean;
  count: number;
}

type GitDecorationMap = Map<string, GitPathDecoration>;
```

### 状态分组

```typescript
type SourceControlGroupId = "staged" | "changes";

interface SourceControlGroup {
  id: SourceControlGroupId;
  label: string;
  entries: SourceControlFileEntry[];
  sections: SourceControlEntrySection[];   // 按 statusKind 排序
}
```

分组顺序固定为 `["staged", "changes"]`；空组会被过滤掉。每个组内按 statusKind 子分组，statusKind 顺序为 `conflict → modified → added → untracked → deleted → renamed`。

### 嵌套仓库发现

```typescript
interface GitWorkspaceRepo {
  repoRoot: string;       // 绝对路径（local）或 wsl 转换后路径（wsl）
  relativePath: string;   // 相对于工作区根
  name: string;
  branch: string;
  upstream: string | null;
  isDetached: boolean;
  isWorktree: boolean;
}

interface GitRepositoryDiscovery {
  repositories: GitWorkspaceRepo[];
  truncated: boolean;
}
```

后端 `git_discover_repositories` 默认 `maxDepth=4`、`maxRepos=32`；命中上限时 `truncated=true` 告知 UI 还有更多未列出。前端 `useGitRepositoryRegistry` 在 workspace scope 或 rootPath 变化时主动刷新，并在收到 `nexterm://workspace-fs-changed` 时延迟 250ms 重试。

## 算法逻辑

### 状态解析

1. **Git 状态解析**: 后端 `git_status --porcelain=v2` 由 `parser.rs` 解析为 `GitChangedFile[]`（含 staged / unstaged / untracked / indexStatus / worktreeStatus）。
2. **状态码映射**: 前端 `statusKindFromCode` 把单字母归一化为 `modified | added | deleted | renamed | conflict | untracked`。
3. **分组逻辑**: 每个文件在 `staged` 与 `changes` 两个 group 各出现一次（视情况省略）；每组内按 statusKind 子分组。
4. **装饰生成**: `buildGitDecorationMap` 对每个文件路径向上合并到所有祖先目录，记录该祖先是否含有子孙变更。

### 仓库选择器

1. `useGitRepositoryRegistry.repositories` 反映当前工作区下的全部候选。
2. `repositories.length >= 2` 时 `SourceControlPanel` 渲染 `NSelect`（`data-repository-selector`）。
3. 选中后通过 `repo-selected` 事件回写 `activeRepoRoot`；Source Control 与命令面板共用同一个值。
4. `useGitRepositoryRegistry.isValidRepoRoot` 校验 `activeRepoRoot` 是否仍在当前候选中；无效时回落到第一个仓库。

### 暂存管理

1. **批量暂存**: 选择多个文件暂存（仅 `changes` 组 + unstaged 的项能 stage）。
2. **取消暂存**: 从 staged 组移除。
3. **状态同步**: 暂存 / 取消暂存后自动 `refreshStatus`。

### 提交流程

1. **消息验证**: 输入非空 + 有 staged 内容 + 无 busy action。
2. **执行提交**: `git_commit` 返回 `commitSha` + `summary`。
3. **后处理**: 刷新状态、通知、清空输入、emit `committed`。

### 分支工作流

1. **三组显示**: `SourceControlGitWorkflows` 把 `GitBranchInfo[]` 拆成 current / local / remote。
2. **本地 / 远端切换**: `gitCheckoutBranch(repoRoot, branch.name, branch.isRemote)`；远端时若本地同名已存在则自动转本地。
3. **创建分支**: 弹窗输入名称 → `gitCreateBranch` → 通知 + 刷新状态与 Git 元数据。

### Stash 工作流

1. **保存 (stash push)**：弹窗收集 message / includeUntracked / keepIndex → `gitStashPush`；`stashed=false` 时显示 "No changes to stash"。
2. **Apply (keep)**：调 `gitStashApply`，stash 仍在 stash 列表中。
3. **Pop**：调 `gitStashPop`，成功应用并从 stash 列表移除。
4. **Drop**：调 `gitStashDrop`；前端先弹原生 confirm 对话框 (`stashDropConfirmContent`)，点确认后才执行。

每个动作都带独立的 `BusyAction`（`stash-save` / `stash-pop:${selector}` / `stash-drop:${selector}` / `stash-apply:${selector}`），互不阻塞，互不串味。

## 错误处理

### Git 错误

1. **合并冲突**: 检测 `U` 状态码、对应 statusKind `conflict`，前端给 `statusConflict` 标签。
2. **权限错误**: 仓库根未授权 → `panelState = "error"`，显示错误信息。
3. **网络错误**: 远程操作失败 → `notifyError` 显示对应 `*Failed` 文案。
4. **仓库损坏**: Rust `ensure_git_available` 探测并返回明确错误。

### 操作错误

1. **暂存失败**: 文件锁定、pathspec 不存在。
2. **提交失败**: 钩子拒绝、空 staged。
3. **分支操作失败**: 冲突、名称非法（后端 `validate_git_name` 拦截）。
4. **仓库发现失败**: 单个候选失败被吞掉，列表继续；只在上层 `refresh()` 整体失败时报错。

## 性能考虑

### 状态刷新优化

1. **增量更新**: `useSourceControlState.refreshStatus` 比较新旧 changedFiles 列表，差异才重建装饰。
2. **防抖刷新**: git 相关 80ms，非 git 500ms。
3. **请求并发**: `statusRefreshInFlight` 单飞，避免叠加。
4. **缓存**: `git_panel_snapshot` 一次拿全 repo + status，避免双调用。

### UI 优化

1. **虚拟滚动**: `SourceControlChangeList` 使用 `NVirtualList`，条目高 32px。
2. **选择集去抖**: `selectedKeySet` 通过 `shallowRef` + 自定义 sync 函数减少无效 patch。
3. **gitDecorations 全量合并**: 单次遍历 entries 完成 stagedCount / stageAllPaths / unstageAllPaths / discardAllEntries 四项聚合，避免 O(N×M) 重复计算。

## 测试策略

### 单元测试

- `sourceControlModel.test.ts`: 分组逻辑、状态码归一化、跨 group 的 entry 拆分。
- `sourceControlFormat.test.ts`: 状态码 -> 标签 / tone / dot。
- `gitDecorations.test.ts`: 装饰合并、祖先路径传播。
- `useSourceControlState.test.ts`: panel 状态机、busyAction、装饰差量。
- `useSourceControlActions.test.ts`: 单文件 / 批量 / discard 对话框 / 提交 / 远程操作。
- `useSourceControlGitMetadata.test.ts`: branches + stashes 拉取、错误处理。
- `useGitRepositoryRegistry.test.ts`: ownershipKey 防过期、workspace scope 切换重置、FS 事件防抖。

### 集成测试

- `SourceControlPanel.vue.test.ts`: 完整流水线（含仓库选择器），覆盖 stage / unstage / discard / fetch / pull / push / branch / stash / history 等场景。
- `SourceControlGitWorkflows.vue.test.ts`: 三组分支渲染 + 搜索过滤 + stash 三动作。

### 边界测试

- `sourceControlVueBoundary.test.ts`: 模块下不允许 React 残留。
- `src/lib/nativeBoundary.test.ts`: Tauri IPC 必须经 `src/lib/native.ts`。

## 相关文件

- 前端: `src/modules/source-control/`
- 后端: `src-tauri/src/modules/git/`（含 commands / operations / parser / types）
- 通知: `src/modules/notifications/`
- 命令: `src/modules/commands/`
- 工作区: `src/modules/workspace/`
- Tauri IPC 出口: `src/lib/native.ts`