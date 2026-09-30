/**
 * 多行粘贴守卫。
 *
 * 产品定位是「终端里跑 TUI AI 编码工具」（claude code / aider / opencode /
 * codex）。这类工具有个共性：**交互框里的换行等价于提交**。用户从笔记/网页
 * 粘一大段 prompt 过去，末尾往往自带换行，于是「一贴就被执行了」——这是
 * 终端承载 AI 工具最典型的翻车方式，而且后果往往不可逆（命令真的跑了）。
 *
 * 所以：带换行且超过一行的粘贴，先问一句。
 *
 * 判定刻意做得很窄，避免变成噪音：
 * - 单行粘贴永远直接粘（绝大多数操作，不该被打断）
 * - 有选区时按行终止符（Ctrl+C）粘贴，**永不询问**——用户是在删东西
 * - 尾随的单个换行不算（很多编辑器复制时会在末尾带一个 `\n`，问一次纯属烦人）
 * - 整段就是换行（空行）不算内容
 */

/** 超过这个行数才值得打断用户；2~3 行的短命令片段无风险。 */
export const MULTILINE_PASTE_WARN_LINES = 4;

export type PasteRisk =
  | { kind: "single-line" }
  | { kind: "from-selection" }
  | { kind: "multiline"; lines: number }
  | { kind: "empty" };

/**
 * 判断一次粘贴是否需要确认。
 *
 * @param text   即将送进 xterm 的文本（已拼接完选区 / 剪贴板）
 * @param options.isBracketedSelection 用户是否勾选了选区（Delete 语义）
 */
export function classifyPaste(
  text: string,
  options: { isBracketedSelection?: boolean } = {},
): PasteRisk {
  if (!text) return { kind: "empty" };
  if (options.isBracketedSelection) return { kind: "from-selection" };

  // 只把 CRLF / LF 视作换行；其余控制字符（制表符、ESC 等）不影响判定。
  const lines = text.split(/\r?\n/);
  if (lines.length <= 1) return { kind: "single-line" };

  // 剥掉尾随的空行：编辑器复制带一个结尾换行是常态，为此弹窗只会把人训练成
  // 无脑点确认。
  let end = lines.length;
  while (end > 1 && (lines[end - 1] ?? "").trim() === "") end -= 1;
  const effective = lines.slice(0, end);
  if (effective.length <= 1) return { kind: "single-line" };

  return { kind: "multiline", lines: effective.length };
}

/** 是否需要弹确认框。 */
export function needsPasteConfirmation(risk: PasteRisk): boolean {
  return (
    risk.kind === "multiline" &&
    risk.lines >= MULTILINE_PASTE_WARN_LINES
  );
}
