# 源代码控制 source-control

## 1. 概述

源代码控制模块提供 Git 状态面板：变更列表、暂存 / 取消暂存、提交、分支工作流、远程同步、Stash 管理、远程仓库管理。

核心能力：

- 工作区下的 **嵌套仓库发现**：单仓库 monorepo 时直接显示当前仓库；多于 1 个候选时显示仓库切换下拉框（`activeRepoRoot`）。
- **分支面板** 分为 Current / Local / Remote 三组，支持搜索、显示上游 ahead/behind、最近一次提交主题。
- **Stash 面板** 对每条 stash 提供 `Apply (keep)` / `Pop` / `Drop` 三个独立动作；保存时支持 `Include untracked` / `Keep staged` 选项。
- **远程仓库管理**：`SourceControlToolbar` 网络下拉菜单新增「管理远程…」一项，唤起 `SourceControlRemotes` 模态：列出所有远程、添加、编辑（仅改 URL）、删除（带确认弹窗）。Edit 不会改 name 以避免破坏 upstream 跟踪。
- 命令面板与 Source Control 共享同一个 `activeRepoRoot`（通过 `useWorkbenchCommands.resolveCurrentRepo`）。
- 自动刷新策略与 Git 状态变更：`nexterm://workspace-fs-changed` 触发 80ms（git 相关）/ 500ms 防抖。

底层命令经 `native.git*`；FS watcher 事件触发自动刷新。

## 2. 目录与文件

```
src/modules/source-control/
  SourceControlPanel.vue            # 主面板（仓库选择 + 状态 + 变更 + 提交）
  SourceControlToolbar.vue          # 顶部工具条（分支名 + fetch/pull/push + 管理远程 + 刷新 + 历史）
  SourceControlGitWorkflows.vue     # 分支 + Stash 面板
  SourceControlRemotes.vue          # 远程仓库管理模态（列表 + 新增/编辑/删除）
  SourceControlChangeList.vue       # 变更列表（虚拟滚动 + 分组）
  SourceControlChangeRow.vue        # 单行
  SourceControlCommitBox.vue        # 提交输入
  sourceControlCommands.ts          # 注册到 commands
  sourceControlModel.ts             # 数据模型 + 分组
  sourceControlFormat.ts            # 状态码 -> 标签/样式
  gitDecorations.ts                 # 装饰映射（status -> color/letter/tooltip）
  useSourceControlState.ts          # 状态 composable（panel + entries + 装饰）
  useSourceControlActions.ts        # 动作 composable（stage/unstage/discard/commit/branch/stash/remote）
  useSourceControlGitMetadata.ts    # 分支 + Stash + 远程列表 composable
  useGitRepositoryRegistry.ts       # 工作区下嵌套仓库发现 composable
  index.ts
```

## 3. 依赖

### 3.1 内部

- `@/lib/native` -- `git*` 命令（包括 `git_discover_repositories`）
- `@/modules/workspace/workspaceEnvSnapshot` -- 当前 `WorkspaceEnv`（local / wsl）
- `@/modules/explorer/lib/iconResolver` -- 文件图标
- `@/modules/i18n/translate` -- 国际化
- `@/modules/notifications/notificationCenter`
- `@/modules/commands/types` -- `CommandSpec`
- `@/modules/editor` -- 打开 diff 标签
- `@/modules/tabs` -- `GitDiffTab` / `GitHistoryTab` 状态

## 4. 数据契约

### 4.1 公共类型

