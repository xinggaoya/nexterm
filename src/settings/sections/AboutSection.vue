<script setup lang="ts">
import { NCard, NDescriptions, NDescriptionsItem } from "naive-ui";
import { APP_VERSION } from "@/lib/appInfo";
import { t } from "@/modules/i18n/translate";
</script>

<template>
  <section class="space-y-5">
    <div>
      <h1 class="text-lg font-semibold tracking-normal">
        {{ t("settings.about.title") }}
      </h1>
      <p class="mt-1 text-xs text-muted-foreground">
        {{ t("settings.about.description") }}
      </p>
    </div>

    <NCard class="nexterm-settings-group" size="small" embedded>
      <NDescriptions label-placement="left" :column="1" size="small">
        <NDescriptionsItem :label="t('settings.about.product')">
          Nexterm
        </NDescriptionsItem>
        <NDescriptionsItem :label="t('settings.about.version')">
          {{ APP_VERSION }}
        </NDescriptionsItem>
        <NDescriptionsItem :label="t('settings.about.frontend')">
          Vue 3 · Naive UI · Vite
        </NDescriptionsItem>
        <NDescriptionsItem :label="t('settings.about.runtime')">
          Tauri 2
        </NDescriptionsItem>
      </NDescriptions>
    </NCard>
  </section>
</template>
