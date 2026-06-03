<script setup lang="ts">
import { NTooltip } from "naive-ui";
import { computed } from "vue";
import { useTouchDevicePreference } from "@/lib/touchDevice";

const props = withDefaults(
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

const { effectiveTouch } = useTouchDevicePreference();
const isDisabled = computed(
  () => props.disabled || !props.label || effectiveTouch.value,
);
</script>

<template>
  <NTooltip :disabled="isDisabled" :placement="placement" trigger="hover">
    <template #trigger>
      <span :class="triggerClass">
        <slot />
      </span>
    </template>
    <span>{{ label }}</span>
  </NTooltip>
</template>
