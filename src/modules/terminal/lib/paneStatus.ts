/**
 * 分屏向宿主上报的状态摘要。
 *
 * 单独成文件而不是塞进 `TerminalPane.vue` 的 `<script setup>`：`<script setup>`
 * 不允许 `export`，而 TerminalPane / TerminalWorkspace / Canvas / WorkspaceHost
 * / StatusDock 都要引用这个类型。
 */
import type { RendererKind } from "./rendererPipeline";
import type { SessionState } from "./sessions";

/**
 * 活动分屏的终端状态。
 *
 * `cols×rows` 尤其重要：它直接决定 TUI 工具（claude code / htop / lazygit…）的
 * 布局，而用户在画布里只占一部分窗口，没有任何地方能告诉他现在到底是多少列。
 * `renderer` 传的是**实际生效**的渲染器，不是设置里选的那个 —— WebGL 可能已经
 * 静默回退到 DOM，此时字形与抗锯齿都会变，必须让他知道。
 */
export type PaneStatus = {
  cols: number;
  rows: number;
  renderer: RendererKind;
  state: SessionState;
};
