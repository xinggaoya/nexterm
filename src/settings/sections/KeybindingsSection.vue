<script setup lang="ts">
import { NButton, NCard, NIcon, NInput } from "naive-ui";
import { computed, ref } from "vue";
import { AlertCircleOutline, RefreshOutline, SearchOutline } from "@vicons/ionicons5";
import {
  CORE_COMMAND_SPECS,
  buildResolvedKeybindings,
  findKeybindingConflicts,
  formatKeybinding,
  keybindingFromEvent,
  normalizeKeybinding,
  specToDefinition,
  type CommandDefinition,
  type CommandId,
} from "@/modules/commands";
import { IS_MAC } from "@/lib/platform";
import { t, tLoose } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

const prefs = usePreferencesPiniaStore();

const commandDefinitions = computed<CommandDefinition[]>(() =>
  CORE_COMMAND_SPECS.map((spec) => specToDefinition(spec, tLoose, () => {})),
);

const resolvedKeybindings = computed(() =>
  buildResolvedKeybindings(commandDefinitions.value, prefs.keybindings),
);

const conflicts = computed(() =>
  findKeybindingConflicts(commandDefinitions.value, resolvedKeybindings.value),
);

const conflictByCommandId = computed(() => {
  const map = new Map<CommandId, { keybinding: string; with: string[] }>();
  const titleOf = (id: CommandId) =>
    commandDefinitions.value.find((c) => c.id === id)?.title ?? id;
  for (const conflict of conflicts.value) {
    for (const commandId of conflict.commandIds) {
      map.set(commandId, {
        keybinding: conflict.keybinding,
        with: conflict.commandIds
          .filter((other) => other !== commandId)
          .map(titleOf),
      });
    }
  }
  return map;
});

function categoryLabel(category: string): string {
  return tLoose(`commands.categories.${category}`);
}

function displayKeybinding(commandId: CommandId): string {
  return (
    formatKeybinding(resolvedKeybindings.value[commandId], IS_MAC) ||
    t("commands.notSet")
  );
}

function hasCustomKeybinding(commandId: CommandId): boolean {
  return Object.prototype.hasOwnProperty.call(prefs.keybindings, commandId);
}

// ── 搜索 / 过滤 ────────────────────────────────────────────────────────
// 49 条命令平铺在一个列表里是没法用的：用户通常只记得"大概某个词"。
const query = ref("");
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return commandDefinitions.value;
  return commandDefinitions.value.filter((command) =>
    `${command.title} ${command.category} ${command.id}`
      .toLowerCase()
      .includes(needle),
  );
});

// ── 录制 ───────────────────────────────────────────────────────────────
/** 正在录制的命令；为 null 时不显示录制提示。 */
const recording = ref<CommandId | null>(null);
/**
 * 最近一次被拒绝的录制及其原因。
 *
 * 以前冲突只弹一句“有冲突”，既不说是哪两条、也不阻止保存 —— 用户只能猜。
 * 现在按下的键当场被拦下，并在原地说明与谁撞了。
 */
const rejected = ref<{ id: CommandId; reason: "conflict" | "bare"; with: string[] } | null>(null);

function conflictingWith(
  id: CommandId,
  keybinding: string,
): string[] {
  const normalized = normalizeKeybinding(keybinding);
  if (!normalized) return [];
  return commandDefinitions.value
    .filter(
      (command) =>
        command.id !== id &&
        resolvedKeybindings.value[command.id] === normalized,
    )
    .map((command) => command.title);
}

async function recordShortcut(commandId: CommandId, event: KeyboardEvent) {
  // Tab 被忽略是因为它负责把焦点移出录制框，而不是因为它不能当快捷键。
  if (event.key === "Tab" && !event.ctrlKey && !event.metaKey && !event.altKey) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const keybinding = keybindingFromEvent(event, IS_MAC);
  if (!keybinding) return;
  if (!event.ctrlKey && !event.metaKey && !event.altKey) {
    rejected.value = { id: commandId, reason: "bare", with: [] };
    return;
  }
  const clashes = conflictingWith(commandId, keybinding);
  if (clashes.length > 0) {
    rejected.value = { id: commandId, reason: "conflict", with: clashes };
    return;
  }
  rejected.value = null;
  recording.value = null;
  await prefs.updateCommandKeybinding(commandId, keybinding);
}

async function disableShortcut(commandId: CommandId) {
  rejected.value = null;
  recording.value = null;
  await prefs.updateCommandKeybinding(commandId, null);
}

async function restoreDefault(commandId: CommandId) {
  rejected.value = null;
  recording.value = null;
  await prefs.updateCommandKeybinding(commandId, undefined);
}

