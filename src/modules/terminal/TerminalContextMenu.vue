<script setup lang="ts">
/**
 * 终端右键菜单。
 *
 * 以前只有 Copy / Paste / Select All 三项，而且**硬编码英文**（不走 i18n，
 * zh-CN 用户看到的是英文）。现在：
 * - 文案全部走 i18n
 * - 补齐 VS Code / iTerm 都有、而 TUI AI 工具场景下最常用的动作：
 *   清屏 / 重置 / 分屏 / 新标签 / 重命名 / 字号± / 关闭分屏
 */
import { computed, h } from "vue";
import { NDropdown, type DropdownOption } from "naive-ui";
import { t } from "@/modules/i18n/translate";

const props = defineProps<{
  x: number;
  y: number;
  selection: string;
  canSplit: boolean;
  onlyPane: boolean;
  fontSize: number;
}>();

const emit = defineEmits<{
  close: [];
  copy: [];
  paste: [];
  selectAll: [];
  clear: [];
  reset: [];
  split: ["row" | "col"];
  closePane: [];
  rename: [];
  zoomIn: [];
  zoomOut: [];
}>();

// 给每个 DropdownOption 注入 data-menu-action 属性，让现有
// `[data-menu-action="..."]` 选择器（visualSystem / TerminalContextMenu
// 测试）继续命中；菜单行高、padding、键盘导航、关闭逻辑全部交给 NDropdown。
function renderOption(action: string) {
  return (option: DropdownOption) =>
    h(
      "div",
      {
        class: "nexterm-dropdown-option",
        "data-menu-action": action,
        style: "padding: 0;",
      },
      { default: () => option.label },
    );
}

const options = computed<DropdownOption[]>(() => {
  const items: DropdownOption[] = [
    {
      key: "copy",
      label: t("terminal.menuCopy"),
      disabled: !props.selection,
      render: renderOption("copy"),
    },
    {
      key: "paste",
      label: t("terminal.menuPaste"),
      render: renderOption("paste"),
    },
    {
      key: "selectAll",
      label: t("terminal.menuSelectAll"),
      render: renderOption("selectAll"),
    },
    { type: "divider", key: "d1" },
    {
      key: "clear",
      label: t("terminal.menuClear"),
      render: renderOption("clear"),
    },
    {
      key: "reset",
      label: t("terminal.menuReset"),
      render: renderOption("reset"),
    },
    { type: "divider", key: "d2" },
    {
      key: "splitRight",
      label: t("terminal.splitRight"),
      disabled: !props.canSplit,
      render: renderOption("splitRight"),
    },
    {
      key: "splitDown",
      label: t("terminal.splitDown"),
      disabled: !props.canSplit,
      render: renderOption("splitDown"),
    },
    {
      key: "rename",
      label: t("terminal.menuRename"),
      render: renderOption("rename"),
    },
    { type: "divider", key: "d3" },
    {
      key: "zoomIn",
      label: t("terminal.menuZoomIn", { size: props.fontSize }),
      render: renderOption("zoomIn"),
    },
    {
      key: "zoomOut",
      label: t("terminal.menuZoomOut", { size: props.fontSize }),
      render: renderOption("zoomOut"),
    },
    { type: "divider", key: "d4" },
    {
      // 唯一分屏时，关掉它等于关掉整个标签 —— 文案要跟着变，否则用户以为
      // 只是收起了这一块，结果整个标签没了。
      key: "closePane",
      label: props.onlyPane ? t("terminal.menuCloseTab") : t("terminal.menuClosePane"),
      render: renderOption("closePane"),
    },
  ];
  return items;
});

function handleSelect(key: string | number) {
  switch (key) {
    case "copy":
      emit("copy");
      break;
    case "paste":
      emit("paste");
      break;
    case "selectAll":
      emit("selectAll");
      break;
    case "clear":
      emit("clear");
      break;
    case "reset":
      emit("reset");
      break;
    case "splitRight":
      emit("split", "row");
      break;
    case "splitDown":
      emit("split", "col");
      break;
    case "rename":
      emit("rename");
      break;
    case "zoomIn":
      emit("zoomIn");
      break;
    case "zoomOut":
      emit("zoomOut");
      break;
    case "closePane":
      emit("closePane");
      break;
  }
  emit("close");
}
</script>

<template>
  <NDropdown
    trigger="manual"
    placement="bottom-start"
    :show="true"
    :x="x"
    :y="y"
    :options="options"
    @select="handleSelect"
    @clickoutside="emit('close')"
  >
    <span aria-hidden="true" />
  </NDropdown>
</template>
