import type { Ref } from "vue";

/**
 * Read-only reactive reference. Use this in composables and stores that
 * expose a value to consumers without permitting reassignment. Mirrors
 * `Readonly<Ref<T>>` to give a self-documenting name.
 */
export type ReadonlyRef<T> = Readonly<Ref<T>>;

/**
 * Accepts a plain value or a Vue `Ref` that wraps it. Mirrors the
 * `MaybeRef` naming used by `@vueuse/core`; declared here so feature code
 * does not need to import from a third-party package.
 */
export type MaybeRef<T> = T | Ref<T>;
