import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_LINUX, IS_WINDOWS } from "@/lib/platform";
import { normalizeWorkspacePath } from "./workspacePath";
import type { WorkspaceSelection } from "./workspaceRootPinia";

const WORKSPACE_WINDOW_PREFIX = "workspace";
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const MIN_WIDTH = 420;
const MIN_HEIGHT = 280;

/**
 * djb2 non-cryptographic hash, kept dependency-free so a workspace path can
 * collapse into a stable 8-character hex label. The hash lets us reuse the
 * same `WebviewWindow` across repeated "open in new window" requests for the
 * same selection (see `workspaceWindowLabel`).
 */
function hashWorkspaceKey(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function workspaceWindowUrl(selection: WorkspaceSelection): string {
  const params = new URLSearchParams({
    workspacePath: selection.path,
    workspaceEnv: selection.env.kind,
  });
  if (selection.env.kind === "wsl") {
    params.set("wslDistro", selection.env.distro);
  }
  return `index.html?${params.toString()}`;
}

function workspaceEnvKey(selection: WorkspaceSelection): string {
  return selection.env.kind === "wsl"
    ? `wsl:${selection.env.distro}`
    : "local";
}

function workspaceWindowLabel(selection: WorkspaceSelection): string {
  const hash = hashWorkspaceKey(
    `${normalizeWorkspacePath(selection.path)}|${workspaceEnvKey(selection)}`,
  );
  return `${WORKSPACE_WINDOW_PREFIX}-${hash}`;
}

async function focusExistingWindow(label: string): Promise<WebviewWindow | null> {
  try {
    const existing = await WebviewWindow.getByLabel(label);
    if (!existing) return null;
    try {
      await existing.unminimize();
    } catch {
      // Window may not be minimizable in every environment; ignore.
    }
    try {
      await existing.setFocus();
    } catch (error) {
      console.warn("Failed to focus existing workspace window", error);
    }
    return existing;
  } catch (error) {
    console.warn("Failed to look up existing workspace window", error);
    return null;
  }
}

async function readMainWindowSize(): Promise<{ width: number; height: number }> {
  const fallback = { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  try {
    const size = await getCurrentWindow().innerSize();
    if (!size || size.width <= 0 || size.height <= 0) return fallback;
    return { width: size.width, height: size.height };
  } catch (error) {
    console.warn("Failed to read main window size for new workspace window", error);
    return fallback;
  }
}

export async function openWorkspaceInNewWindow(
  selection: WorkspaceSelection,
): Promise<WebviewWindow> {
  const label = workspaceWindowLabel(selection);
  const existing = await focusExistingWindow(label);
  if (existing) return existing;

  const { width, height } = await readMainWindowSize();
  const webview = new WebviewWindow(label, {
    url: workspaceWindowUrl(selection),
    title: "Nexterm",
    width,
    height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    center: true,
    // Windows/Linux: hide system decorations, use custom title bar
    ...(IS_WINDOWS && { decorations: false, transparent: true, shadow: false }),
    ...(IS_LINUX && { decorations: false, transparent: true }),
  });

  return webview;
}
