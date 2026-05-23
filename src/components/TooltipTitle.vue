<script setup lang="ts">
import { NTooltip } from "naive-ui";

withDefaults(
  defineProps<{
    label: string;
    placement?: "top" | "right" | "bottom" | "left";
    disabled?: boolean;
    triggerClass?: string;
  }>(),
  {
    placement: "bottom",
    disabled: false,
    triggerClass: "inline-flex shrink-0",
  },
);
</script>

<template>
  <NTooltip :disabled="disabled || !label" :placement="placement" trigger="hover">
    <template #trigger>
      <span :class="triggerClass">
        <slot />
      </span>
    </template>
    <span>{{ label }}</span>
  </NTooltip>
</template>
