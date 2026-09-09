<script setup lang="ts">
import {
  AddOutline,
  FolderOutline,
  GitBranchOutline,
  OpenOutline,
  SearchOutline,
  SettingsOutline,
  TerminalOutline,
} from "@vicons/ionicons5";
import { NDropdown, NIcon, type DropdownOption } from "naive-ui";
import { computed, h, ref, watch } from "vue";
import TooltipTitle from "@/components/TooltipTitle.vue";
import { IS_WINDOWS } from "@/lib/platform";
import { hasTauriInternals } from "@/lib/tauriRuntime";
import { t } from "@/modules/i18n/translate";
import {
  LOCAL_WORKSPACE,
  type WorkspaceEnv,
  type WorkspaceInstance,
} from "@/modules/workspace";
import { useWorkspaceEnvPiniaStore } from "@/modules/workspace/workspaceEnvPinia";

export type RailToolKey = "explorer" | "sourceControl" | "tasks";

const props = defineProps<{
  workspaces: WorkspaceInstance[];
  activeWorkspaceId: string | null;
  explorerOpen: boolean;
  sourceControlOpen: boolean;
  tasksOpen: boolean;
}>();

const emit = defineEmits<{
  "select-workspace": [id: string];
  "close-workspace": [id: string];
  "add-workspace": [env: WorkspaceEnv];
  "open-workspace-in-new-window": [id: string];
  "toggle-tool": [key: RailToolKey];
  "open-settings": [];
  "open-command-palette": [];
}>();

const workspaceEnv = useWorkspaceEnvPiniaStore();

// 添加工作区菜单:本机 + WSL distro(单 distro 直出,多 distro 子菜单)+ SSH。
const showWsl = computed(() => IS_WINDOWS && workspaceEnv.distros.length > 0);
const addMenuOptions = computed<DropdownOption[]>(() => {
  const options: DropdownOption[] = [
    { key: "local", label: t("app.workspaceBar.addLocal") },
  ];
  if (showWsl.value) {
    const distros = workspaceEnv.distros;
    if (distros.length === 1) {
      options.push({
        key: `wsl:${distros[0]?.name ?? ""}`,
        label: `${t("app.workspaceBar.addWsl")} · ${distros[0]?.name ?? ""}`,
      });
    } else {
      options.push({
        key: "wsl",
        label: t("app.workspaceBar.addWsl"),
        children: distros.map((distro) => ({
          key: `wsl:${distro.name}`,
          label: distro.name,
        })),
      });
    }
  }
  options.push({ key: "ssh", label: t("app.workspaceBar.addSsh") });
  return options;
});

function handleAddSelect(key: string | number) {
  const value = String(key);
  if (value === "local") {
    emit("add-workspace", LOCAL_WORKSPACE);
    return;
  }
  if (value === "ssh") {
    emit("add-workspace", { kind: "ssh", profileId: "new" });
    return;
  }
  if (value.startsWith("wsl:")) {
    const distro = value.slice(4);
    if (distro) emit("add-workspace", { kind: "wsl", distro });
  }
}

// Rail 是常驻 UI,挂载即刷新 WSL distro 列表(失败静默)。
watch(
  () => IS_WINDOWS && hasTauriInternals(),
  (needed) => {
    if (needed) void workspaceEnv.refreshDistros();
  },
  { immediate: true },
);

