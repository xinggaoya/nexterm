export const Vim = {
  defineEx: () => undefined,
  map: () => undefined,
};

export function initVimMode(): { dispose: () => void } {
  return { dispose: () => undefined };
}
