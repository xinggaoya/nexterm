<script setup lang="ts">
import { ImageOutline } from "@vicons/ionicons5";
import { NIcon, NSpin } from "naive-ui";
import { computed, ref, watch } from "vue";
import { t } from "@/modules/i18n/translate";
import { useWorkspaceContext } from "@/app/workspaceContext";
import {
  readFilePreview,
  type FilePreviewState,
} from "./lib/filePreviewDocumentService";

const props = defineProps<{
  path: string;
  visible: boolean;
}>();

const wsCtx = useWorkspaceContext();
const doc = ref<FilePreviewState>({ status: "loading" });

const fileName = computed(() => {
  const parts = props.path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : props.path;
});

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function load() {
  doc.value = { status: "loading" };
  doc.value = await readFilePreview(wsCtx.wsNative, props.path);
}

watch(() => props.path, () => void load(), { immediate: true });
</script>

<template>
  <div
    class="nexterm-surface flex h-full w-full flex-col overflow-hidden"
    :style="{ pointerEvents: props.visible ? 'auto' : 'none' }"
  >
    <div class="nexterm-toolbar flex h-8 shrink-0 items-center gap-2 px-3">
      <NIcon :component="ImageOutline" :size="15" class="shrink-0 text-muted-foreground" />
      <div class="min-w-0 flex-1 truncate text-[12px] font-medium">{{ fileName }}</div>
      <div
        v-if="doc.status === 'ready'"
        class="shrink-0 text-[11px] text-muted-foreground"
      >
        {{ formatBytes(doc.size) }}
      </div>
    </div>

    <div v-if="doc.status === 'loading'" class="grid min-h-0 flex-1 place-items-center">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <NSpin size="small" />
        <span>{{ t("filePreview.loading") }}</span>
      </div>
    </div>

    <div
      v-else-if="doc.status === 'error'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center text-xs text-destructive"
    >
      {{ t("filePreview.failedRead", { message: doc.message }) }}
    </div>

    <div
      v-else-if="doc.status === 'unsupported'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center"
    >
      <div class="text-sm font-medium">{{ t("filePreview.unsupported") }}</div>
    </div>

    <div
      v-else-if="doc.status === 'toolarge'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center"
    >
      <div>
        <div class="text-sm font-medium">{{ t("filePreview.fileTooLarge") }}</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{
            t("filePreview.limit", {
              size: formatBytes(doc.size),
              limit: formatBytes(doc.limit),
            })
          }}
        </div>
      </div>
    </div>

    <div v-else class="grid min-h-0 flex-1 place-items-center overflow-auto p-4">
      <img
        data-file-preview-image
        :src="doc.src"
        :alt="fileName"
        draggable="false"
        class="max-h-full max-w-full select-none object-contain"
      >
    </div>
  </div>
</template>
