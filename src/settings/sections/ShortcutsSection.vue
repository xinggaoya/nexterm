<script setup lang="ts">
import { computed } from "vue";
import { NCard, NList, NListItem, NTag, NThing } from "naive-ui";
import { ENTER_KEY, MOD_KEY, SHIFT_KEY } from "@/lib/platform";
import { SHORTCUTS, type KeyBinding } from "@/modules/shortcuts/shortcuts";

type Shortcut = (typeof SHORTCUTS)[number];

function formatBinding(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.meta || binding.ctrl) parts.push(MOD_KEY);
  if (binding.shift) parts.push(SHIFT_KEY);
  if (binding.alt) parts.push("Alt");
  const key = binding.key === "Enter" ? ENTER_KEY : binding.key;
  parts.push(key.length === 1 ? key.toUpperCase() : key);
  return parts.join("+").replace(`${MOD_KEY}+`, `${MOD_KEY}+`);
}

const grouped = computed(() => {
  const map = new Map<string, Shortcut[]>();
  for (const shortcut of SHORTCUTS) {
    map.set(shortcut.group, [...(map.get(shortcut.group) ?? []), shortcut]);
  }
  return Array.from(map.entries());
});
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">Shortcuts</h1>
      <p class="mt-1 text-xs text-muted-foreground">
        Current default keyboard shortcuts.
      </p>
    </div>

    <NCard
      v-for="[group, shortcuts] in grouped"
      :key="group"
      size="small"
      :title="group"
      embedded
    >
      <NList>
        <NListItem v-for="shortcut in shortcuts" :key="shortcut.id">
          <NThing :title="shortcut.label">
            <template #header-extra>
              <div class="flex flex-wrap justify-end gap-1">
                <NTag
                  v-for="binding in shortcut.defaultBindings"
                  :key="formatBinding(binding)"
                  size="small"
                  round
                >
                  {{ formatBinding(binding) }}
                </NTag>
              </div>
            </template>
          </NThing>
        </NListItem>
      </NList>
    </NCard>
  </section>
</template>