async function clearAllCustom() {
  rejected.value = null;
  recording.value = null;
  await prefs.resetCommandKeybindings();
}
</script>

<template>
  <NCard class="nexterm-settings-group" size="small" :title="t('settings.general.keyboardShortcuts')" embedded>
    <div class="space-y-2">
      <p class="text-[11px] leading-4 text-muted-foreground">
        {{ t("settings.general.keyboardShortcutsHint") }}
      </p>

      <div class="flex items-center gap-2">
        <NInput
          v-model:value="query"
          size="small"
          clearable
          :placeholder="t('commands.searchShortcuts')"
          data-keybinding-search
        >
          <template #prefix>
            <NIcon :component="SearchOutline" :size="13" class="text-muted-foreground" />
          </template>
        </NInput>
        <NButton
          size="tiny"
          quaternary
          :disabled="Object.keys(prefs.keybindings).length === 0"
          data-keybinding-clear-all
          @click="clearAllCustom"
        >
          {{ t("commands.resetAll") }}
        </NButton>
      </div>

      <div
        v-if="conflicts.length > 0"
        data-keybinding-conflicts
        class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive"
      >
        <NIcon :component="AlertCircleOutline" :size="14" class="mt-0.5 shrink-0" />
        <div class="min-w-0 space-y-0.5">
          <p class="font-medium">{{ t("commands.shortcutConflict") }}</p>
          <p v-for="conflict in conflicts" :key="conflict.keybinding">
            <code class="font-medium">{{ formatKeybinding(conflict.keybinding, IS_MAC) }}</code>
            —
            {{ t("commands.shortcutConflictDetail", {
              commands: conflict.commandIds
                .map((id) => commandDefinitions.find((c) => c.id === id)?.title ?? id)
                .join(" / "),
            }) }}
          </p>
        </div>
      </div>

      <p
        v-if="filtered.length === 0"
        class="py-4 text-center text-[11px] text-muted-foreground"
      >
        {{ t("commands.noShortcutsMatch") }}
      </p>

      <div v-else class="divide-y divide-border/60 overflow-hidden rounded-md border border-border/70">
        <div
          v-for="command in filtered"
          :key="command.id"
          :data-keybinding-row="command.id"
          class="grid grid-cols-[minmax(0,1fr)_160px_auto] items-center gap-2 px-3 py-2"
        >
          <div class="min-w-0">
            <div class="truncate text-xs font-medium text-foreground">
              {{ command.title }}
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
              <span>{{ categoryLabel(command.category) }}</span>
              <span v-if="hasCustomKeybinding(command.id)">
                {{ t("commands.custom") }}
              </span>
              <span
                v-if="conflictByCommandId.get(command.id)"
                class="text-destructive"
                :data-keybinding-conflict="command.id"
              >
                {{
                  t("commands.shortcutConflictWith", {
                    with: conflictByCommandId.get(command.id)!.with.join(" / "),
                  })
                }}
              </span>
            </div>
          </div>

          <div class="relative">
            <input
              readonly
              :value="displayKeybinding(command.id)"
              :data-keybinding-input="command.id"
              class="h-7 w-full min-w-0 rounded-md border bg-background px-2 text-center text-[11px] text-foreground outline-none transition-colors focus:border-ring"
              :class="conflictByCommandId.has(command.id) ? 'border-destructive' : 'border-border'"
              :placeholder="t('commands.notSet')"
              @focus="recording = command.id"
              @blur="recording = null"
              @keydown="recordShortcut(command.id, $event)"
            />
            <p
              v-if="rejected?.id === command.id"
              :data-keybinding-rejected="command.id"
              class="absolute right-0 top-full z-10 mt-1 w-64 rounded-md border border-destructive/30 bg-popover px-2 py-1.5 text-[10px] leading-4 text-destructive shadow-md"
            >
              {{
                rejected.reason === "conflict"
                  ? t("commands.shortcutRejectedConflict", { with: rejected.with.join(" / ") })
                  : t("commands.shortcutRejectedBare")
              }}
            </p>
          </div>

          <div class="flex items-center gap-1">
            <NButton
              size="tiny"
              secondary
              :data-keybinding-disable="command.id"
              @click="disableShortcut(command.id)"
            >
              {{ t("commands.disable") }}
            </NButton>
            <NButton
              size="tiny"
              quaternary
              :data-keybinding-reset="command.id"
              :disabled="!hasCustomKeybinding(command.id)"
              @click="restoreDefault(command.id)"
            >
              <template #icon><NIcon :component="RefreshOutline" /></template>
              {{ t("commands.default") }}
            </NButton>
          </div>
        </div>
      </div>
    </div>
  </NCard>
</template>
