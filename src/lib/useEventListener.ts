import { watchEffect, type WatchStopHandle } from "vue";

type EventListenerOptions =
  | boolean
  | AddEventListenerOptions
  | { passive?: boolean; once?: boolean; capture?: boolean };

/**
 * Subscribe `handler` to `target`'s `event` for the lifetime of the current
 * watcher scope. Removes the listener automatically when the watcher
 * re-runs (because `target`/`event`/`handler` changed) or when the
 * surrounding effect scope is disposed.
 *
 * `useEventListener` is a thin wrapper around `watchEffect` + an explicit
 * `addEventListener`/`removeEventListener` pair; it exists so the call
 * sites don't have to pair `onMounted`/`onUnmounted` (or any other
 * lifecycle hook) by hand and so the cleanup is impossible to forget.
 */
export function useEventListener<K extends keyof WindowEventMap>(
  target: Window,
  event: K,
  handler: (event: WindowEventMap[K]) => void,
  options?: EventListenerOptions,
): WatchStopHandle;

export function useEventListener<K extends keyof DocumentEventMap>(
  target: Document,
  event: K,
  handler: (event: DocumentEventMap[K]) => void,
  options?: EventListenerOptions,
): WatchStopHandle;

export function useEventListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  event: K,
  handler: (event: HTMLElementEventMap[K]) => void,
  options?: EventListenerOptions,
): WatchStopHandle;

export function useEventListener<K extends keyof MediaQueryListEventMap>(
  target: MediaQueryList,
  event: K,
  handler: (event: MediaQueryListEventMap[K]) => void,
): WatchStopHandle;

export function useEventListener(
  target: EventTarget,
  event: string,
  handler: (event: Event) => void,
  options?: EventListenerOptions,
): WatchStopHandle {
  return watchEffect((onCleanup) => {
    target.addEventListener(event, handler, options);
    onCleanup(() => {
      target.removeEventListener(event, handler, options);
    });
  });
}
