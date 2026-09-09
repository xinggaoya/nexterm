# Repository Guidelines

## Project Overview

Nexterm is a terminal-centric development environment built as a Tauri 2 desktop app. It provides an integrated workspace with terminal multiplexing, file explorer, code editor, Git integration, and task runner -- all within a single native window. The Rust backend owns all system access; the Vue 3 webview is a pure presentation layer.

Identifiers: npm package `nexterm`, Rust crate `nexterm` (lib `nexterm_lib`), helper binary `nexterm-wsl-watcher`, Tauri product `Nexterm`, bundle id `app.xinggaoya.nexterm`. Current version: `0.1.2` (kept in sync between `package.json` and `src-tauri/Cargo.toml`).

## Development Commands

```bash
pnpm i
pnpm dev                  # Vite dev server on :3180
pnpm tauri dev            # Tauri dev (desktop)
pnpm build                # vue-tsc --noEmit && vite build
pnpm exec vue-tsc --noEmit  # type check only
pnpm test                 # vitest run
pnpm test:watch           # vitest --watch
cd src-tauri && cargo check --all-targets --locked
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
```

## Architecture & Data Flow

```
+------------------------------------------------------+
|  Vue 3 Webview                                       |
|  MainApp.vue -> WorkspaceHost(Rail + TopBar/SessionStrip |
|  + Canvas + StatusDock)                                  |
|  Pinia stores <-> Tauri invoke() <-> Rust commands   |
+--------------------------+---------------------------+
                           | Tauri IPC
+--------------------------v---------------------------+
|  Rust Backend (src-tauri/src/lib.rs)                 |
|  pty | shell | fs | git | workspace | lock | process |
+------------------------------------------------------+
```

