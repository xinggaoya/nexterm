<script setup lang="ts">
import { AlertCircleOutline, GlobeOutline } from "@vicons/ionicons5";
import { NButton, NIcon } from "naive-ui";
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { t } from "@/modules/i18n/translate";
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

// `allow-scripts` + `allow-same-origin` together effectively disable the
// sandbox: the iframe is treated as same-origin and the script can reach the
// parent origin's storage. That is the right default for *local* previews
// (so the dev server's own cookies / localStorage keep working), but for any
// remote URL it would let an XSS payload read and exfiltrate the user's
// localhost data. Drop `allow-same-origin` (and a couple of related flags
// that only matter with it) for any non-local URL.
const sandboxAttrs = computed(() => {
  if (isLocalPreviewUrl(props.url)) {
    return "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads";
  }
  return "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox";
});

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
        {{ t("preview.xfoHint") }}
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
        :title="t('preview.preview')"
        class="h-full w-full border-0"
        :sandbox="sandboxAttrs"
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
          <p class="text-[12.5px] font-medium text-foreground">
            {{ t("preview.suspendedTitle") }}
          </p>
          <p class="max-w-xs text-[11px] leading-relaxed text-muted-foreground">
            {{ t("preview.suspendedDescription") }}
          </p>
        </div>
        <NButton size="tiny" secondary @click="reload">
          {{ t("preview.reload") }}
        </NButton>
      </div>

      <div
        v-else
        class="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center"
      >
        <div class="grid size-12 place-items-center rounded-md border border-border/60 bg-card text-muted-foreground">
          <NIcon :component="GlobeOutline" :size="20" />
        </div>
        <div class="space-y-1.5">
          <p class="text-sm font-medium text-foreground">
            {{ t("preview.nothingTitle") }}
          </p>
          <p class="max-w-sm text-xs leading-relaxed text-muted-foreground">
            {{ t("preview.nothingDescription") }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
