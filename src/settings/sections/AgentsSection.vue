<script setup lang="ts">
import { NCard, NInput, NList, NListItem, NThing } from "naive-ui";
import { BUILTIN_AGENTS } from "@/modules/ai/lib/agents";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

const prefs = usePreferencesPiniaStore();
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">Agents</h1>
      <p class="mt-1 text-xs text-muted-foreground">
        Shared instructions and built-in agent profiles.
      </p>
    </div>

    <NCard size="small" title="Global instructions" embedded>
      <NInput
        :value="prefs.customInstructions"
        type="textarea"
        :autosize="{ minRows: 6, maxRows: 12 }"
        placeholder="Instructions applied to AI agent conversations."
        @update:value="prefs.updateCustomInstructions"
      />
    </NCard>

    <NCard size="small" title="Built-in agents" embedded>
      <NList>
        <NListItem v-for="agent in BUILTIN_AGENTS" :key="agent.id">
          <NThing :title="agent.name" :description="agent.description" />
        </NListItem>
      </NList>
    </NCard>
  </section>
</template>
