# Command Tasks Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the command center into a module-owned IDE command layer with a task runner MVP and practical Git, Explorer, and Editor actions.

**Architecture:** Keep command definitions close to their feature modules, and keep `MainApp.vue` as the composition boundary. Task discovery lives in a new `src/modules/tasks/` module that reads known workspace manifest files through existing filesystem IPC helpers, while terminal execution reuses long-lived terminal sessions.

**Tech Stack:** Vue 3, TypeScript, Pinia, Naive UI, Vitest, Tauri IPC through existing helpers.

---

### Task 1: Modular Command Specs

**Files:**
- Modify: `src/modules/commands/types.ts`
- Modify: `src/modules/commands/coreCommands.ts`
- Create: `src/modules/commands/commandSpecs.ts`
- Create: `src/modules/terminal/terminalCommands.ts`
- Create: `src/modules/source-control/sourceControlCommands.ts`
- Create: `src/modules/explorer/explorerCommands.ts`
- Create: `src/modules/editor/editorCommands.ts`
- Test: `src/modules/commands/commandSpecs.test.ts`

- [ ] Write a failing test that asserts the combined command spec list contains unique command ids, includes terminal/source-control/explorer/editor/workbench commands, and preserves the current command palette defaults.
- [ ] Implement module-level command spec exports and an aggregate `ALL_COMMAND_SPECS`.
- [ ] Keep `coreCommands.ts` as a compatibility re-export while moving ownership to focused module files.
- [ ] Run `pnpm test src/modules/commands/commandSpecs.test.ts src/modules/commands/registry.test.ts src/modules/commands/keybindings.test.ts`.

### Task 2: Task Discovery Module

**Files:**
- Create: `src/modules/tasks/taskTypes.ts`
- Create: `src/modules/tasks/taskDiscovery.ts`
- Create: `src/modules/tasks/taskCommands.ts`
- Create: `src/modules/tasks/index.ts`
- Test: `src/modules/tasks/taskDiscovery.test.ts`

- [ ] Write failing tests for package script discovery from `package.json`, Cargo command discovery from `Cargo.toml`, and Makefile discovery.
- [ ] Implement `discoverWorkspaceTasks(root, readTextFile)` with deterministic task ordering.
- [ ] Add `tasks.run` command spec with title `Run Task` and default keybinding `null`.
- [ ] Run `pnpm test src/modules/tasks/taskDiscovery.test.ts`.

### Task 3: Terminal Task Execution

**Files:**
- Modify: `src/modules/tabs/tabsTypes.ts`
- Modify: `src/modules/tabs/tabsPinia.ts`
- Modify: `src/modules/terminal/lib/terminalSessionCore.ts`
- Test: `src/modules/tabs/tabsPinia.test.ts`
- Test: `src/modules/terminal/lib/terminalSessionCore.test.ts`

- [ ] Write failing tests that `newTaskTerminal(command, cwd)` creates a terminal tab with queued startup input, and terminal sessions flush queued input after the PTY opens.
- [ ] Add optional `queuedInput` to terminal tabs and a tab store action for task terminals.
- [ ] Add a small write queue inside terminal session core so commands sent before PTY readiness are not dropped.
- [ ] Run `pnpm test src/modules/tabs/tabsPinia.test.ts src/modules/terminal/lib/terminalSessionCore.test.ts`.

### Task 4: Workbench Command Wiring

**Files:**
- Modify: `src/app/useWorkbenchCommands.ts`
- Modify: `src/app/MainApp.vue`
- Modify: `src/modules/i18n/locales/en-US.ts`
- Modify: `src/modules/i18n/locales/zh-CN.ts`
- Test: `src/app/MainApp.vue.test.ts`

- [ ] Write failing tests that the command palette exposes `Run Task`, executing it opens a task terminal, and editor save/close commands are routed through the workbench.
- [ ] Wire `ALL_COMMAND_SPECS` into `useWorkbenchCommands`.
- [ ] Implement `tasks.run` by discovering tasks and selecting the best default task deterministically: package `dev`, package `start`, package `test`, first package script, Cargo `cargo test`, Cargo `cargo check`, Make `make`.
- [ ] Implement `editor.save`, `editor.closeActive`, `explorer.refresh`, `git.stageAll`, `git.unstageAll`, `git.fetch`, `git.pull`, and `git.push`.
- [ ] Run `pnpm test src/app/MainApp.vue.test.ts src/modules/commands/CommandPalette.vue.test.ts`.

### Task 5: Final Verification

**Files:**
- No new feature files.

- [ ] Run `pnpm test`.
- [ ] Run `pnpm build`.
- [ ] Run `git diff --check`.
- [ ] Review `git status --short` and keep `.learnings/` untracked.
