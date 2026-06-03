import type { Ref } from "vue";

/**
 * Function signature for the global `t(key, params?)` helper. Use this in
 * composables and stores that need to format error messages so they remain
 * decoupled from the i18n module's runtime.
 */
export type Translate = (key: string, params?: Record<string, unknown>) => string;

/**
 * Accepts a plain value or a Vue `Ref` that wraps it. Mirrors the
 * `MaybeRef` naming used by `@vueuse/core`; declared here so feature code
 * does not need to import from a third-party package.
 */
export type MaybeRef<T> = T | Ref<T>;
