# Repository Guidelines

## Project Overview

Nexterm is a terminal-centric development environment built as a Tauri 2 desktop app. It provides an integrated workspace with terminal multiplexing, file explorer, code editor, Git integration, and task runner — all within a single native window. The Rust backend owns all system access; the Vue 3 webview is a pure presentation layer.

Identifiers: npm package `nexterm`, Rust crate `nexterm`, Tauri product `Nexterm`, bundle id `app.xinggaoya.nexterm`.

## Architecture & Data Flow

```
┌─────────────────────────────────────────────────────┐
│  Vue 3 Webview                                      │
│  MainApp.vue → WorkspaceShell → TabBar + PaneStack  │
│  Pinia stores ←→ Tauri invoke() ←→ Rust commands   │
└──────────────────────────┬──────────────────────────┘
                           │ Tauri IPC
┌──────────────────────────▼──────────────────────────┐
│  Rust Backend (src-tauri/src/lib.rs)                 │
│  pty | shell | fs | git | workspace                 │
└─────────────────────────────────────────────────────┘
```

- **Frontend → Backend**: All native operations go through `invoke()` calls to Tauri commands registered in `src-tauri/src/lib.rs`. The webview never accesses the filesystem, processes, shells, or secrets directly.
- **Backend → Frontend**: Rust emits events via Tauri event bus (file watcher, PTY output via channels, preference sync).
- **State flow**: Preferences hydrate from Rust `LazyStore` → Pinia store → reactive components. Tab state, workspace state, and task state live in their own Pinia stores.
- **Module communication**: Modules communicate primarily through shared Pinia stores and direct composable calls. Cross-cutting concerns use the Tauri event bus.
- **WSL support**: On Windows, a separate `nexterm-wsl-watcher` binary is spawned to monitor WSL workspace directories, emitting JSON filesystem events to stdout.

## Key Directories

| Directory | Purpose |
|-----------|---------|
| `src/` | Frontend source (Vue 3 + TypeScript) |
| `src/app/` | App shell: MainApp.vue, workspace shell, composables (commands, layout, lifecycle, window chrome, task console) |
| `src/modules/` | Feature modules, each self-contained |
| `src/modules/terminal/` | Terminal multiplexing, PTY bridge, pane tree, xterm.js rendering |
| `src/modules/editor/` | CodeMirror 6 editor, file editing, syntax highlighting |
| `src/modules/explorer/` | File tree, file system navigation |
| `src/modules/tabs/` | Tab management, tab types, pane split logic |
| `src/modules/settings/` | Preferences Pinia store, low-level store, tab config |
| `src/modules/commands/` | Command registry, keybinding resolution, command specs |
| `src/modules/tasks/` | Task discovery, task execution, task run stores |
| `src/modules/source-control/` | Git panel UI (staging, committing, branching) |
| `src/modules/git-history/` | Git log, commit inspection, diff views |
| `src/modules/theme/` | Theme application, Naive UI theme overrides |
| `src/modules/notifications/` | Toast notification system |
| `src/modules/workspace/` | Workspace root, authorization, WSL distro management |
| `src/lib/` | Shared utilities: `native.ts` (Tauri invoke wrappers), `clipboard.ts`, `platform.ts`, `launchDir.ts`, `simpleStore.ts`, `fonts.ts`, `tauriRuntime.ts`, `appInfo.ts` |
| `src/styles/` | `tokens.ts` (oklch→RGB token resolution), `terminalTheme.ts`, `globals.css`, `code-highlight.css`, `fonts.css` |
| `src/settings/` | Settings panel drawer + 6 section components |
| `src/components/` | Shared UI: `WindowControls.vue`, `TooltipTitle.vue` |
| `src-tauri/src/modules/` | Rust backend modules: `pty`, `shell`, `fs`, `git`, `workspace`, `lock`, `process` |
| `src-tauri/wsl-watcher-helper/` | Standalone binary for WSL filesystem watching |
| `public/` | Static assets (only `logo.png`) |

## Development Commands

```bash
# Install dependencies
pnpm i

# Frontend dev server (port 3180)
pnpm dev

# Desktop app dev mode
pnpm tauri dev

# Type-check + build frontend
pnpm build

# Type-check only
pnpm exec tsc --noEmit

# Run tests
pnpm test

# Rust checks
cd src-tauri && cargo check --all-targets --locked
cd src-tauri && cargo clippy --all-targets --locked -- -D warnings
```

## Code Conventions & Common Patterns

### Naming & Files

- **Vue components**: `PascalCase.vue` (e.g., `MainApp.vue`, `WorkspaceShell.vue`)
- **Composables**: `useCamelCase.ts` (e.g., `useWorkspaceLifecycle.ts`, `useWorkbenchCommands.ts`)
- **Stores**: `camelCasePinia.ts` for Pinia stores (e.g., `preferencesPinia.ts`, `tabsPinia.ts`), `store.ts` for low-level stores
- **Types**: `camelCaseTypes.ts` (e.g., `tabsTypes.ts`)
- **Rust modules**: `snake_case` directories and files grouped by domain
- **Path alias**: Always use `@/` instead of deep relative imports

### TypeScript & Vue

- Strict TypeScript with `ESNext` modules and `bundler` resolution
- Vue 3 Composition API with `<script setup lang="ts">`
- Auto-imports configured: Vue reactivity API, Pinia, vue-router are globally available — no manual imports needed
- Auto-components: `TooltipTitle`, `WindowControls` are globally registered
- Pinia stores use `defineStore` with setup function pattern

