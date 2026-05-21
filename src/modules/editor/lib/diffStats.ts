import { presentableDiff } from "@codemirror/merge";

export function computeLineStats(
  original: string,
  proposed: string,
): { added: number; removed: number } {
  const changes = presentableDiff(original, proposed);
  let added = 0;
  let removed = 0;
  for (const change of changes) {
    removed += countLines(original, change.fromA, change.toA);
    added += countLines(proposed, change.fromB, change.toB);
  }
  return { added, removed };
}

export function countPatchLines(patch: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (let index = 0; index < patch.length; index++) {
    if (index > 0 && patch.charCodeAt(index - 1) !== 10) continue;
    const marker = patch.charCodeAt(index);
    if (marker === 43 && patch.charCodeAt(index + 1) !== 43) added++;
    else if (marker === 45 && patch.charCodeAt(index + 1) !== 45) removed++;
  }
  if (patch.length > 0 && patch.charCodeAt(0) === 43) added++;
  else if (patch.length > 0 && patch.charCodeAt(0) === 45) removed++;
  return { added, removed };
}

function countLines(doc: string, from: number, to: number): number {
  if (from === to) return 0;
  const slice = doc.slice(from, to);
  let count = 1;
  for (let index = 0; index < slice.length; index++) {
    if (slice.charCodeAt(index) === 10) count++;
  }
  if (slice.endsWith("\n")) count--;
  return Math.max(count, 1);
}
