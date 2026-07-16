export type EditorViewMode = "source" | "split" | "preview";

export type EditorPaneHandle = {
  focus: () => void;
  getSelection: () => string | null;
  getPath: () => string;
  save: () => Promise<void>;
  openGotoLine: () => void;
  reload: () => Promise<void>;
  undo: () => void;
  redo: () => void;
};

export interface EditorPaneComponent {
  save: EditorPaneHandle["save"];
  focus: EditorPaneHandle["focus"];
  getSelection: EditorPaneHandle["getSelection"];
  openGotoLine: EditorPaneHandle["openGotoLine"];
  reload: EditorPaneHandle["reload"];
  undo: EditorPaneHandle["undo"];
  redo: EditorPaneHandle["redo"];
}
