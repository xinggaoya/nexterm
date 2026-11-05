/**
 * 品牌 / 语义 Logo 解析。
 *
 * 与文件类型图标（`fileIcon.ts`）分工明确：
 * - 文件图标回答「这是什么文件」→ 编程语言 / 框架 / 文件格式；
 * - Logo 回答「这是什么技术 / 品牌」→ 语言、工具链、运行时、进程。
 *
 * 两者共用同一份 Catppuccin 图标集与同一套 data-URL 缓存，因此视觉语言一致。
 */

import { basename } from "@/lib/path";
import { buildIconDataUrl } from "./lib/iconSet";
import { fileIconUrl } from "./fileIcon";
import { languageIds as fileLanguageIds } from "./lib/fileIcons";
import { EXT_TO_LANGUAGE_ID } from "./lib/languageIds";
import { programLogos } from "./lib/programLogos";
import { shellLogos } from "./lib/shellLogos";

/** VS Code language id → Catppuccin 图标名。 */
const languageIds = fileLanguageIds as Record<string, string>;

/**
 * 按 Catppuccin 图标名取 Logo data-URL。
 *
 * 图标不存在（拼错 / 该图标集没有）时返回空串 —— 调用方据此决定是否
 * 回落到通用图形，不在这里静默塞一个通用图标。
 */
export function logoIconUrl(name: string): string {
  if (!name) return "";
  return buildIconDataUrl(name) ?? "";
}

/**
 * 语言 ID（VS Code language id，如 `rust` / `typescript`）→ 语言 Logo。
 * 语言 ID 不在映射表里时返回空串。
 */
export function languageIconUrl(languageId: string): string {
  const icon = languageIds[languageId.toLowerCase()];
  return icon ? logoIconUrl(icon) : "";
}

/**
 * 按文件路径推断语言 Logo：扩展名 → 语言 ID → 图标。
 *
 * 扩展名识别不出语言时回落到文件类型图标 —— `Dockerfile` / `Makefile` /
 * `.editorconfig` 这类按文件名命中的文件因此也能拿到具体图标。
 */
export function languageIconUrlForPath(path: string): string {
  const base = basename(path).toLowerCase();
  const dot = base.indexOf(".");
  const ext = dot > 0 && dot < base.length - 1 ? base.slice(dot + 1) : "";
  const languageId = ext ? EXT_TO_LANGUAGE_ID[ext] : undefined;
  if (languageId) {
    const url = languageIconUrl(languageId);
    if (url) return url;
  }
  return fileIconUrl(base);
}

/**
 * 程序 / 工具名 → Logo。
 *
 * 入参可以是终端 OSC 标题（`npm run dev`）、可执行文件路径
 * （`/usr/bin/vim`）或裸命令名；只取第一个 token 再取 basename。
 *
 * 识别不出时返回空串，调用方自行回落通用图形。
 */
export function programIconUrl(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "";
  // 先按“整串就是可执行文件路径”试一次（路径里可能带空格）。
  const direct = lookupProgram(basename(trimmed));
  if (direct) return direct;
  // 命令行：只取第一个 token（"npm run dev" → "npm"）。
  const first = trimmed.split(/\s+/)[0] ?? "";
  return lookupProgram(basename(first));
}

function lookupProgram(base: string): string {
  const key = base.toLowerCase().replace(/\.(exe|cmd|bat|ps1|sh)$/, "");
  const icon = programLogos[key];
  return icon ? logoIconUrl(icon) : "";
}

/**
 * Shell profile id → shell Logo。
 *
 * `shellId` 是后端 `shell_list_profiles` 的 profile id（或 `"auto"` 表示
 * 用默认顺序）。`"auto"` 只有在 Windows 上能确定（后端默认顺序是
 * pwsh → Windows PowerShell → CMD，前两者都是 PowerShell）；Unix 的
 * `"auto"` 是登录 shell，前端无从得知，故返回空串。
 *
 * 识别不出返回空串，调用方自行回落通用图形。
 */
export function shellIconUrl(
  shellId: string,
  platform: "windows" | "unix",
): string {
  const id = shellId.trim().toLowerCase();
  if (!id) return "";
  if (id === "auto") {
    return platform === "windows" ? logoIconUrl("powershell") : "";
  }
  const icon = shellLogos[id];
  return icon ? logoIconUrl(icon) : "";
}