- **Frontend -> Backend**: All native operations go through `invoke()` calls to Tauri commands registered in `src-tauri/src/lib.rs`. The webview never accesses the filesystem, processes, shells, or secrets directly.
- **Backend -> Frontend**: Rust emits events via Tauri event bus (`nexterm://workspace-fs-changed`, `nexterm://deep-link-open`, PTY output via Tauri `Channel`).
- **State flow**: Preferences hydrate from Rust `LazyStore` -> Pinia store -> reactive components. Tabs, workspace, and task state each live in their own Pinia store.
- **Module communication**: Modules communicate primarily through shared Pinia stores and direct composable calls. Cross-cutting concerns use the Tauri event bus.
- **WSL support**: On Windows, a separate `nexterm-wsl-watcher` binary is spawned to monitor WSL workspace directories, emitting JSON filesystem events to stdout.

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/app/` | App shell（终端优先 v3 布局）: `MainApp.vue`, `shell/` (WorkspaceHost / Rail / TopBar / SessionStrip / Canvas / OverlayPanel / StatusDock / TabContextMenu), `components/` (WorkspaceDashboard / WorkspaceEnvSelector / UnsavedCloseGuard), composables (`useWorkspaceLifecycle` / `useTaskConsoleController` / `useWorkbenchCommands` / `useWindowChromeState`) |
| `src/modules/terminal/` | Terminal multiplexing, PTY bridge, pane tree, xterm.js rendering |
| `src/modules/editor/` | CodeMirror 6 editor, file editing, syntax highlighting, diff views |
| `src/modules/explorer/` | File tree, file system navigation, search, context menu |
| `src/modules/tabs/` | Tab management, tab types, pane split, close guards |
| `src/modules/settings/` | Preferences Pinia store, low-level Tauri store, settings drawer tabs |
| `src/modules/commands/` | Command registry, keybinding resolution, command specs, command palette |
| `src/modules/tasks/` | Task discovery, task execution, task run stores |
| `src/modules/source-control/` | Git panel UI (staging, committing, branching) |
| `src/modules/git-history/` | Git log, commit inspection, diff views |
| `src/modules/theme/` | Theme application, Naive UI theme overrides |
| `src/modules/notifications/` | Toast notification system |
| `src/modules/workspace/` | Workspace root, authorization, WSL distro management |
| `src/modules/preview/` | In-webview URL preview |
| `src/modules/markdown/` | Markdown preview pane + service |
| `src/modules/i18n/` | vue-i18n setup, `zh-CN` / `en-US` locales |
| `src/modules/pinia/` | Pinia boundary tests (not a store library) |
| `src/lib/` | Shared utilities: `native.ts` (Tauri invoke wrappers), `clipboard.ts`, `platform.ts`, `launchDir.ts`, `simpleStore.ts`, `fonts.ts`, `tauriRuntime.ts`, `appInfo.ts`, `path.ts`, `normalizeError.ts`, `refs.ts`, `useEventListener.ts`, `touchDevice.ts`, `gitStatus.ts` |
| `src/components/` | Shared UI: `WindowControls.vue`, `TooltipTitle.vue` (NOT globally auto-registered; import explicitly) |
| `src/styles/` | `tokens.ts` (oklch to RGB token resolution), `terminalTheme.ts`, `globals.css`, `code-highlight.css`, `fonts.css` |
| `src/settings/` | Settings drawer + 6 section components |
| `src-tauri/src/modules/` | Rust backend modules: `pty`, `shell`, `fs`, `git`, `workspace`, `lock`, `process` |
| `src-tauri/src/panic_report.rs` | Panic hook that emits structured log + stderr |
| `src-tauri/wsl-watcher-helper/` | Standalone binary for WSL filesystem watching |

## Code Conventions & Common Patterns

### Naming & Files

- **Vue components**: `PascalCase.vue` (e.g., `MainApp.vue`, `TerminalPane.vue`)
- **Composables**: `useCamelCase.ts` (e.g., `useWorkspaceLifecycle.ts`, `useWorkbenchCommands.ts`)
- **Stores**: `camelCasePinia.ts` for Pinia stores (e.g., `preferencesPinia.ts`, `tabsPinia.ts`), `store.ts` for low-level stores
- **Types**: `camelCaseTypes.ts` (e.g., `tabsTypes.ts`)
- **Rust modules**: `snake_case` directories and files grouped by domain
- **Path alias**: Always use `@/` instead of deep relative imports

### TypeScript & Vue

- Strict TypeScript with `ESNext` modules and `bundler` resolution
- Vue 3 Composition API with `<script setup lang="ts">`
- Auto-imports configured: Vue reactivity API, Pinia, vue-router are globally available -- no manual imports needed
- Auto-components: Naive UI components are auto-registered via `unplugin-vue-components` + `NaiveUiResolver`; local components under `src/components/` are NOT globally registered and must be imported explicitly
- Pinia stores use `defineStore` with setup function pattern (no Options API, no `this.*`)

### UI & Styling

- **Primary UI library**: Naive UI with theme overrides via `NConfigProvider`
- **Tailwind CSS v4**: Layout, spacing, fine-grained styling only -- not for component theming
- **Theme tokens**: oklch CSS custom properties (shadcn-style) resolved to RGB at runtime via `src/styles/tokens.ts`
- **Terminal theming**: `src/styles/terminalTheme.ts` reads app tokens so xterm visually fuses with the app shell
- **Keep UI modern, minimal, scannable** -- no marketing-style text blocks

### State Management

- Preferences: `LazyStore` (Rust `@tauri-apps/plugin-store`) -> `src/modules/settings/store.ts` -> `src/modules/settings/preferencesPinia.ts` -> components
- Tabs: `src/modules/tabs/tabsPinia.ts` -- manages tab array, active tab, pane split operations
- Workspace: `src/app/useWorkspaceLifecycle.ts` composable -- watcher lifecycle, workspace switching, env management
- Tasks: Factory pattern via `createTaskRunStore()` in `src/app/useTaskConsoleController.ts`
- Cross-store reads: only via direct composable/store access. Do not introduce a global event bus for store-to-store sync.

### Error Handling

- Rust: Context-aware poison errors via `src-tauri/src/modules/lock.rs` utilities (`mutex_lock`, `rwlock_read`, `rwlock_write`, `condvar_wait_timeout`)
- Frontend: Tauri invoke errors propagated as rejected promises; callers handle with try/catch and `normalizeError()` from `@/lib/normalizeError`
- Panics: `src-tauri/src/panic_report.rs` logs structured message + location to `log` and stderr

### Async Patterns

- Tauri `invoke()` returns `Promise<T>` -- use `async`/`await` in composables
- PTY output delivered via Tauri `Channel` (event-based streaming, see `src/modules/terminal/lib/pty-bridge.ts`)
- File watcher events delivered via Tauri event bus (`nexterm://workspace-fs-changed`)
- Event subscriptions on `window` / DOM must use `useEventListener` from `@/lib/useEventListener` so add/remove are paired

### Path Handling

- Paths may originate from Windows, Unix, OSC 7, or file tree -- always normalize separators at boundaries (`@/lib/path`)
- WSL path conversion handled in `src-tauri/src/modules/workspace/wsl.rs`
- Backslashes in strings are always literal `\\` (Windows path) -- never interpret them

### IPC Contract

- All Tauri invocations MUST go through `@/lib/native` (`native.*` or the few top-level helpers). Direct `invoke()` calls outside `native.ts` are blocked by `src/lib/nativeBoundary.test.ts`.
- `WorkspaceEnv` is passed as the `workspace` argument on every native call; Rust uses it to select local vs WSL implementation.

## Important Files

