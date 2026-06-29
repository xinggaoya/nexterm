import type { Ref } from "vue";

/**
 * Read-only reactive reference. Use this in composables and stores that
 * expose a value to consumers without permitting reassignment. Mirrors
 * `Readonly<Ref<T>>` to give a self-documenting name.
 */
export type ReadonlyRef<T> = Readonly<Ref<T>>;