```ts
type SourceControlFileEntry = {
  key: string;                    // `${group}:${path}` 形式
  group: SourceControlGroupId;    // "staged" | "changes"
  path: string;
  originalPath: string | null;
  statusCode: string;             // 单字母归一化后的状态码：A/M/D/R/U
  statusLabel: string;
  statusKind: SourceControlStatusKind;
  diffMode: DiffMode;             // staged -> "+"，changes -> "-"
  checkState: CheckState;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

type GitDecorationMap = Map<string, GitPathDecoration>;
type GitPathDecoration = {
  statusKind: SourceControlStatusKind;
  staged: boolean;
  unstaged: boolean;
  hasDescendantChanges: boolean;
  count: number;
};

// 当前实际只有这两个分组（与 Rust `git_status` 的 staged/unstaged 语义对齐）。
type SourceControlGroupId = "staged" | "changes";

type SourceControlStatusKind =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "conflict"
  | "untracked";

type SourceControlEntrySection = {
  statusKind: SourceControlStatusKind;
  entries: SourceControlFileEntry[];
};

type SourceControlEntryGroup = {
  id: SourceControlGroupId;
  entries: SourceControlFileEntry[];
  sections: SourceControlEntrySection[];   // 按 statusKind 排序后形成的子组
};

// 嵌套仓库发现（git_discover_repositories 返回）
type GitWorkspaceRepo = {
  repoRoot: string;
  relativePath: string;          // 相对于工作区根
  name: string;                  // basename
  branch: string;
  upstream: string | null;
  isDetached: boolean;
  isWorktree: boolean;           // .git 是文件还是目录
};

type GitRepositoryDiscovery = {
  repositories: GitWorkspaceRepo[];
  truncated: boolean;            // 命中 maxRepos 或 maxDepth 时为 true
};
```

### 4.2 Tauri 命令

| 命令 | 说明 |
|------|------|
| `git_resolve_repo` | 解析给定 cwd 下的仓库根，返回 `GitRepoInfo`（branch / upstream / isDetached） |
| `git_panel_snapshot` | 单次拉取 `repo + status`，避免 IPC 双调用 |
| `git_status` | 刷新仓库状态（含 changedFiles） |
| `git_diff_content` | 单文件 diff 内容（含 isBinary / truncated） |
| `git_stage` / `git_unstage` | 按 pathspec 暂存 / 取消暂存 |
| `git_discard` | 按 `GitDiscardEntry[]` 丢弃工作区修改（含 untracked） |
| `git_commit` | 提交，返回 `commitSha` + `summary` |
| `git_fetch` / `git_pull_ff_only` / `git_push` | 远程同步，返回对应 `*Result` |
| `git_branch_list` | 全分支列表（含 local + remote，附带 `lastCommitSubject` / ahead / behind） |
| `git_checkout_branch` | `git switch`；`remote=true` 时如本地同名分支已存在则自动切换到本地分支，否则 `--track` 到远端 ref |
| `git_create_branch` | `git switch -c` 风格的创建并切换 |
| `git_stash_list` / `git_stash_push` / `git_stash_pop` / `git_stash_drop` / `git_stash_apply` | Stash 全部操作；后三者带 `expectedSha` 用于乐观锁 |
| `git_remote_url` | 读取单个远程的 fetch URL（仅 `origin` 用途） |
| `git_remote_list` | 列出所有远程：`name` + `fetchUrl` + `pushUrl`（缺失 pushurl 时复用 fetch_url） |
| `git_remote_add` | 新增远程，`input: { name, url }` 返回新建的 `GitRemoteInfo` |
| `git_remote_remove` | 删除远程（按 `name`） |
| `git_remote_set_url` | 编辑远程 URL，`input: { name, newUrl }` 返回更新后的 `GitRemoteInfo` |
| `git_discover_repositories` | 工作区下嵌套仓库发现（`maxDepth=4`、`maxRepos=32`），按 workspace 区分 local / WSL 收集策略 |

### 4.3 事件

- 内部 `decorationsChange` / `openDiff` / `openHistory` / `committed` / `repo-selected`，由 composable 之间共享。
- 监听 `nexterm://workspace-fs-changed` 触发自动刷新（Git 相关 80ms，非 Git 500ms 防抖）。

## 5. Pinia 状态

