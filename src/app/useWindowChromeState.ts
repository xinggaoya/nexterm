import { getCurrentWindow } from "@tauri-apps/api/window";
import { onMounted, onUnmounted } from "vue";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";

export type WindowChromeWindowLike = {
  isMaximized: () => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  onResized: (handler: () => void) => Promise<() => void>;
};

export type WindowChromeStateOptions = {
  customControls?: boolean;
  hasRuntime?: () => boolean;
  getWindow?: () => WindowChromeWindowLike;
  root?: HTMLElement;
};

function setEdgeToEdge(root: HTMLElement, value: boolean) {
  if (value) {
    root.dataset.windowEdgeToEdge = "true";
    return;
  }
  delete root.dataset.windowEdgeToEdge;
}

export function useWindowChromeState(options: WindowChromeStateOptions = {}) {
  const customControls = options.customControls ?? USE_CUSTOM_WINDOW_CONTROLS;
  const runtimeAvailable = options.hasRuntime ?? hasTauriInternals;
  const getWindow =
    options.getWindow ??
    (() => getCurrentWindow() as unknown as WindowChromeWindowLike);
  const root = options.root ?? document.documentElement;
  let unlisten: (() => void) | null = null;
  let disposed = false;

  async function syncWindowState(appWindow: WindowChromeWindowLike) {
    try {
      const [maximized, fullscreen] = await Promise.all([
        appWindow.isMaximized(),
        appWindow.isFullscreen(),
      ]);
      if (!disposed) setEdgeToEdge(root, maximized || fullscreen);
    } catch (error) {
      console.warn("Failed to sync window chrome state", error);
    }
  }

  onMounted(() => {
    if (!customControls || !runtimeAvailable()) {
      setEdgeToEdge(root, false);
      return;
    }

    try {
      const appWindow = getWindow();
      void syncWindowState(appWindow);
      void appWindow
        .onResized(() => {
          void syncWindowState(appWindow);
        })
        .then((nextUnlisten) => {
          if (disposed) {
            nextUnlisten();
            return;
          }
          unlisten = nextUnlisten;
        })
        .catch((error) => {
          console.warn("Failed to listen for window chrome state changes", error);
        });
    } catch (error) {
      console.warn("Failed to start window chrome state tracking", error);
    }
  });

  onUnmounted(() => {
    disposed = true;
    unlisten?.();
    unlisten = null;
    setEdgeToEdge(root, false);
  });
}
