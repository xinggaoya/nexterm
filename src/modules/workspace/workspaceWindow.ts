import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { WorkspaceSelection } from "./workspaceRootPinia";

const WORKSPACE_WINDOW_PREFIX = "workspace";

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

function workspaceWindowLabel(): string {
  return `${WORKSPACE_WINDOW_PREFIX}-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function openWorkspaceInNewWindow(selection: WorkspaceSelection): WebviewWindow {
  return new WebviewWindow(workspaceWindowLabel(), {
    url: workspaceWindowUrl(selection),
    title: "Nexterm",
    width: 800,
    height: 600,
    minWidth: 420,
    minHeight: 280,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    visible: false,
  });
}
