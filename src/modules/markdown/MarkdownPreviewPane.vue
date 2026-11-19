<script setup lang="ts">
import { NSpin } from "naive-ui";
import { computed, ref, watch } from "vue";
import { t } from "@/modules/i18n/translate";
import { fileIconUrl } from "@/modules/icons";
import { useWorkspaceContext } from "@/app/workspaceContext";
import {
  readMarkdownDocument,
  type MarkdownDocumentState,
} from "./lib/markdownDocumentService";
import MarkdownContent from "./MarkdownContent.vue";

const props = defineProps<{
  path: string;
  visible: boolean;
}>();

const wsCtx = useWorkspaceContext();
const doc = ref<MarkdownDocumentState>({ status: "loading" });

const fileName = computed(() => {
  const parts = props.path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : props.path;
});

/** 头部展示的文件类型图标（Markdown Logo）。 */
const fileIcon = computed(() => fileIconUrl(props.path));

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function load() {
  doc.value = { status: "loading" };
  doc.value = await readMarkdownDocument(wsCtx.wsNative, props.path);
}

watch(() => props.path, () => void load(), { immediate: true });
</script>

<template>
  <div
    class="nexterm-surface flex h-full w-full flex-col overflow-hidden"
    :style="{ pointerEvents: props.visible ? 'auto' : 'none' }"
  >
    <div class="nexterm-toolbar flex h-8 shrink-0 items-center gap-2 px-3">
      <img
        :src="fileIcon"
        alt=""
        data-markdown-file-icon
        class="size-3.5 shrink-0 nexterm-file-icon"
      />
      <div class="min-w-0 flex-1 truncate text-[12px] font-medium">{{ fileName }}</div>
    </div>

    <div v-if="doc.status === 'loading'" class="grid min-h-0 flex-1 place-items-center">
      <div class="flex items-center gap-2 text-xs text-muted-foreground">
        <NSpin size="small" />
        <span>{{ t("markdown.loading") }}</span>
      </div>
    </div>

    <div
      v-else-if="doc.status === 'error'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center text-xs text-destructive"
    >
      {{ t("markdown.failedRead", { message: doc.message }) }}
    </div>

    <div
      v-else-if="doc.status === 'binary'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center"
    >
      <div>
        <div class="text-sm font-medium">{{ t("markdown.binaryFile") }}</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{ formatBytes(doc.size) }} · {{ t("markdown.cannotRender") }}
        </div>
      </div>
    </div>

    <div
      v-else-if="doc.status === 'toolarge'"
      class="grid min-h-0 flex-1 place-items-center p-6 text-center"
    >
      <div>
        <div class="text-sm font-medium">{{ t("markdown.fileTooLarge") }}</div>
        <div class="mt-1 text-xs text-muted-foreground">
          {{
            t("markdown.limit", {
              size: formatBytes(doc.size),
              limit: formatBytes(doc.limit),
            })
          }}
        </div>
      </div>
    </div>

    <!-- 应用根节点是 select-none，预览正文需要显式恢复可选中以便复制。 -->
    <div
      v-else
      class="min-h-0 flex-1 cursor-text overflow-auto px-6 py-5 select-text"
      data-markdown-preview-scroll
    >
      <MarkdownContent :content="doc.content" data-markdown-preview />
    </div>
  </div>
</template>
