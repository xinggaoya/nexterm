import { inject, provide, type InjectionKey } from "vue";
import type { WorkspaceNative } from "@/lib/native";
import type { WorkspaceInstance } from "@/modules/workspace/workspacesPinia";

/**
 * Per-workspace context injected by `WorkspaceHost` and consumed by every
 * workspace-scoped component/composable (editor, explorer, source-control,
 * terminal, tasks). This replaces the old global `currentWorkspaceEnv()`
 * singleton: each workspace provides its own env-bound native surface, so
 * native calls are always routed to the correct backend environment.
 */
export interface WorkspaceContext {
  workspace: WorkspaceInstance;
  /** Env-bound native invoke surface — every fs/git/pty call uses this. */
  wsNative: WorkspaceNative;
}

export const WORKSPACE_CONTEXT_KEY: InjectionKey<WorkspaceContext> = Symbol(
  "workspace-context",
);

export function provideWorkspaceContext(ctx: WorkspaceContext): void {
  provide(WORKSPACE_CONTEXT_KEY, ctx);
}

/**
 * Inject the current workspace context. Throws when called outside a
 * WorkspaceHost so misuse fails loudly rather than silently routing to the
 * wrong environment.
 */
export function useWorkspaceContext(): WorkspaceContext {
  const ctx = inject(WORKSPACE_CONTEXT_KEY);
  if (!ctx) {
    throw new Error(
      "useWorkspaceContext: no workspace context provided. This component must be rendered inside a WorkspaceHost.",
    );
  }
  return ctx;
}

/**
 * Non-throwing variant for components that may render outside a workspace
 * (e.g. the welcome screen or global title bar).
 */
export function tryWorkspaceContext(): WorkspaceContext | null {
  return inject(WORKSPACE_CONTEXT_KEY, null);
}
