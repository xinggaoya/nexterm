<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref } from "vue";
import { NDropdown, type DropdownOption } from "naive-ui";
import {
  copyToClipboard,
  relativePath,
  revealInFinder,
} from "./lib/contextActions";
import { dirname } from "./lib/fileTreeService";
import { t } from "@/modules/i18n/translate";

export type ExplorerContextMenuTarget = {
  path: string;
  name: string;
  isDir: boolean;
  x: number;
  y: number;
  source: "row" | "root";
};

const props = defineProps<{
  target: ExplorerContextMenuTarget | null;
  rootPath: string | null;
}>();

const emit = defineEmits<{
  close: [];
  openFile: [path: string, pin: boolean];
  openMarkdownPreview: [path: string];
  openInTerminal: [path: string];
  duplicate: [path: string];
  create: [parentPath: string, kind: "file" | "dir"];
  rename: [path: string];
  deletePath: [path: string];
}>();

// NDropdown 默认监听 Escape（在 trigger=manual 下由 VueUse onKeyStroke
// 处理），但测试用的 mock 不会自动触发 @clickoutside；为保持真实行为一致，
// 这里也自行监听 Escape 与 window blur，触发 close 即可让父组件卸载菜单。
function handleEscape(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}

function handleWindowBlur() {
  close();
}

onMounted(() => {
  window.addEventListener("keydown", handleEscape);
  window.addEventListener("blur", handleWindowBlur);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleEscape);
  window.removeEventListener("blur", handleWindowBlur);
});

// 渲染钩子：给每个 DropdownOption 注入 data-menu-action 属性，让现有
// `[data-menu-action="..."]` 选择器（visualSystem.test / FileExplorer 测试）继续命中。
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

// 二次确认：第一次点击把 confirmPath 切到目标 path，菜单保持打开；第二次
// 再点确认删除并关闭。
const confirmPath = ref<string | null>(null);

function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx)$/i.test(path);
}

function close() {
  confirmPath.value = null;
  emit("close");
}

function createTargetPath(target: ExplorerContextMenuTarget): string {
  return target.isDir ? target.path : dirname(target.path);
}

const menuOptions = computed<DropdownOption[]>(() => {
  const target = props.target;
  if (!target) return [];
  const opts: DropdownOption[] = [];

  if (!target.isDir) {
    opts.push({
      key: "open",
      label: t("explorer.open"),
      render: renderOption("open"),
    });
    if (isMarkdownPath(target.path)) {
      opts.push({
        key: "open-preview",
        label: t("explorer.openPreview"),
        render: renderOption("open-preview"),
      });
    }
  }

  opts.push({
    key: "reveal",
    label: t("explorer.revealInFinder"),
    render: renderOption("reveal"),
  });

  if (target.isDir) {
    opts.push({
      key: "open-in-terminal",
      label: t("explorer.openInTerminal"),
      render: renderOption("open-in-terminal"),
    });
  }

  opts.push({
    key: "duplicate",
    label: t("explorer.duplicate"),
    render: renderOption("duplicate"),
  });

  opts.push({ key: "divider-1", type: "divider" });

  opts.push({
    key: "new-file",
    label: t("explorer.newFile"),
    render: renderOption("new-file"),
  });
  opts.push({
    key: "new-folder",
    label: t("explorer.newFolder"),
    render: renderOption("new-folder"),
  });

  opts.push({ key: "divider-2", type: "divider" });

  opts.push({
    key: "copy-path",
    label: t("explorer.copyPath"),
    render: renderOption("copy-path"),
  });
  opts.push({
    key: "copy-relative-path",
    label: t("explorer.copyRelativePath"),
    render: renderOption("copy-relative-path"),
  });

  if (target.source !== "root") {
    opts.push({ key: "divider-3", type: "divider" });
    opts.push({
      key: "rename",
      label: t("explorer.rename"),
      render: renderOption("rename"),
    });
    opts.push({
      key: "delete",
      label:
        confirmPath.value === target.path
          ? t("explorer.clickAgainToConfirm")
          : t("explorer.delete"),
      render: renderOption("delete"),
    });
  }

  return opts;
});

function handleSelect(key: string | number) {
  const target = props.target;
  if (!target) return;

  switch (key) {
    case "open":
      emit("openFile", target.path, true);
      close();
      break;
    case "open-preview":
      emit("openMarkdownPreview", target.path);
      close();
      break;
    case "reveal":
      void revealInFinder(target.path);
      close();
      break;
    case "open-in-terminal":
      emit("openInTerminal", target.path);
      close();
      break;
    case "duplicate":
      emit("duplicate", target.path);
      close();
      break;
    case "new-file":
      emit("create", createTargetPath(target), "file");
      close();
      break;
    case "new-folder":
      emit("create", createTargetPath(target), "dir");
      close();
      break;
    case "copy-path":
      void copyToClipboard(target.path);
      close();
      break;
    case "copy-relative-path":
      if (!props.rootPath) return;
      void copyToClipboard(relativePath(props.rootPath, target.path));
      close();
      break;
    case "rename":
      emit("rename", target.path);
      close();
      break;
    case "delete":
      if (confirmPath.value !== target.path) {
        confirmPath.value = target.path;
        return;
      }
      emit("deletePath", target.path);
      close();
      break;
    default:
      break;
  }
}
</script>

<template>
  <NDropdown
    v-if="target"
    trigger="manual"
    placement="bottom-start"
    :show="true"
    :options="menuOptions"
    @select="handleSelect"
    @clickoutside="close"
  >
    <div
      :style="{
        position: 'fixed',
        left: target.x + 'px',
        top: target.y + 'px',
        width: '1px',
        height: '1px',
        pointerEvents: 'none',
      }"
    />
  </NDropdown>
</template>