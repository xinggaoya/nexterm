// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import EditorBreadcrumb from "./EditorBreadcrumb.vue";
import type { LspDocumentSymbol } from "@/modules/lsp/types";

function symbol(
  name: string,
  startLine: number,
  endLine: number,
  children: LspDocumentSymbol[] = [],
): LspDocumentSymbol {
  return {
    name,
    kind: 12,
    range: { start: { line: startLine, character: 0 }, end: { line: endLine, character: 0 } },
    selectionRange: {
      start: { line: startLine, character: 0 },
      end: { line: startLine, character: 1 },
    },
    ...(children.length > 0 ? { children } : {}),
  };
}

const SYMBOLS: LspDocumentSymbol[] = [
  symbol("Outer", 0, 20, [symbol("Middle", 4, 12, [symbol("inner", 6, 8)])]),
  symbol("Other", 30, 40),
];

describe("EditorBreadcrumb.vue", () => {
  it("没有容器链时不渲染（不占用一行高度、也不显示空壳）", () => {
    const wrapper = mount(EditorBreadcrumb, {
      props: { fileName: "a.ts", containerPath: [], symbols: SYMBOLS },
    });
    expect(wrapper.find("[data-editor-breadcrumb]").exists()).toBe(false);
  });

  it("渲染文件名 + 容器链各层", () => {
    const wrapper = mount(EditorBreadcrumb, {
      props: {
        fileName: "a.ts",
        containerPath: ["Outer", "Middle", "inner"],
        symbols: SYMBOLS,
      },
    });
    const nav = wrapper.find("[data-editor-breadcrumb]");
    expect(nav.exists()).toBe(true);
    expect(nav.text()).toBe("a.tsOuterMiddleinner");
  });

  it("点击某层跳到该符号的定义行（1-based）", async () => {
    const wrapper = mount(EditorBreadcrumb, {
      props: {
        fileName: "a.ts",
        containerPath: ["Outer", "Middle", "inner"],
        symbols: SYMBOLS,
      },
    });
    const buttons = wrapper.findAll("button");
    // [文件名, Outer, Middle, inner]
    await buttons[3]!.trigger("click");
    expect(wrapper.emitted("go-to-symbol")).toEqual([[7]]);
    await buttons[1]!.trigger("click");
    expect(wrapper.emitted("go-to-symbol")).toEqual([[7], [1]]);
  });

  it("最后一层用前景色区分（当前所在层）", () => {
    const wrapper = mount(EditorBreadcrumb, {
      props: {
        fileName: "a.ts",
        containerPath: ["Outer", "Middle"],
        symbols: SYMBOLS,
      },
    });
    const buttons = wrapper.findAll("button");
    expect(buttons[buttons.length - 1]!.classes()).toContain("text-foreground");
  });

  it("符号树里找不到对应层时不跳（不静默跳到第 1 行）", async () => {
    const wrapper = mount(EditorBreadcrumb, {
      props: {
        fileName: "a.ts",
        containerPath: ["Outer", "Unknown"],
        // 只有一层，深度 1 无对应符号
        symbols: [symbol("Outer", 0, 20)],
      },
    });
    await wrapper.findAll("button")[2]!.trigger("click");
    expect(wrapper.emitted("go-to-symbol")).toBeUndefined();
  });

  it("点击文件名跳到第 1 行", async () => {
    const wrapper = mount(EditorBreadcrumb, {
      props: { fileName: "a.ts", containerPath: ["Outer"], symbols: SYMBOLS },
    });
    await wrapper.find("[data-breadcrumb-file]").trigger("click");
    expect(wrapper.emitted("go-to-symbol")).toEqual([[1]]);
  });
});
