<script setup lang="ts">
import { NButton, NCard, NIcon } from "naive-ui";
import { computed } from "vue";
import { AlertCircleOutline, RefreshOutline } from "@vicons/ionicons5";
import {
  CORE_COMMAND_SPECS,
  buildResolvedKeybindings,
  findKeybindingConflicts,
  formatKeybinding,
  keybindingFromEvent,
  type CommandDefinition,
  type CommandId,
} from "@/modules/commands";
import { IS_MAC } from "@/lib/platform";
import { t, tLoose } from "@/modules/i18n/translate";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

const prefs = usePreferencesPiniaStore();

const commandDefinitions = computed<CommandDefinition[]>(() =>
  CORE_COMMAND_SPECS.map((spec) => ({
    id: spec.id,
    title: tLoose(spec.titleKey),
    category: spec.category,
    defaultKeybinding: spec.defaultKeybinding,
    when: spec.workspaceRequired ? (context) => context.workspaceReady : undefined,
    run: () => {},
  })),
);

const resolvedKeybindings = computed(() =>
  buildResolvedKeybindings(commandDefinitions.value, prefs.keybindings),
);

const conflicts = computed(() =>
  findKeybindingConflicts(commandDefinitions.value, resolvedKeybindings.value),
);

const conflictByCommandId = computed(() => {
  const map = new Map<CommandId, string>();
  for (const conflict of conflicts.value) {
    for (const commandId of conflict.commandIds) {
      map.set(commandId, conflict.keybinding);
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

async function recordShortcut(commandId: CommandId, event: KeyboardEvent) {
  if (event.key === "Tab") return;
  event.preventDefault();
  event.stopPropagation();
  const keybinding = keybindingFromEvent(event, IS_MAC);
  if (!keybinding) return;
  await prefs.updateCommandKeybinding(commandId, keybinding);
}

async function disableShortcut(commandId: CommandId) {
  await prefs.updateCommandKeybinding(commandId, null);
}

async function restoreDefault(commandId: CommandId) {
  await prefs.updateCommandKeybinding(commandId, undefined);
}
</script>

<template>
  <NCard class="nexterm-settings-group" size="small" :title="t('settings.general.keyboardShortcuts')" embedded>
    <div class="space-y-2">
      <p class="text-[11px] leading-4 text-muted-foreground">
        {{ t("settings.general.keyboardShortcutsHint") }}
      </p>

      <div
        v-if="conflicts.length > 0"
        class="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-2 text-[11px] text-destructive"
      >
        <NIcon :component="AlertCircleOutline" :size="14" class="mt-0.5 shrink-0" />
        <span>{{ t("commands.shortcutConflict") }}</span>
      </div>

      <div class="divide-y divide-border/60 overflow-hidden rounded-md border border-border/70">
        <div
          v-for="command in commandDefinitions"
          :key="command.id"
          :data-keybinding-row="command.id"
          class="grid grid-cols-[minmax(0,1fr)_160px_auto] items-center gap-2 px-3 py-2"
        >
          <div class="min-w-0">
            <div class="truncate text-xs font-medium text-foreground">
              {{ command.title }}
            </div>
            <div class="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{{ categoryLabel(command.category) }}</span>
              <span v-if="hasCustomKeybinding(command.id)">
                {{ t("commands.custom") }}
              </span>
              <span v-if="conflictByCommandId.has(command.id)" class="text-destructive">
                {{ t("commands.shortcutConflict") }}
              </span>
            </div>
          </div>

          <input
            readonly
            :value="displayKeybinding(command.id)"
            :data-keybinding-input="command.id"
            class="h-7 min-w-0 rounded-md border border-border bg-background px-2 text-center text-[11px] text-foreground outline-none transition-colors focus:border-ring"
            @keydown="recordShortcut(command.id, $event)"
          />

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
