import type { Translate } from "@/lib/types";

/**
 * Normalise an unknown thrown value into a human-readable string. Strings
 * are returned verbatim; objects exposing a `message` field fall back to
 * that; everything else is coerced via `String(error)`. Accepts an
 * optional `t` so callers that have a translator can localise the
 * fallback string without paying for a translator when one is unavailable.
 */
export function normalizeError(error: unknown, t?: Translate): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string") return message;
  }
  if (t) return t("common.errorFallback");
  return String(error);
}
