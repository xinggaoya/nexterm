/**
 * A frozen empty object literal that doubles as the default value for
 * record-shaped Pinia state (keybindings, recent workspaces, etc.) and as a
 * shared "no overrides" placeholder for default parameters.
 *
 * Using a shared reference avoids per-store `Object.freeze({})` allocations
 * and gives TypeScript a single, narrowly-typed empty object that is
 * assignable to `Record<string, never>` consumers.
 */
export const EMPTY_OBJECT: Readonly<Record<string, never>> = Object.freeze({});
