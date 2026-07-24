<script setup lang="ts">
/**
 * Thin wrapper around NButton that renders a square icon-only control
 * matching the legacy `.nexterm-icon-button` visual (28×28, 4 px radius,
 * muted color, hover lift). It preserves the `nexterm-icon-button` class
 * on the rendered element so existing CSS + data-* test selectors keep
 * working, while inheriting Naive UI's theme, focus ring, and ARIA
 * semantics from NButton.
 *
 * Use for title-bar / window-controls / activity-bar icon buttons.
 */
import { NButton } from "naive-ui";
import { useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

const attrs = useAttrs();
</script>

<template>
  <NButton
    quaternary
    size="small"
    :class="['nexterm-icon-button', attrs.class]"
    v-bind="attrs"
  >
    <slot />
  </NButton>
</template>