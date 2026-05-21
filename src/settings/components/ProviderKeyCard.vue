<script setup lang="ts">
import {
  CheckmarkCircleOutline,
  CloseOutline,
  CreateOutline,
  EyeOffOutline,
  EyeOutline,
  OpenOutline,
} from "@vicons/ionicons5";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  NButton,
  NIcon,
  NInput,
  NSpin,
  NTag,
} from "naive-ui";
import { computed, ref, watch } from "vue";
import type { ProviderInfo } from "@/modules/ai/config";
import { maskProviderKey, validateProviderKeyInput } from "./providerKeys";

const props = defineProps<{
  provider: ProviderInfo;
  currentKey: string | null;
  saveKey: (key: string) => Promise<void>;
  clearKeyValue: () => Promise<void>;
}>();

const editing = ref(!props.currentKey);
const value = ref("");
const reveal = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const masked = computed(() => maskProviderKey(props.currentKey ?? ""));

watch(
  () => props.currentKey,
  (key) => {
    editing.value = !key;
  },
);

async function submit() {
  const validation = validateProviderKeyInput(props.provider, value.value);
  if (validation) {
    error.value = validation;
    return;
  }
  saving.value = true;
  error.value = null;
  try {
    await props.saveKey(value.value.trim());
    value.value = "";
    reveal.value = false;
    editing.value = false;
  } catch (e) {
    error.value = `Failed to save: ${String(e)}`;
  } finally {
    saving.value = false;
  }
}

function cancelEdit() {
  value.value = "";
  reveal.value = false;
  error.value = null;
  editing.value = false;
}

async function clearSavedKey() {
  saving.value = true;
  error.value = null;
  try {
    await props.clearKeyValue();
  } catch (e) {
    error.value = `Failed to remove: ${String(e)}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="rounded-lg border border-border/60 bg-card/60 px-3 py-2.5">
    <div class="flex items-center gap-2">
      <span class="text-[12.5px] font-medium">{{ provider.label }}</span>
      <NTag v-if="currentKey" size="small" round>
        <template #icon>
          <NIcon :component="CheckmarkCircleOutline" />
        </template>
        Connected
      </NTag>
      <button
        type="button"
        class="ml-auto inline-flex items-center gap-1 text-[10.5px] text-muted-foreground transition-colors hover:text-foreground"
        @click="openUrl(provider.consoleUrl)"
      >
        Get key
        <NIcon :component="OpenOutline" :size="12" />
      </button>
    </div>

    <div v-if="editing" class="mt-2 flex flex-col gap-1.5">
      <div class="flex gap-1.5">
        <div class="relative flex-1">
          <NInput
            :value="value"
            :type="reveal ? 'text' : 'password'"
            autocomplete="off"
            :placeholder="provider.keyPrefix ? `${provider.keyPrefix}...` : 'Paste API key'"
            @update:value="(next) => { value = next; error = null; }"
            @keyup.enter="() => void submit()"
            @keyup.esc="currentKey ? cancelEdit() : undefined"
          />
          <button
            type="button"
            tabindex="-1"
            class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground/60 hover:text-foreground"
            :aria-label="reveal ? 'Hide key' : 'Show key'"
            @click="reveal = !reveal"
          >
            <NIcon :component="reveal ? EyeOffOutline : EyeOutline" :size="14" />
          </button>
        </div>
        <NButton
          size="small"
          type="primary"
          :disabled="!value.trim() || saving"
          @click="() => void submit()"
        >
          <template v-if="saving" #icon><NSpin size="small" /></template>
          Save
        </NButton>
      </div>
      <p v-if="error" class="text-[10.5px] text-destructive">{{ error }}</p>
    </div>

    <div v-else class="mt-2 flex items-center gap-1.5">
      <code class="flex-1 truncate rounded bg-muted/40 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        {{ masked }}
      </code>
      <NButton size="tiny" quaternary title="Replace" @click="editing = true">
        <template #icon><NIcon :component="CreateOutline" /></template>
      </NButton>
      <NButton size="tiny" quaternary title="Remove" @click="() => void clearSavedKey()">
        <template #icon><NIcon :component="CloseOutline" /></template>
      </NButton>
    </div>
    <p v-if="error && !editing" class="mt-1 text-[10.5px] text-destructive">
      {{ error }}
    </p>
  </div>
</template>
