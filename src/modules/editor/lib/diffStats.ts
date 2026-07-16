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
