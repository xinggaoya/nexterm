const noopEx = () => undefined;
const noopMap = () => undefined;

const Vim = {
  defineEx: noopEx,
  map: noopMap,
};

export const VimMode: any = { Vim };

export function initVimMode(): { dispose: () => void } {
  return { dispose: () => undefined };
}
