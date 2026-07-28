<script setup lang="ts">
import { computed, h } from "vue";
import { NDropdown, type DropdownOption } from "naive-ui";

const props = defineProps<{
  x: number;
  y: number;
  selection: string;
}>();

const emit = defineEmits<{
  close: [];
  copy: [];
  paste: [];
  selectAll: [];
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

const options = computed<DropdownOption[]>(() => [
  {
    key: "copy",
    label: "Copy",
    disabled: !props.selection,
    render: renderOption("copy"),
  },
  {
    key: "paste",
    label: "Paste",
    render: renderOption("paste"),
  },
  {
    key: "selectAll",
    label: "Select All",
    render: renderOption("selectAll"),
  },
]);

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
  }
}
</script>

<template>
  <NDropdown
    trigger="manual"
    placement="bottom-start"
    :show="true"
    :options="options"
    @select="handleSelect"
    @clickoutside="emit('close')"
  >
    <div
      :style="{
        position: 'fixed',
        left: x + 'px',
        top: y + 'px',
        width: '1px',
        height: '1px',
        pointerEvents: 'none',
      }"
    />
  </NDropdown>
</template>