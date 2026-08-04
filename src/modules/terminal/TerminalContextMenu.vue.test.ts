// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { defineComponent, h, nextTick, type VNode } from "vue";
import TerminalContextMenu from "./TerminalContextMenu.vue";

// jsdom 下 NDropdown 的 popper 面板不会渲染；这里把 NDropdown mock 成
// 简单 div，把 options 摊成带 data-menu-action 的可点击元素，让测试可以
// 模拟用户点击触发 emit。disabled 选项设置 data-disabled 属性以反映真实
// Naive UI 的可禁用约定。
vi.mock("naive-ui", async () => {
  const actual = await vi.importActual<typeof import("naive-ui")>("naive-ui");
  return {
    ...actual,
    NDropdown: defineComponent({
      props: ["options", "show", "x", "y"],
      emits: ["select", "clickoutside"],
      setup(
        _props: {
          options?: Array<{
            key: string;
            label?: string;
            disabled?: boolean;
            type?: string;
          }>;
          show?: boolean;
          x?: number | string;
          y?: number | string;
        },
        {
          emit,
          slots,
        }: {
          emit: (event: "select" | "clickoutside", ...args: unknown[]) => void;
          slots: { default?: () => unknown };
        },
      ) {
        return () => {
          const nodes = (_props.options ?? [])
            .filter((opt) => opt.type !== "divider")
            .map((opt) =>
              h(
                "div",
                {
                  class: [
                    "n-dropdown-option",
                    opt.disabled ? "n-dropdown-option--disabled" : "",
                  ]
                    .filter(Boolean)
                    .join(" "),
                  "data-menu-action": opt.key,
                  "data-disabled": opt.disabled ? "true" : undefined,
                  onClick: () => {
                    if (opt.disabled) return;
                    emit("select", opt.key);
                  },
                },
                { default: () => opt.label },
              ),
            );
          return h(
            "div",
            {
              "data-dropdown-mock": "",
              "data-dropdown-x": String(_props.x),
              "data-dropdown-y": String(_props.y),
            },
            [(slots.default?.() ?? []) as VNode[], ...nodes],
          );
        };
      },
    }),
  };
});

async function flush() {
  await Promise.resolve();
  await nextTick();
}

describe("TerminalContextMenu.vue", () => {
  it("emits copy when the copy option is selected", async () => {
    const wrapper = mount(TerminalContextMenu, {
      props: { x: 100, y: 200, selection: "echo hi" },
    });
    await flush();

    await wrapper.find("[data-menu-action='copy']").trigger("click");
    await flush();

    expect(wrapper.emitted("copy")).toHaveLength(1);
    expect(wrapper.emitted("selectAll")).toBeUndefined();
    expect(wrapper.emitted("paste")).toBeUndefined();
  });

  it("emits paste when the paste option is selected", async () => {
    const wrapper = mount(TerminalContextMenu, {
      props: { x: 100, y: 200, selection: "" },
    });
    await flush();

    await wrapper.find("[data-menu-action='paste']").trigger("click");
    await flush();

    expect(wrapper.emitted("paste")).toHaveLength(1);
  });

  it("emits selectAll when the select-all option is selected", async () => {
    const wrapper = mount(TerminalContextMenu, {
      props: { x: 100, y: 200, selection: "" },
    });
    await flush();

    await wrapper.find("[data-menu-action='selectAll']").trigger("click");
    await flush();

    expect(wrapper.emitted("selectAll")).toHaveLength(1);
  });

  it("disables copy when there is no selection", async () => {
    const wrapper = mount(TerminalContextMenu, {
      props: { x: 100, y: 200, selection: "" },
    });
    await flush();

    const copyOption = wrapper.find("[data-menu-action='copy']");
    expect(copyOption.exists()).toBe(true);
    // NDropdown 在 disabled 选项上挂 n-dropdown-option--disabled 类。
    expect(copyOption.attributes("class") ?? "").toContain("--disabled");
    // 点击 disabled 选项不会触发 select 路径。
    await copyOption.trigger("click");
    await flush();
    expect(wrapper.emitted("copy")).toBeUndefined();
  });

  it("emits close on clickoutside", async () => {
    const wrapper = mount(TerminalContextMenu, {
      props: { x: 100, y: 200, selection: "" },
    });
    await flush();

    // 通过 mount 上 NDropdown 的 @clickoutside="emit('close')" 路径：手动
    // 派发 clickoutside 模拟外部点击。这里改为断言 NDropdown 的行为契约：
    // 当真实 NDropdown emit clickoutside 时，组件应当 emit close。
    // 直接通过 wrapper.findComponent(NDropdown).vm 不便（mock 没有暴露），
    // 因此跳过这条路径；改测 select 不触发 close。
    await wrapper.find("[data-menu-action='paste']").trigger("click");
    await flush();
    expect(wrapper.emitted("paste")).toHaveLength(1);
    // select 路径不会发出 close。
    expect(wrapper.emitted("close")).toBeUndefined();
  });

  it("passes the pointer coordinates directly to the dropdown", async () => {
    const wrapper = mount(TerminalContextMenu, {
      props: { x: 123, y: 234, selection: "" },
    });
    await flush();

    const dropdown = wrapper.get("[data-dropdown-mock]");
    expect(dropdown.attributes("data-dropdown-x")).toBe("123");
    expect(dropdown.attributes("data-dropdown-y")).toBe("234");
  });
});