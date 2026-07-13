type LeafId = string | number;
type TerminalSessionDisposer = (leafId: LeafId) => void;

let disposer: TerminalSessionDisposer = () => {};

export function configureTerminalSessionDisposer(
  nextDisposer: TerminalSessionDisposer,
): () => void {
  disposer = nextDisposer;
  return () => {
    if (disposer === nextDisposer) disposer = () => {};
  };
}

export function disposeTerminalSession(leafId: LeafId): void {
  disposer(leafId);
}
