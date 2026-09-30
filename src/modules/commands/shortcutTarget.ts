/**
 * 判定"这次按键该不该被工作台命令抢走"。
 *
 * 背景：这是一个以终端为主的 IDE，用户 95% 的时间焦点在终端里，而 xterm 是用
 * 一个隐藏的 `<textarea class="xterm-helper-textarea">` 接收键盘事件的。如果
 * 把它和表单里的 `<input>` 一视同仁地当作"可编辑目标"，**所有**全局快捷键
 * （Mod+W、Ctrl+Tab、Alt+方向键、Ctrl+Shift+F、F12…）都会在终端里被放行成裸
 * 字节发给 PTY，等于快捷键系统整个失效。
 *
 * 所以要把两类"看起来都是 textarea"的目标区分开：
 *
 * | 目标 | 语义 | 命令是否抢占 |
 * |------|------|----------------|
 * | 终端的 helper textarea | 输入是给 PTY 的（交给 shell） | 取决于命令是否有绑定 |
 * | 真正的表单控件 | 输入是给 webview 的（搜索框 / 设置项 / 行内重命名） | 一律让位 |
 *
 * 终端那一侧的"取决于是否有绑定"在 `useWorkbenchCommands.canCaptureCommandShortcut`
 * 里求值（对齐 VS Code：用户显式绑了键的命令就是全局和弦）。
 */

/** 终端输入表面：xterm 的隐藏 textarea 及其所在的 `.xterm` 容器。 */
const TERMINAL_INPUT_SELECTOR = ".xterm-helper-textarea, .xterm";

/** 真正的文本录入控件：键入属于 webview，不属于任何命令。 */
const TEXT_ENTRY_SELECTOR =
  "input, textarea, select, [contenteditable='true'], [data-command-palette]";

function asElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null;
}

/**
 * 事件是否落在终端的输入表面上（xterm helper textarea 或其 `.xterm` 容器）。
 *
 * 落在终端上时，键入的归属是 PTY，工作台命令需要额外理由才能抢。
 */
export function isTerminalInputSurface(target: EventTarget | null): boolean {
  const el = asElement(target);
  return el ? !!el.closest(TERMINAL_INPUT_SELECTOR) : false;
}

/**
 * 事件是否落在真正的文本录入控件上。
 *
 * **终端的 helper textarea 不算** —— 它是一个"伪输入框"，键盘事件的真正去处
 * 是 PTY。把它排除在外是 P0 修复的核心。
 */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const el = asElement(target);
  if (!el) return false;
  if (el.closest(TERMINAL_INPUT_SELECTOR)) return false;
  return !!el.closest(TEXT_ENTRY_SELECTOR);
}
