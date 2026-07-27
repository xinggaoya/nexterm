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
  // 保留光标位置与滚动偏移：全量 executeEdits 会把光标挤回 (1,1)，对外部
  // 变更重载场景极不友好。这里在替换前快照，替换后 clamp 到新内容范围内恢复。
  const prevSelection = editor.getSelection();
  const prevScrollTop = editor.getScrollTop();
  const prevScrollLeft = editor.getScrollLeft();
  const fullRange = model.getFullModelRange();
  editor.executeEdits("external-reload", [
    { range: fullRange, text: value, forceMoveMarkers: true },
  ]);
  if (prevSelection) {
    const lineCount = model.getLineCount();
    const lineNumber = Math.min(Math.max(prevSelection.startLineNumber, 1), lineCount);
    const maxColumn = model.getLineMaxColumn(lineNumber);
    const column = Math.min(Math.max(prevSelection.startColumn, 1), maxColumn);
    const endLineNumber = Math.min(
      Math.max(prevSelection.endLineNumber, 1),
      lineCount,
    );
    const endColumn = Math.min(
      Math.max(prevSelection.endColumn, 1),
      model.getLineMaxColumn(endLineNumber),
    );
    editor.setSelection({
      startLineNumber: lineNumber,
      startColumn: column,
      endLineNumber,
      endColumn,
    });
    editor.setScrollTop(prevScrollTop);
    editor.setScrollLeft(prevScrollLeft);
  }
}