| File | Role |
|------|------|
| `src/main.ts` | App entry: creates Vue app, installs Pinia + i18n, hydrates preferences, mounts |
| `src/app/MainApp.vue` | Root component: theme, layout, settings drawer, command palette, notification bridge |
| `src/modules/settings/preferencesPinia.ts` | Central preferences Pinia store (setup-function, spec-driven；新增偏好只需改 `store.ts` 的 `PREF_SPECS` 表 + 默认值) |
| `src/modules/settings/store.ts` | Low-level Tauri store persistence layer with all preference keys and types |
| `src/modules/tabs/tabsPinia.ts` | Tab state management |
| `src/modules/tabs/tabsTypes.ts` | Tab type unions (Terminal, Editor, Preview, Markdown, GitDiff, GitHistory, GitCommitFileDiff) |
| `src/app/useWorkbenchCommands.ts` | Command registry wiring for workbench actions |
| `src/app/useWorkspaceLifecycle.ts` | Workspace root lifecycle, FS watcher, env switching |
| `src/app/useTaskConsoleController.ts` | Task discovery and execution management |
| `src/lib/native.ts` | Typed Tauri invoke wrappers for all backend commands (THE single IPC exit) |
| `src/styles/tokens.ts` | Runtime oklch to RGB token resolution |
| `src-tauri/src/lib.rs` | Rust entry: registers all Tauri commands and state |
| `src-tauri/src/modules/pty/mod.rs` | PTY commands: open, write, resize, read_transcript, close |
| `src-tauri/src/modules/pty/session.rs` | PTY session, Transcript, Job Object, flusher |
| `src-tauri/src/modules/shell/mod.rs` | Shell commands: run, session, background spawn/kill/list |
| `src-tauri/src/modules/shell/profiles.rs` | 本地终端 shell profile 探测与白名单解析（`shell_list_profiles`、`pty_open` 的 `shellId` 只收 id） |
| `src-tauri/src/modules/fs/mod.rs` | FS commands: read/write/stat, mutate, search, grep, glob, tree, watcher |
| `src-tauri/src/modules/git/` | `commands.rs` 为 Tauri 包装层；`operations/` 按 status/stage/commit/branch/stash/log/remote/discover 分文件实现 git 能力 |
| `src-tauri/src/modules/workspace/` | Workspace auth/registry (`mod.rs`, `registry.rs`), env 与 SSH 守卫 (`env.rs`), WSL 路径与进程助手 (`wsl.rs`) |
| `src-tauri/src/modules/lock.rs` | Mutex/RwLock poison error wrappers |
| `src-tauri/wsl-watcher-helper/src/main.rs` | WSL filesystem watcher binary (independent process) |
| `vite.config.ts` | Vite 7 config with Vue, Tailwind 4, auto-imports, chunk splitting |

## Runtime/Tooling Preferences

- **Package manager**: pnpm (required)
- **Node runtime**: Node.js (no Bun)
- **Frontend bundler**: Vite 7
- **Rust edition**: 2021, release profile with LTO=fat, panic=abort, strip=true
- **No ESLint or Prettier configured** -- rely on TypeScript strict mode and `vue-tsc --noEmit`
- **Auto-imports**: `unplugin-auto-import` (Vue/Pinia/Router APIs), `unplugin-vue-components` (Naive UI only)
- **Chunk splitting**: xterm, CodeMirror, and Vue vendor chunks separated for performance

## Testing & QA

- **Framework**: Vitest with jsdom environment
- **Component testing**: `@vue/test-utils`
- **File placement**: Tests co-located with source -- `*.test.ts` for logic, `*.vue.test.ts` for Vue components
- **Mocking**: `vi.mock()` for Tauri API mocking, `vi.hoisted()` for mock hoisting before module import
- **Run**: `pnpm test` (single run), `pnpm test:watch` (watch mode)
- **Before PRs**: Run `pnpm test` + `pnpm build` + `cargo clippy --all-targets --locked -- -D warnings`
- **CI 门禁**: `.github/workflows/ci.yml` 在 push(main)/PR 上运行相同的前端与 Rust 检查（Ubuntu + Windows 双矩阵）
- **Add boundary tests** when changing: module ownership, framework migration rules, IPC contracts, or security-sensitive behavior

## Commit & Pull Request Guidelines

Conventional Commit prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `merge:`. Keep each commit focused. PRs should include a short summary, test results, linked issues, and screenshots or recordings for visible UI changes. When adding a new module, also add a `docs/architecture/<module>/README.md` covering responsibilities, IPC, store, and tests.

## Agent-Specific Instructions

- Communicate in Chinese in commit messages, PR descriptions, and code comments when feasible; technical names stay in English.
- Prefer small module-scoped changes over broad rewrites.
- Keep architecture boundaries clear: webview never accesses fs/pty/shell directly; Rust is the only system access layer.
- See `docs/architecture/README.md` for full architecture docs and the module map.
