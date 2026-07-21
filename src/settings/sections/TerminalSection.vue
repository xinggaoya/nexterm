<script setup lang="ts">
import { t } from "@/modules/i18n/translate";
import TerminalAppearanceSection from "./TerminalAppearanceSection.vue";
import TerminalBehaviorSection from "./TerminalBehaviorSection.vue";
import TerminalRendererSection from "./TerminalRendererSection.vue";
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">
        {{ t("settings.general.terminal") }}
      </h1>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t("settings.general.terminalDescription") }}
      </p>
    </div>

    <TerminalAppearanceSection />
    <TerminalBehaviorSection />
    <TerminalRendererSection />
  </section>
</template>