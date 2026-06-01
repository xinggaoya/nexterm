export function normalizeWorkspacePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  if (normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalizeDriveLetter(normalized);
  }
  return normalizeDriveLetter(normalized.replace(/\/+$/, ""));
}

/**
 * Normalize the Windows drive letter to uppercase while leaving the rest of
 * the path unchanged. This makes `C:/foo` and `c:/FOO` compare equal
 * (matching how Windows itself canonicalizes paths) without disturbing WSL
 * UNC paths (`//wsl.localhost/...`) or POSIX paths.
 */
function normalizeDriveLetter(path: string): string {
  if (/^[A-Za-z]:/.test(path)) {
    return path[0].toUpperCase() + path.slice(1);
  }
  return path;
}

/**
 * Single source of truth for "are these two workspace roots the same
 * directory?" — used by the FS event listener, the explorer, and the
 * source-control panel. Trims, flips backslashes to forward slashes,
 * upper-cases the Windows drive letter, and trims trailing slashes.
 */
export function isSameWorkspaceRoot(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return normalizeWorkspacePath(a) === normalizeWorkspacePath(b);
}
