type TauriLike = {
  __TAURI_INTERNALS__?: unknown;
};

export function hasTauriInternals(target: unknown = globalThis.window): boolean {
  // 非 DOM 环境（纯 Node 测试、SSR）没有 window —— 旧实现直接取
  // `window.__TAURI_INTERNALS__` 会抛 ReferenceError，调用方只想知道
  // 「有没有 Tauri 运行时」，不该因此崩掉。
  if (!target || typeof target !== "object") return false;
  const maybe = target as TauriLike;
  return (
    typeof maybe.__TAURI_INTERNALS__ === "object" &&
    maybe.__TAURI_INTERNALS__ !== null
  );
}
