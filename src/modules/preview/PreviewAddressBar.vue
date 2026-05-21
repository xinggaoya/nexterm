<script setup lang="ts">
import {
  ChevronDownOutline,
  GlobeOutline,
  OpenOutline,
  ReloadOutline,
} from "@vicons/ionicons5";
import { openUrl } from "@tauri-apps/plugin-opener";
import { NButton, NDropdown, NIcon, NInput } from "naive-ui";
import { computed, ref, watch } from "vue";
import { normalizePreviewUrl, PORT_PRESETS } from "./previewUrl";

const props = defineProps<{
  url: string;
}>();

const emit = defineEmits<{
  submit: [url: string];
  reload: [];
}>();

type InputExpose = {
  focus: () => void;
  inputElRef?: HTMLInputElement | null;
};

const draft = ref(props.url);
const notice = ref<string | null>(null);
const checkingPort = ref<number | null>(null);
const inputRef = ref<InputExpose | null>(null);

const portOptions = computed(() =>
  PORT_PRESETS.map((preset) => ({
    key: preset.port,
    label:
      checkingPort.value === preset.port
        ? `${preset.label}  checking...`
        : `${preset.label}  :${preset.port}`,
  })),
);

watch(
  () => props.url,
  (url) => {
    draft.value = url;
  },
);

function submitDraft() {
  const next = normalizePreviewUrl(draft.value);
  if (!next) {
    notice.value = "Enter a URL or pick a port preset.";
    return;
  }
  notice.value = null;
  if (next !== props.url) emit("submit", next);
  else emit("reload");
}

async function probeUrl(url: string): Promise<boolean> {
  try {
    await fetch(url, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(900),
    });
    return true;
  } catch {
    return false;
  }
}

async function tryPort(port: number) {
  notice.value = null;
  checkingPort.value = port;
  const next = `http://localhost:${port}`;
  const ok = await probeUrl(next);
  checkingPort.value = null;
  if (!ok) {
    notice.value = `No server listening on :${port}.`;
    return;
  }
  draft.value = next;
  emit("submit", next);
}

function openExternal() {
  if (!props.url) return;
  void openUrl(props.url).catch(console.error);
}

function resetDraft() {
  draft.value = props.url;
  inputRef.value?.inputElRef?.blur();
}

function focus() {
  inputRef.value?.focus();
  inputRef.value?.inputElRef?.select();
}

defineExpose({ focus });
</script>

<template>
  <div class="shrink-0 border-b border-border/60">
    <div class="flex h-9 items-center gap-1 bg-card/40 px-1.5">
      <NButton
        size="tiny"
        quaternary
        title="Reload"
        aria-label="Reload"
        @click="emit('reload')"
      >
        <template #icon><NIcon :component="ReloadOutline" /></template>
      </NButton>

      <NDropdown
        trigger="click"
        :options="portOptions"
        placement="bottom-start"
        @select="(key) => void tryPort(Number(key))"
      >
        <NButton
          size="tiny"
          quaternary
          title="Common dev-server ports"
          aria-label="Common dev-server ports"
        >
          <template #icon><NIcon :component="GlobeOutline" /></template>
          <span class="hidden text-[11px] sm:inline">Ports</span>
          <NIcon :component="ChevronDownOutline" :size="12" />
        </NButton>
      </NDropdown>

      <NInput
        ref="inputRef"
        v-model:value="draft"
        size="tiny"
        class="min-w-0 flex-1"
        placeholder="http://localhost:3000"
        :input-props="{
          spellcheck: 'false',
          autocomplete: 'off',
        }"
        @keydown.enter.prevent="submitDraft"
        @keydown.esc.prevent="resetDraft"
      />

      <NButton
        size="tiny"
        quaternary
        :disabled="!props.url"
        title="Open in system browser"
        aria-label="Open in system browser"
        @click="openExternal"
      >
        <template #icon><NIcon :component="OpenOutline" /></template>
      </NButton>
    </div>

    <div
      v-if="notice"
      class="flex items-center gap-1.5 bg-amber-500/8 px-3 py-1 text-[11px] text-amber-600 dark:text-amber-400"
    >
      <span class="min-w-0 flex-1 truncate">{{ notice }}</span>
      <button
        type="button"
        class="rounded px-1 text-[10px] opacity-80 hover:bg-accent hover:opacity-100"
        @click="notice = null"
      >
        Dismiss
      </button>
    </div>
  </div>
</template>
