import { describe, expect, it } from "vitest";
import { useFileClipboard } from "./fileClipboard";

describe("useFileClipboard", () => {
  it("初始为空，isEmpty 为 true", () => {
    const clipboard = useFileClipboard();
    expect(clipboard.state.value).toEqual({ mode: null, paths: [] });
    expect(clipboard.isEmpty.value).toBe(true);
    expect(clipboard.isCut.value).toBe(false);
  });

  it("复制多选路径", () => {
    const clipboard = useFileClipboard();
    clipboard.setCopy(["/repo/a.ts", "/repo/b.ts"]);
    expect(clipboard.state.value).toEqual({
      mode: "copy",
      paths: ["/repo/a.ts", "/repo/b.ts"],
    });
    expect(clipboard.isEmpty.value).toBe(false);
    expect(clipboard.isCut.value).toBe(false);
  });

  it("剪切标记 isCut", () => {
    const clipboard = useFileClipboard();
    clipboard.setCut(["/repo/a.ts"]);
    expect(clipboard.state.value.mode).toBe("cut");
    expect(clipboard.isCut.value).toBe(true);
  });

  it("复制入参是快照：后续修改原数组不影响剪贴板", () => {
    const clipboard = useFileClipboard();
    const paths = ["/repo/a.ts"];
    clipboard.setCopy(paths);
    paths.push("/repo/b.ts");
    expect(clipboard.state.value.paths).toEqual(["/repo/a.ts"]);
  });

  it("零项时清空而不是存空壳（粘贴必失败的操作不该出现）", () => {
    const clipboard = useFileClipboard();
    clipboard.setCopy(["/repo/a.ts"]);
    clipboard.setCopy([]);
    expect(clipboard.state.value).toEqual({ mode: null, paths: [] });
    expect(clipboard.isEmpty.value).toBe(true);
  });

  it("剪切后粘贴成功会被 clear（剪切是一次性的）", () => {
    const clipboard = useFileClipboard();
    clipboard.setCut(["/repo/a.ts"]);
    clipboard.clear();
    expect(clipboard.isEmpty.value).toBe(true);
  });

  it("复制可以重复粘贴，不因一次粘贴而失效", () => {
    const clipboard = useFileClipboard();
    clipboard.setCopy(["/repo/a.ts"]);
    // 复制语义下不应自动清空：同一个文件要能贴到多个目录。
    expect(clipboard.state.value.paths).toEqual(["/repo/a.ts"]);
  });

  it("每次调用返回独立实例（按工作区隔离）", () => {
    const a = useFileClipboard();
    const b = useFileClipboard();
    a.setCopy(["/repo/a.ts"]);
    expect(a.isEmpty.value).toBe(false);
    expect(b.isEmpty.value).toBe(true);
  });

  it("后一次动作覆盖前一次", () => {
    const clipboard = useFileClipboard();
    clipboard.setCopy(["/repo/a.ts"]);
    clipboard.setCut(["/repo/b.ts"]);
    expect(clipboard.state.value).toEqual({
      mode: "cut",
      paths: ["/repo/b.ts"],
    });
  });
});
