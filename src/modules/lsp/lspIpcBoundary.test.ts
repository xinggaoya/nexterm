import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";

const SCAN_ROOTS = ["src/modules/editor", "src/modules/lsp"];

// 将平台相关分隔符统一为 POSIX 正斜杠，保证 ALLOWED_FILES 比对在 Windows 上也成立。
function toPosix(p: string): string {
  return sep === "/" ? p : p.split(sep).join("/");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...walk(p));
    } else if (st.isFile() && /\.(ts|vue)$/.test(p)) {
      out.push(toPosix(p));
    }
  }
  return out;
}

// lspTransport 是 LSP 传输层唯一的 IPC 出口，它必须直接对接 lsp_* 命令。
// 其它模块调用 LSP 必须走 native.lsp*。
const ALLOWED_FILES = new Set([
  "src/modules/lsp/lspTransport.ts",
  "src/modules/lsp/lspTransport.test.ts",
]);

describe("lsp IPC boundary", () => {
  it("forbids direct invoke of lsp_* commands outside native.ts / lspTransport", () => {
    const files = SCAN_ROOTS.flatMap((r) => walk(r));
    const offenders: Array<string> = [];
    for (const file of files) {
      if (ALLOWED_FILES.has(file)) continue;
      const text = readFileSync(file, "utf8");
      const matches = text.match(
        /invoke\(\s*["'`]lsp_(start|write|stop|list|resolve_command)/g,
      );
      if (matches) {
        offenders.push(`${file}: ${matches.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
