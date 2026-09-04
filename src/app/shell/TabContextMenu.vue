<script setup lang="ts">
import { computed, h, inject } from "vue";
import { NDropdown, type DropdownOption } from "naive-ui";
import type { Tab } from "@/modules/tabs/tabsTypes";
import { t } from "@/modules/i18n/translate";
import { WORKSPACE_CONTEXT_KEY } from "@/app/workspaceContext";

export type TabContextMenuTarget = {
  tab: Tab;
  x: number;
  y: number;
  index: number;
  total: number;
};

const props = defineProps<{ target: TabContextMenuTarget | null }>();
const emit = defineEmits<{
  close: [];
  closeTab: [id: number];
  closeOthers: [id: number];
  closeToRight: [id: number];
  closeAll: [];
  duplicateTerminal: [tabId: number];
  renameTab: [tabId: number, title: string];
  pinEditor: [tabId: number];
  copyPath: [path: string];
  copyRelativePath: [rootPath: string, path: string];
  moveToNewWindow: [tabId: number];
  requestRename: [tabId: number];
}>();

const workspaceCtx = inject(WORKSPACE_CONTEXT_KEY, null);
const rootPath = computed(() => workspaceCtx?.workspace.rootPath ?? null);

function isPathTab(tab: Tab): tab is Extract<Tab, { path: string }> {
  return "path" in tab && typeof (tab as { path?: unknown }).path === "string";
}
function pathFor(tab: Tab): string | null {
  if (tab.kind === "terminal") return tab.cwd ?? null;
  if (isPathTab(tab)) return tab.path;
  return null;
}

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

function menuOption(key: string, label: string): DropdownOption {
  return { key, label, render: renderOption(key) };
}

function divider(key: string): DropdownOption {
  return { key, type: "divider" };
}

const options = computed<DropdownOption[]>(() => {
  const target = props.target;
  if (!target) return [];

  const items: DropdownOption[] = [
    menuOption("close", t("tabMenu.close")),
  ];
  if (target.total > 1) {
    items.push(menuOption("close-others", t("tabMenu.closeOthers")));
  }
  if (target.index < target.total - 1) {
    items.push(menuOption("close-right", t("tabMenu.closeRight")));
  }
  if (target.total > 1) {
    items.push(menuOption("close-all", t("tabMenu.closeAll")));
  }

  const typeItems: DropdownOption[] = [];
  if (target.tab.kind === "terminal") {
    typeItems.push(
      menuOption("duplicate", t("tabMenu.duplicate")),
      menuOption("rename", t("tabMenu.rename")),
    );
  } else if (
    target.tab.kind === "editor" ||
    target.tab.kind === "markdown" ||
    target.tab.kind === "file-preview" ||
    target.tab.kind === "preview"
  ) {
    if (target.tab.kind === "editor") {
      typeItems.push(
        menuOption(
          "pin",
          target.tab.preview ? t("tabMenu.pin") : t("tabMenu.unpin"),
        ),
      );
    }
    typeItems.push(
      menuOption("move-to-new-window", t("tabMenu.moveToNewWindow")),
    );
  }
  if (typeItems.length > 0) {
    items.push(divider("type-divider"), ...typeItems);
  }

  const path = pathFor(target.tab);
  if (path) {
    const pathItems: DropdownOption[] = [
      menuOption("copy-path", t("tabMenu.copyPath")),
    ];
    if (rootPath.value && path.startsWith(`${rootPath.value}/`)) {
      pathItems.push(
        menuOption("copy-relative-path", t("tabMenu.copyRelativePath")),
      );
    }
    items.push(divider("path-divider"), ...pathItems);
  }

  return items;
});

function handleSelect(key: string | number) {
  const target = props.target;
  if (!target || typeof key !== "string") return;

  switch (key) {
    case "close":
      emit("closeTab", target.tab.id);
      break;
    case "close-others":
      emit("closeOthers", target.tab.id);
      break;
    case "close-right":
      emit("closeToRight", target.tab.id);
      break;
    case "close-all":
      emit("closeAll");
      break;
    case "duplicate":
      emit("duplicateTerminal", target.tab.id);
      break;
    case "rename":
      emit("requestRename", target.tab.id);
      break;
    case "pin":
      emit("pinEditor", target.tab.id);
      break;
    case "move-to-new-window":
      emit("moveToNewWindow", target.tab.id);
      break;
    case "copy-path": {
      const path = pathFor(target.tab);
      if (path) emit("copyPath", path);
      break;
    }
    case "copy-relative-path": {
      const path = pathFor(target.tab);
      if (path && rootPath.value) {
        emit("copyRelativePath", rootPath.value, path);
      }
      break;
    }
  }

  emit("close");
}
</script>

<template>
  <NDropdown
    v-if="target"
    trigger="manual"
    placement="bottom-start"
    :show="true"
    :x="target.x"
    :y="target.y"
    :options="options"
    @select="handleSelect"
    @clickoutside="emit('close')"
  >
    <span aria-hidden="true" />
  </NDropdown>
</template>
