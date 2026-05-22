# Repository Guidelines

## Project Structure & Module Organization

Nexterm is a Tauri 2 desktop app with a Vue 3 + TypeScript frontend and Rust backend. Frontend code lives in `src/`, with feature areas under `src/modules/`, app shell code under `src/app/`, shared utilities under `src/lib/`, styles under `src/styles/`, and settings window code under `src/settings/`. Native commands and system access live in `src-tauri/src/modules/`; icons and Tauri configuration live in `src-tauri/`. Static web assets are in `public/`. Read `NEXTERM.md` before larger changes.

## Build, Test, and Development Commands

- `pnpm i`: install workspace dependencies.
- `pnpm dev`: run the Vite frontend on port `3180`.
- `pnpm tauri dev`: run the desktop app in development mode.
- `pnpm build`: run `vue-tsc --noEmit` and build frontend bundles.
- `pnpm test`: run the Vitest suite once.
- `cd src-tauri && cargo check --all-targets --locked`: check Rust targets.
- `cd src-tauri && cargo clippy --all-targets --locked -- -D warnings`: enforce Rust lint cleanliness.

## Coding Style & Naming Conventions

Use strict TypeScript, Vue single-file components, Pinia stores, and the `@/` alias instead of deep relative imports. Vue components use `PascalCase.vue`; composables, services, stores, and helpers use descriptive `camelCase` filenames. Rust modules use `snake_case` and should stay grouped by domain, such as `pty`, `fs`, `shell`, `workspace`, or `git`. Keep UI modern, minimal, and consistent with Naive UI theme overrides; use Tailwind only for layout and fine-grained styling.

## Testing Guidelines

Vitest and Vue Test Utils cover frontend behavior. Place tests next to the code they verify using `*.test.ts` or `*.vue.test.ts`. Add boundary tests when changing module ownership, framework migration rules, IPC contracts, or security-sensitive behavior. Run `pnpm test` plus the relevant build and Rust checks before opening a PR.

## Commit & Pull Request Guidelines

History follows concise Conventional Commit-style prefixes: `feat:`, `fix:`, `refactor:`, `chore:`, and `merge:`. Keep each commit focused. Pull requests should include a short summary, test results, linked issues when applicable, and screenshots or recordings for visible UI changes.

## Architecture & Security Notes

The webview must not access the filesystem, processes, shells, or secrets directly. Route native work through Tauri commands registered from `src-tauri/src/lib.rs`. Preserve long-lived terminal sessions across tab switches, and keep Windows ConPTY and Job Object behavior intact unless replacing it with an equivalent design.

## Agent-Specific Instructions

Use Chinese for repository collaboration. Keep architecture boundaries clear, avoid large mixed-responsibility files, and prefer module-level changes over broad rewrites.