function monogramOf(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

type EnvBadge = "wsl" | "ssh" | null;

function envBadgeOf(workspace: WorkspaceInstance): EnvBadge {
  if (workspace.env.kind === "wsl") return "wsl";
  if (workspace.env.kind === "ssh") return "ssh";
  return null;
}

function chipTitle(workspace: WorkspaceInstance): string {
  const envLabel =
    workspace.env.kind === "wsl"
      ? `WSL · ${workspace.env.distro}`
      : workspace.env.kind === "ssh"
        ? "SSH"
        : t("app.rail.envLocal");
  return `${workspace.name}\n${workspace.rootPath}\n${envLabel}`;
}

// ── 工作区芯片右键菜单 ──────────────────────────────────────────────────
const chipMenu = ref<{ x: number; y: number; id: string } | null>(null);
const chipMenuOptions = computed<DropdownOption[]>(() => [
  {
    key: "new-window",
    label: t("app.rail.openInNewWindow"),
    icon: () => h(NIcon, { component: OpenOutline, size: 13 }),
  },
  { key: "close", label: t("app.rail.closeWorkspace") },
]);

function handleChipContextMenu(event: MouseEvent, workspace: WorkspaceInstance) {
  event.preventDefault();
  chipMenu.value = { x: event.clientX, y: event.clientY, id: workspace.id };
}

function handleChipMenuSelect(key: string | number) {
  const id = chipMenu.value?.id;
  chipMenu.value = null;
  if (!id) return;
  if (key === "new-window") emit("open-workspace-in-new-window", id);
  if (key === "close") emit("close-workspace", id);
}

const tools = computed(() => [
  {
    key: "explorer" as RailToolKey,
    icon: FolderOutline,
    label: t("app.rail.tool.explorer"),
    active: props.explorerOpen,
  },
  {
    key: "sourceControl" as RailToolKey,
    icon: GitBranchOutline,
    label: t("app.rail.tool.sourceControl"),
    active: props.sourceControlOpen,
  },
  {
    key: "tasks" as RailToolKey,
    icon: TerminalOutline,
    label: t("app.rail.tool.tasks"),
    active: props.tasksOpen,
  },
]);
</script>

<template>
  <nav
    class="flex h-full w-[52px] shrink-0 flex-col items-center border-r border-border bg-activity-bar py-2"
    data-workspace-rail
    aria-label="Workspace rail"
  >
    <!-- 工作区芯片 -->
    <div class="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto no-scrollbar pt-1">
      <TooltipTitle
        v-for="workspace in workspaces"
        :key="workspace.id"
        :label="chipTitle(workspace)"
      >
        <button
          type="button"
          :data-workspace-chip="workspace.id"
          :aria-pressed="workspace.id === activeWorkspaceId"
          :title="chipTitle(workspace)"
          class="relative grid size-9 shrink-0 place-items-center rounded-xl text-[13px] font-semibold transition-all duration-[var(--dur-fast)]"
          :class="
            workspace.id === activeWorkspaceId
              ? 'bg-primary text-primary-foreground shadow-[0_0_0_1px_var(--border)]'
              : 'bg-surface-hover text-muted-foreground hover:text-foreground'
          "
          @click="emit('select-workspace', workspace.id)"
          @contextmenu="handleChipContextMenu($event, workspace)"
          @auxclick.middle.prevent="emit('close-workspace', workspace.id)"
        >
          {{ monogramOf(workspace.name) }}
          <span
            v-if="envBadgeOf(workspace)"
            class="absolute -bottom-0.5 -right-0.5 size-2 rounded-full border border-activity-bar"
            :class="envBadgeOf(workspace) === 'wsl' ? 'bg-info' : 'bg-warning'"
          />
        </button>
      </TooltipTitle>

      <!-- 添加工作区 -->
      <NDropdown
        trigger="click"
        placement="right-start"
        :options="addMenuOptions"
        @select="handleAddSelect"
      >
        <button
          type="button"
          data-add-workspace
          :title="t('app.rail.addWorkspace')"
          :aria-label="t('app.rail.addWorkspace')"
          class="grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
        >
          <NIcon :component="AddOutline" :size="16" />
        </button>
      </NDropdown>
    </div>

    <div class="v2-hairline my-2 h-px w-7 border-t" />

    <!-- 工具浮层切换 -->
    <div class="flex shrink-0 flex-col items-center gap-1">
      <TooltipTitle
        v-for="tool in tools"
        :key="tool.key"
        :label="tool.label"
      >
        <button
          type="button"
          :data-toggle-tool="tool.key"
          :aria-pressed="tool.active"
          :title="tool.label"
          class="relative grid size-9 place-items-center rounded-xl transition-colors duration-[var(--dur-fast)]"
          :class="
            tool.active
              ? 'bg-accent text-primary'
              : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
          "
          @click="emit('toggle-tool', tool.key)"
        >
          <NIcon :component="tool.icon" :size="16" />
          <span
            v-if="tool.active"
            class="absolute -left-2 h-4 w-0.5 rounded-full bg-primary"
          />
        </button>
      </TooltipTitle>

      <div class="v2-hairline my-1.5 h-px w-7 border-t" />

      <TooltipTitle :label="t('app.header.openCommandCenter')">
        <button
          type="button"
          data-open-command-palette
          :title="t('app.header.openCommandCenter')"
          :aria-label="t('app.header.openCommandCenter')"
          class="grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
          @click="emit('open-command-palette')"
        >
          <NIcon :component="SearchOutline" :size="15" />
        </button>
      </TooltipTitle>

      <TooltipTitle :label="t('common.settings')">
        <button
          type="button"
          data-open-settings
          :title="t('common.settings')"
          :aria-label="t('common.settings')"
          class="grid size-9 place-items-center rounded-xl text-muted-foreground transition-colors duration-[var(--dur-fast)] hover:bg-surface-hover hover:text-foreground"
          @click="emit('open-settings')"
        >
          <NIcon :component="SettingsOutline" :size="15" />
        </button>
      </TooltipTitle>
    </div>

    <!-- 工作区芯片右键菜单 -->
    <NDropdown
      trigger="manual"
      :show="chipMenu !== null"
      :x="chipMenu?.x ?? 0"
      :y="chipMenu?.y ?? 0"
      placement="bottom-start"
      :options="chipMenuOptions"
      @clickoutside="chipMenu = null"
      @select="handleChipMenuSelect"
    />
  </nav>
</template>
