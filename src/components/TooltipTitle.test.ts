// @vitest-environment jsdom
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TooltipTitle from "./TooltipTitle.vue";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

const tooltipPropsRef: { current: Array<Record<string, unknown>> } = {
  current: [],
};

vi.mock("naive-ui", () => ({
  NTooltip: {
    name: "NTooltip",
    props: ["placement", "trigger", "disabled"],
    setup(props: Record<string, unknown>) {
      tooltipPropsRef.current.push({ ...props });
      return () => null;
    },
    beforeUnmount() {
      tooltipPropsRef.current.pop();
    },
  },
}));

function findTooltipDisabled(): boolean | undefined {
  const list = tooltipPropsRef.current;
  return list[list.length - 1]?.disabled as boolean | undefined;
}

describe("TooltipTitle.vue", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    tooltipPropsRef.current.length = 0;
  });

  it("enables the tooltip when touch optimizations are off and label is set", () => {
    const prefs = usePreferencesPiniaStore();
    prefs.touchOptimizations = "off";

    mount(TooltipTitle, {
      props: { label: "Hint" },
      slots: { default: "<button />" },
    });

    expect(findTooltipDisabled()).toBe(false);
  });

  it("disables the tooltip when touch optimizations force touch mode on", () => {
    const prefs = usePreferencesPiniaStore();
    prefs.touchOptimizations = "on";

    mount(TooltipTitle, {
      props: { label: "Hint" },
      slots: { default: "<button />" },
    });

    expect(findTooltipDisabled()).toBe(true);
  });

  it("keeps the tooltip disabled when its disabled prop is true", () => {
    const prefs = usePreferencesPiniaStore();
    prefs.touchOptimizations = "off";

    mount(TooltipTitle, {
      props: { label: "Hint", disabled: true },
      slots: { default: "<button />" },
    });

    expect(findTooltipDisabled()).toBe(true);
  });
});
