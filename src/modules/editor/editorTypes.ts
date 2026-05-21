export type EditorPaneHandle = {
  setQuery: (query: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearQuery: () => void;
  focus: () => void;
  getSelection: () => string | null;
  getPath: () => string;
  reload: () => boolean;
  undo: () => void;
  redo: () => void;
};
