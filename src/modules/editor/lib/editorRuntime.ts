import * as monaco from "monaco-editor";

export type EditorMount = {
  editor: monaco.editor.IStandaloneCodeEditor;
  disposables: monaco.IDisposable[];
};

export function mountMonacoEditor(
  host: HTMLElement,
  options: monaco.editor.IStandaloneEditorConstructionOptions,
  value: string,
): EditorMount {
  host.innerHTML = "";
  const editor = monaco.editor.create(host, options);
  editor.setValue(value);
  const disposables: monaco.IDisposable[] = [];
  return { editor, disposables };
}

export function disposeEditor(mount: EditorMount | null): void {
  if (!mount) return;
  for (const d of mount.disposables) d.dispose();
  mount.editor.getModel()?.dispose();
  mount.editor.dispose();
}

export function safeReplaceValue(
  editor: monaco.editor.IStandaloneCodeEditor,
  value: string,
): void {
  const model = editor.getModel();
  if (!model) {
    editor.setValue(value);
    return;
  }
  const fullRange = model.getFullModelRange();
  editor.executeEdits("external-reload", [
    { range: fullRange, text: value, forceMoveMarkers: true },
  ]);
}
