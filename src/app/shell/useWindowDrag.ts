import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Shared window-drag handler for the new shell chrome (TopBar filler areas,
 * SessionStrip trailing blank). Same contract as the old TitleBar: only a
 * primary pointerdown that lands on the element itself starts a native drag,
 * so clicks on nested interactive children are never swallowed.
 */
export async function startWindowDrag(event: PointerEvent): Promise<void> {
  if (event.button !== 0) return;
  if (event.target !== event.currentTarget) return;
  event.preventDefault();
  event.stopPropagation();
  try {
    await getCurrentWindow().startDragging();
  } catch {
    // Browser-only dev/test context
  }
}
