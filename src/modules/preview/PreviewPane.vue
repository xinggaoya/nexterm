<script setup lang="ts">
import { AlertCircleOutline, GlobeOutline } from "@vicons/ionicons5";
import { NButton, NIcon } from "naive-ui";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import PreviewAddressBar from "./PreviewAddressBar.vue";
import { isLocalPreviewUrl } from "./previewUrl";
import type { PreviewPaneHandle } from "./previewTypes";

const props = defineProps<{
  url: string;
  visible: boolean;
}>();

const emit = defineEmits<{
  urlChange: [url: string];
}>();

type PreviewAddressBarExpose = {
  focus: () => void;
};

const SUSPEND_AFTER_MS = 30_000;
const nonce = ref(0);
const loaded = ref(props.visible);
const addressBar = ref<PreviewAddressBarExpose | null>(null);
let suspendTimer: ReturnType<typeof setTimeout> | null = null;

const showXfoHint = computed(() =>
  props.url ? !isLocalPreviewUrl(props.url) : false,
);

function clearSuspendTimer() {
  if (suspendTimer === null) return;
  clearTimeout(suspendTimer);
  suspendTimer = null;
}

function reload() {
  loaded.value = true;
  nonce.value += 1;
}

function focusAddressBar() {
  addressBar.value?.focus();
}

function getUrl() {
  return props.url;
}

watch(
  () => props.visible,
  (visible) => {
    clearSuspendTimer();
    if (visible) {
      loaded.value = true;
      return;
    }
    suspendTimer = setTimeout(() => {
      loaded.value = false;
      suspendTimer = null;
    }, SUSPEND_AFTER_MS);
  },
  { immediate: true },
);

onBeforeUnmount(clearSuspendTimer);

defineExpose<PreviewPaneHandle>({
  reload,
  focusAddressBar,
  getUrl,
});
</script>

<template>
  <div
    class="flex h-full w-full flex-col overflow-hidden rounded-md border border-border/60 bg-background"
    :style="{
      visibility: props.visible ? 'visible' : 'hidden',
      pointerEvents: props.visible ? 'auto' : 'none',
    }"
  >
    <PreviewAddressBar
      ref="addressBar"
      :url="props.url"
      @submit="(url) => emit('urlChange', url)"
      @reload="reload"
    />

    <div
      v-if="showXfoHint"
      class="flex h-7 shrink-0 items-center gap-1.5 border-b border-border/60 bg-amber-500/8 px-3 text-[11px] text-amber-600 dark:text-amber-400"
    >
      <NIcon :component="AlertCircleOutline" :size="13" class="shrink-0" />
      <span class="truncate">
        Many public sites refuse to embed (X-Frame-Options). If the page is blank, open it externally.
      </span>
    </div>

    <div
      :class="[
        'relative min-h-0 flex-1',
        props.url ? 'bg-white' : 'bg-background',
      ]"
    >
      <iframe
        v-if="props.url && loaded"
        :key="`${props.url}#${nonce}`"
        :src="props.url"
        title="Preview"
        class="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads"
        referrerPolicy="no-referrer"
        allow="clipboard-read; clipboard-write; fullscreen"
      />

      <div
        v-else-if="props.url"
        class="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center"
      >
        <div class="grid size-10 place-items-center rounded-md border border-border/60 bg-card text-muted-foreground">
          <NIcon :component="GlobeOutline" :size="18" />
        </div>
        <div class="space-y-1">
          <p class="text-[12.5px] font-medium text-foreground">Preview suspended</p>
          <p class="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
            Released to free memory after sitting in the background.
          </p>
        </div>
        <NButton size="tiny" secondary @click="reload">Reload</NButton>
      </div>

      <div
        v-else
        class="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <div class="grid size-12 place-items-center rounded-md border border-border/60 bg-card text-muted-foreground">
          <NIcon :component="GlobeOutline" :size="20" />
        </div>
        <div class="space-y-1.5">
          <p class="text-sm font-medium text-foreground">Nothing to preview yet</p>
          <p class="max-w-sm text-xs leading-relaxed text-muted-foreground">
            Type a URL above, or open the Ports menu to jump straight to your running dev server.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
