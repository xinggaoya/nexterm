type TerminalSessionDisposer = (leafId: number) => void;

let disposer: TerminalSessionDisposer = () => {};

export function configureTerminalSessionDisposer(
  nextDisposer: TerminalSessionDisposer,
): () => void {
  disposer = nextDisposer;
  return () => {
    if (disposer === nextDisposer) disposer = () => {};
  };
}

export function disposeTerminalSession(leafId: number): void {
  disposer(leafId);
}
