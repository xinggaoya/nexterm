import {
  EditorSelection,
  EditorState,
  type ChangeSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";

export function mountCodeMirrorEditor(
  host: HTMLElement,
  state: EditorState,
): EditorView {
  return new EditorView({ state, parent: host });
}

export function disposeEditor(view: EditorView | null): void {
  view?.destroy();
}

/**
 * 保留光标与滚动偏移的全量替换:外部变更重载场景下,直接 dispatch 全量
 * changes 会把光标挤回文档起点。这里在替换前快照光标/滚动,替换后把位置
 * clamp 到新内容范围内恢复。
 */
export function safeReplaceValue(view: EditorView, value: string): void {
  const prevSelection = view.state.selection.main;
  const prevScrollTop = view.scrollDOM.scrollTop;
  const prevScrollLeft = view.scrollDOM.scrollLeft;
  const wasFocused = view.hasFocus;

  const clamp = (pos: number): number =>
    Math.min(Math.max(pos, 0), value.length);
  const changes: ChangeSpec = {
    from: 0,
    to: view.state.doc.length,
    insert: value,
  };
  view.dispatch({
    changes,
    selection: EditorSelection.range(
      clamp(prevSelection.from),
      clamp(prevSelection.to),
    ),
    scrollIntoView: false,
  });

  requestAnimationFrame(() => {
    view.scrollDOM.scrollTop = prevScrollTop;
    view.scrollDOM.scrollLeft = prevScrollLeft;
    if (wasFocused) view.focus();
  });
}
