// Stub module simulating monaco-editor API surface for vitest/jsdom.
export const fakeEditor = {
  _value: "",
  getValue() {
    return this._value;
  },
  setValue(v: string) {
    this._value = v;
  },
  getModel() {
    return {
      getValue: () => this._value,
      getValueLengthInRange: () => 0,
      getLineCount: () => 1,
      getFullModelRange: () => ({
        startLineNumber: 1,
        endLineNumber: 1,
        startColumn: 1,
        endColumn: 1,
      }),
      dispose: () => undefined,
    };
  },
  getSelection: () => ({ isEmpty: () => true }),
  onDidChangeModelContent: () => ({ dispose: () => undefined }),
  onDidChangeCursorPosition: () => ({ dispose: () => undefined }),
  trigger: () => undefined,
  focus: () => undefined,
  layout: () => undefined,
  setPosition: () => undefined,
  revealLine: () => undefined,
};

export const editor = {
  create: () => fakeEditor,
  createDiffEditor: () => ({}),
  createModel: () => ({}),
  setTheme: () => undefined,
  defineTheme: () => undefined,
};

export const languages = {
  register: () => undefined,
};

export default { editor, languages };