无独立 store。状态由 `useSourceControlState` / `useSourceControlActions` / `useSourceControlGitMetadata` / `useGitRepositoryRegistry` 四个 composable 维护（组件作用域 ref），跨组件通过 props 传递或在 `MainApp` / `Workbench` 中提升。

`activeRepoRoot` 由 `MainApp` 通过 `repo-selected` 事件回写到 `useWorkbenchCommands` 的共享状态，使命令面板的 Git 命令与 Source Control 当前选中的仓库保持一致。

## 6. 关键算法

- `useSourceControlState` 拉 `git_panel_snapshot` 拿到全部数据后，按 `SourceControlGroupId` 拆成 `staged` / `changes` 两组；每组再按 `statusKind`（conflict → modified → added → untracked → deleted → renamed）排序。同一文件在 staged 与 changes 中各出现一次（diffMode 分别为 `+` / `-`）。
- `useGitRepositoryRegistry` 用 `ownershipKey = workspaceScope \0 normalizePath(rootPath)` 标记当前请求归属，避免旧工作区的过期响应覆盖新工作区。FS watcher 事件触发 250ms 防抖刷新。
- 自动刷新延迟：Git 事件 80ms，非 Git 事件 500ms（防抖）。
- 装饰（`gitDecorations`）根据 status code 映射到 `{statusKind, staged, unstaged, hasDescendantChanges, count}`，对每个文件路径向上合并到所有祖先目录。
- Stash Apply（保留 stash）/ Pop（应用并移除）/ Drop 三种动作走独立的 IPC 命令与独立通知文案，避免单条 `git_stash_pop` 串味。
- `useSourceControlGitMetadata.refreshGitMetadata` 当前拉 3 路（`git_branch_list` / `git_stash_list` / `git_remote_list`）放在同一个 `Promise.all`；`git_remote_list` 的失败被单独 `.catch` 兜底为 `[]` 并写入 `error` ref，避免阻塞分支 / Stash 列表的渲染。`remotes` 状态对外是只读快照，UI 通过 `useSourceControlActions.addRemote/updateRemote/removeRemote`（每个动作成功后均调用 `refreshGitMetadata` + `refreshStatus`）触发重新拉取。
- 远程仓库管理（`SourceControlRemotes.vue`）的 `name` 字段在客户端用 `/^[A-Za-z0-9_][A-Za-z0-9._-]*$/`、`len ≤ 64` 校验；URL 仅校验非空，让 git 端做最终判断；后端 `validate_remote_name` 复用同一规则并增加 `--` 开头拒绝（防止被解析为选项）。

## 7. 配置项

- `rootPath: string | null` -- 工作区根
- `activeRepoRoot: string | null` -- 嵌套仓库切换时选中的仓库根
- `workspaceScope: string` -- local / wsl:&lt;distro&gt;，决定 `git_discover_repositories` 用本地还是 WSL 路径
- 刷新延迟（内部常量，git 相关 80ms / 其它 500ms）
- 嵌套仓库发现：`maxDepth=4`，`maxRepos=32`

## 8. 测试

- `gitDecorations.test.ts` / `sourceControlFormat.test.ts` / `sourceControlModel.test.ts`
- `useSourceControlState.test.ts` / `useSourceControlActions.test.ts`（含 addRemote / updateRemote / removeRemote / listRemotes 4 个用例）
- `useGitRepositoryRegistry.test.ts`
- `SourceControlPanel.vue.test.ts`
- `SourceControlGitWorkflows.vue.test.ts`
- `SourceControlRemotes.vue.test.ts`（覆盖空态、列表、添加、编辑、删除、名称校验）
- `sourceControlVueBoundary.test.ts`
- 后端：`src-tauri/src/modules/git/operations/remote.rs` 内 `mod tests` 覆盖 `validate_remote_name` / `parse_remote_name` / `remote_list` / `remote_add` / `remote_remove` / `remote_set_url` 集成路径。

## 9. 相关文档

- [详细设计](./detailed-design.md)