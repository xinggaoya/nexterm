/**
 * POSIX-style `basename`: returns the last path segment.
 *
 * Splits on either `/` or `\` so it works for both Unix and Windows paths
 * (the front-end normalises internally but the source path coming from
 * the explorer may still carry a Windows separator). Empty inputs return
 * the original value to make the helper safe for tail-call chains.
 */
export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : path;
}
