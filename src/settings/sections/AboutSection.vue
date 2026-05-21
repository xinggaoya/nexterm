<script setup lang="ts">
import { NCard, NDescriptions, NDescriptionsItem } from "naive-ui";
import { APP_VERSION } from "@/lib/appInfo";
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">About</h1>
      <p class="mt-1 text-xs text-muted-foreground">
        Nexterm application and runtime information.
      </p>
    </div>

    <NCard size="small" embedded>
      <NDescriptions label-placement="left" :column="1" size="small">
        <NDescriptionsItem label="Product">Nexterm</NDescriptionsItem>
        <NDescriptionsItem label="Version">{{ APP_VERSION }}</NDescriptionsItem>
        <NDescriptionsItem label="Frontend">Vue 3 · Naive UI · Vite</NDescriptionsItem>
        <NDescriptionsItem label="Runtime">Tauri 2</NDescriptionsItem>
      </NDescriptions>
    </NCard>
  </section>
</template>
