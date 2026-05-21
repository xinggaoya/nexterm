type TauriLike = {
  __TAURI_INTERNALS__?: unknown;
};

export function hasTauriInternals(target: unknown = window): boolean {
  const maybe = target as TauriLike;
  return (
    typeof maybe.__TAURI_INTERNALS__ === "object" &&
    maybe.__TAURI_INTERNALS__ !== null
  );
}
