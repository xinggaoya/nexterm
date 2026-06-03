# Nexterm 前端重构 Phase 2 — IPC 收口

## 范围

把 `documentService` / `fileTreeService` / `markdownDocumentService` / `pty-bridge` / `workspaceNative` / `workspaceEnvPinia` / `launchDir` 全部切到 `native.*`，并把 `native.ts` 升级为 `fs*` / `pty*` / `wslListDistros` 等 IPC 命令的单一来源。`nativeBoundary.test.ts` 白名单同步收紧。

## 关键变更点

### `src/lib/native.ts`

新增类型：
- `FsReadResult`、`FsDirEntry`、`FsSearchHit`、`FsSearchResult`
- `PtyOutputChunk`、`PtyTranscriptRead`、`PtyHandlers`、`PtySession`、`RawPtyTranscriptRead`
- 常量 `PTY_TRANSCRIPT_READ_CHUNK = 1024 * 1024`、`FS_SEARCH_DEFAULT_LIMIT = 200`

新增方法：
- `fsReadFile` / `fsWriteFile` / `fsReadDir` / `fsCreateDir` / `fsCreateFile` / `fsRename` / `fsDelete` / `fsSearch`
- `getLaunchDir` / `getWslHome` / `wslListDistros`
- `ptyOpen`（内部用 `Channel` + `decodeOutputFrame` / `decodeBase64` 解码）
- `ptyWrite` / `ptyResize` / `ptyReadTranscript` / `ptyClose`
- `workspaceAuthorize` 接受可选 `WorkspaceEnv` 参数（向后兼容 store 调用方）

私有辅助：`decodeOutputFrame`（DataView → PtyOutputChunk）、`decodeBase64`（base64 → Uint8Array）。

### 迁移文件

| 文件 | 迁移前 | 迁移后 |
| --- | --- | --- |
| `src/modules/editor/lib/documentService.ts` | 直接 `invoke("fs_read_file"/"fs_write_file")` | `native.fsReadFile` / `native.fsWriteFile` |
| `src/modules/explorer/lib/fileTreeService.ts` | 直接 `invoke` 5 个 fs 命令 | `native.fsReadDir` / `fsCreateDir` / `fsCreateFile` / `fsRename` / `fsDelete` / `fsSearch` |
| `src/modules/markdown/lib/markdownDocumentService.ts` | 直接 `invoke("fs_read_file")` | `native.fsReadFile` |
| `src/modules/terminal/lib/pty-bridge.ts` | 直接 `invoke` pty_open/write/resize/read_transcript/close + `Channel` | thin wrapper：`openPty` = `native.ptyOpen`，类型 `re-export` |
| `src/modules/workspace/workspaceEnvPinia.ts` | 直接 `invoke("wsl_list_distros")` | `native.wslListDistros` |
| `src/modules/workspace/workspaceNative.ts` | 直接 `invoke` wsl_home / workspace_authorize | `native.getWslHome` / `native.workspaceAuthorize(path, workspace)` |
| `src/lib/launchDir.ts` | 直接 `invoke("get_launch_dir")` | `native.getLaunchDir` |

### 边界测试白名单

`src/lib/nativeBoundary.test.ts` 的白名单从 14 项（实现文件 + 测试文件）收紧到 7 项（仅测试文件 + native 自身）：

```ts
const whitelist: Record<string, true> = {
  "lib/native.ts": true,
  "lib/native.test.ts": true,
  "lib/launchDir.test.ts": true,
  "modules/editor/lib/documentService.test.ts": true,
  "modules/explorer/lib/fileTreeService.test.ts": true,
  "modules/markdown/lib/markdownDocumentService.test.ts": true,
  "modules/workspace/workspaceEnvPinia.test.ts": true,
};
```

## 验证结果

| 门禁 | 结果 |
| --- | --- |
| `pnpm test` | 通过（375/377；2 个预存在失败与本阶段无关：`FileExplorer.vue > renders git tones`、`SourceControlPanel.vue > runs fetch pull and push`） |
| `pnpm build` (`vue-tsc --noEmit && vite build`) | 通过 |
| `pnpm exec vitest run src/lib/native.test.ts` | 15 个用例全绿（含新增 7 个 fs/pty 用例） |
| `pnpm exec vitest run src/lib/nativeBoundary.test.ts` | 0 违规（仅白名单内 7 个测试文件 + native 自身） |
| `pnpm exec vitest run src/lib/eventBoundary.test.ts` | 0 违规 |
| `pnpm exec vitest run src/modules/pinia/setupStoreBoundary.test.ts` | 通过（4 个 store 仍待 Phase 3 迁移） |

## 风险与遗留

- `decodeBase64` / `decodeOutputFrame` / `PTY_TRANSCRIPT_READ_CHUNK` 计划中要求保留在 `pty-bridge.ts`，但因 `PtySession.readTranscript` 的返回类型必须稳定，base64 解码被前移到 `native.ts` 的私有辅助函数，`pty-bridge.ts` 退化为纯 `re-export` 入口。后续 Phase 5 若需把它们抽到 `src/lib/`，可以直接迁移。
- `pty-bridge.ts` 现在只剩 `openPty` + 类型 re-export；Phase 6 可以考虑完全删除并让 `terminalSessionCore` 直接消费 `native.ptyOpen`。
- `native.workspaceAuthorize` 现在接受可选 `WorkspaceEnv`，是因为 `workspaceRootPinia.openWorkspace` 需要在切换 `setEnv` 之前把目标 env 透传给后端；保留这一签名可避免 Phase 3 之前的 store 重构。

## 下一步

进入 Phase 3：把 `preferencesPinia` / `tabsPinia` / `workspaceRootPinia` / `workspaceEnvPinia` 全部迁移到 setup-function 模式，并扩展 `setupStoreBoundary.test.ts` 拒绝 `actions: {` / `this.*` 反模式。