### UI & Styling

- **Primary UI library**: Naive UI with theme overrides via `NConfigProvider`
- **Tailwind CSS v4**: Layout, spacing, fine-grained styling only — not for component theming
- **Theme tokens**: oklch CSS custom properties (shadcn-style) → resolved to RGB at runtime via `src/styles/tokens.ts`
- **Terminal theming**: `src/styles/terminalTheme.ts` reads app tokens so xterm visually fuses with the app shell
- **Keep UI modern, minimal, scannable** — no marketing-style text blocks

### State Management

- Preferences: `LazyStore` (Rust `@tauri-apps/plugin-store`) → `src/modules/settings/store.ts` → `src/modules/settings/preferencesPinia.ts` → components
- Tabs: `src/modules/tabs/tabsPinia.ts` — manages tab array, active tab, pane split operations
- Workspace: `src/app/useWorkspaceLifecycle.ts` composable — watcher lifecycle, workspace switching, env management
- Tasks: Factory pattern via `createTaskRunStore()` in `src/app/useTaskConsoleController.ts`

### Error Handling

- Rust: Context-aware poison errors via `src-tauri/src/modules/lock.rs` utilities (`mutex_lock`, `rwlock_read`, `rwlock_write`)
- Frontend: Tauri invoke errors propagated as rejected promises; callers handle with try/catch

### Async Patterns

- Tauri `invoke()` returns `Promise<T>` — use `async`/`await` in composables
- PTY output delivered via Tauri channels (event-based streaming)
- File watcher events via Tauri event bus

### Path Handling

- Paths may originate from Windows, Unix, OSC 7, or file tree — always normalize separators at boundaries
- WSL path conversion handled in `src-tauri/src/modules/workspace.rs`

## Important Files

| File | Role |
|------|------|
| `src/main.ts` | App entry: creates Vue app, installs Pinia + i18n, hydrates preferences, mounts |
| `src/app/MainApp.vue` | Root component: theme, layout, settings drawer, command palette, notification bridge |
| `src/modules/settings/preferencesPinia.ts` | Central preferences Pinia store |
| `src/modules/settings/store.ts` | Low-level Tauri store persistence layer with all preference keys and types |
| `src/modules/tabs/tabsPinia.ts` | Tab state management |
| `src/modules/tabs/tabsTypes.ts` | Tab type unions (Terminal, Editor, Preview, Markdown, GitDiff, GitHistory, GitCommitFileDiff) |
| `src/app/useWorkbenchCommands.ts` | Command registry wiring for workbench actions |
| `src/app/useWorkspaceLifecycle.ts` | Workspace root lifecycle, FS watcher, env switching |
| `src/app/useTaskConsoleController.ts` | Task discovery and execution management |
| `src/lib/native.ts` | Typed Tauri invoke wrappers for all backend commands |
| `src/styles/tokens.ts` | Runtime oklch→RGB token resolution |
| `src-tauri/src/lib.rs` | Rust entry: registers all Tauri commands and state |
| `src-tauri/src/modules/pty/mod.rs` | PTY commands: open, write, resize, read_transcript, close |
| `src-tauri/src/modules/shell/mod.rs` | Shell commands: run, session, background spawn/kill/list |
| `src-tauri/src/modules/fs/mod.rs` | FS commands: read/write/stat, mutate, search, grep, glob, tree, watcher |
| `src-tauri/src/modules/git/mod.rs` | Git commands: status, diff, stage, commit, branch, stash, log |
| `src-tauri/src/modules/workspace.rs` | Workspace auth, current dir, WSL distros |
| `vite.config.ts` | Vite 7 config with Vue, Tailwind 4, auto-imports, chunk splitting |

## Runtime/Tooling Preferences

- **Package manager**: pnpm (required)
- **Node runtime**: Node.js (no Bun)
- **Frontend bundler**: Vite 7
- **Rust edition**: 2021, release profile with LTO=fat, panic=abort, strip=true
- **No ESLint or Prettier configured** — rely on TypeScript strict mode and `vue-tsc --noEmit`
- **Auto-imports**: `unplugin-auto-import` (Vue/Pinia/Router APIs), `unplugin-vue-components` (Naive UI + custom components)
- **Chunk splitting**: xterm, CodeMirror, and Vue vendor chunks separated for performance

## Testing & QA

- **Framework**: Vitest with jsdom environment
- **Component testing**: `@vue/test-utils`
- **File placement**: Tests co-located with source — `*.test.ts` for logic, `*.vue.test.ts` for Vue components
- **Mocking**: `vi.mock()` for Tauri API mocking, `vi.hoisted()` for mock hoisting before module import
- **Run**: `pnpm test` (single run), `pnpm test:watch` (watch mode)
- **Before PRs**: Run `pnpm test` + `pnpm build` + `cargo clippy --all-targets --locked -- -D warnings`
- **Add boundary tests** when changing: module ownership, framework migration rules, IPC contracts, or security-sensitive behavior

## Commit & Pull Request Guidelines

Conventional Commit prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, `merge:`. Keep each commit focused. PRs should include a short summary, test results, linked issues, and screenshots or recordings for visible UI changes.

## Agent-Specific Instructions

Use Chinese for repository collaboration. Keep architecture boundaries clear, avoid large mixed-responsibility files, and prefer module-level changes over broad rewrites.
