/**
 * 极简 CodeMirror 6 测试桩:在 jsdom 中不实例化真实 EditorView,
 * 只维护 doc 字符串与 selection,并把 updateListener 分发给组件。
 * 仅供 vi.mock("@codemirror/*") 工厂引用,不要在业务代码中使用。
 */

export class FakeText {
  content: string;
  constructor(doc: string) {
    this.content = doc;
  }
  get length(): number {
    return this.content.length;
  }
  toString(): string {
    return this.content;
  }
  get lines(): number {
    return this.content.split("\n").length;
  }
  line(n: number): { number: number; from: number; to: number; text: string } {
    const ls = this.content.split("\n");
    const text = ls[n - 1] ?? "";
    const from = ls.slice(0, n - 1).reduce((acc, l) => acc + l.length + 1, 0);
    return { number: n, from, to: from + text.length, text };
  }
  lineAt(pos: number): { number: number; from: number; to: number } {
    const upto = this.content.slice(0, pos);
    const nl = upto.split("\n");
    const number = nl.length;
    const lineText = nl[nl.length - 1] ?? "";
    const from = pos - lineText.length;
    return { number, from, to: from + lineText.length };
  }
  slice(from: number, to: number): string {
    return this.content.slice(from, to);
  }
}

type Listener = (update: unknown) => void;

/** 从(嵌套的)extensions 数组里收集 updateListener 回调。 */
export function collectListeners(exts: unknown, out: Listener[] = []): Listener[] {
  if (Array.isArray(exts)) {
    for (const e of exts) collectListeners(e, out);
    return out;
  }
  if (exts && typeof exts === "object") {
    const ext = exts as Record<string, unknown>;
    if (typeof ext.__updateListener === "function") out.push(ext.__updateListener as Listener);
    if (ext.value !== undefined) collectListeners(ext.value, out);
  }
  return out;
}

export class EditorState {
  static tabSize = { of: () => [] };
  static readOnly = { of: () => [] };
  doc: FakeText;
  extensions: unknown;
  selection: { main: { from: number; to: number; head: number } };
  constructor(doc: string | FakeText, extensions: unknown) {
    this.doc = doc instanceof FakeText ? doc : new FakeText(doc);
    this.extensions = extensions;
    this.selection = { main: { from: 0, to: 0, head: 0 } };
  }
  static create({
    doc,
    extensions,
  }: {
    doc: string;
    extensions: unknown;
  }): EditorState {
    return new EditorState(doc, extensions);
  }
  sliceDoc(from: number, to: number): string {
    return this.doc.slice(from, to);
  }
  facet(): unknown[] {
    return [];
  }
}

export const EditorSelection = {
  range: (from: number, to: number) => ({ from, to, head: to }),
  single: (pos: number) => ({ from: pos, to: pos, head: pos }),
  cursor: (pos: number) => ({ from: pos, to: pos, head: pos }),
};

export class Compartment {
  of(value: unknown) {
    return { compartment: this, value };
  }
  reconfigure(value: unknown) {
    return { compartment: this, value };
  }
}

/** 与 view 桩配套的 EditorView:dispatch 时更新 doc 并触发 listeners。 */
export class EditorView {
  static theme = () => [] as unknown[];
  static updateListener = {
    of: (cb: Listener) => ({ __updateListener: cb }),
  };
  static lineWrapping: unknown[] = [];
  static editable = { of: () => [] };
  static contentAttributes = { of: () => [] };

  static instances = new Set<EditorView>();

  state: EditorState;
  hasFocus = false;
  scrollDOM = { scrollTop: 0, scrollLeft: 0 };
  #listeners: Listener[];

  constructor(config: { state: EditorState; parent?: unknown }) {
    this.state = config.state;
    this.#listeners = collectListeners(config.state.extensions);
    EditorView.instances.add(this);
  }

  dispatch(spec: {
    changes?: { from?: number; to?: number; insert?: string };
    selection?: { from: number; to: number; anchor?: number };
    effects?: unknown;
    scrollIntoView?: boolean;
  }): void {
    if (spec.changes) {
      const { from = 0, to, insert = "" } = spec.changes;
      const doc = this.state.doc;
      const end = to ?? doc.content.length;
      doc.content =
        doc.content.slice(0, from) + insert + doc.content.slice(end);
    }
    if (spec.selection) {
      const sel = spec.selection;
      if (sel.anchor !== undefined) {
        this.state.selection = { main: { from: sel.anchor, to: sel.anchor, head: sel.anchor } };
      } else {
        this.state.selection = { main: { from: sel.from, to: sel.to, head: sel.to } };
      }
    }
    if (spec.changes || spec.selection) {
      const update = {
        docChanged: !!spec.changes,
        selectionSet: !!spec.selection,
        state: this.state,
      };
      for (const cb of this.#listeners) cb(update);
    }
  }

  focus(): void {
    this.hasFocus = true;
  }
  requestMeasure(): void {}
  destroy(): void {
    EditorView.instances.delete(this);
  }
}

export const views = EditorView.instances;

export const keymap = { of: () => [] };
export const lineNumbers = () => [];
export const highlightActiveLine = () => [];
export const highlightActiveLineGutter = () => [];
export const drawSelection = () => [];
export const rectangularSelection = () => [];
export const crosshairCursor = () => [];
export const dropCursor = () => [];
export const ViewPlugin = {
  define: (create: unknown) => ({ __viewPlugin: create }),
};
export const ViewUpdate = {};
