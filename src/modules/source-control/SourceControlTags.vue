<script setup lang="ts">
import {
  AddOutline,
  CloudUploadOutline,
  PricetagOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import { NButton, NIcon, NInput, NModal, NSpin, NTag } from "naive-ui";
import type { InputInst } from "naive-ui";
import { computed, nextTick, ref, watch } from "vue";
import type { GitTagInfo } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import TooltipTitle from "@/components/TooltipTitle.vue";
import type { BusyAction } from "./useSourceControlState";

const props = defineProps<{
  show: boolean;
  tags: GitTagInfo[];
  loading: boolean;
  busyAction: BusyAction | null;
}>();

const emit = defineEmits<{
  close: [];
  createTag: [input: { name: string; message: string | null }];
  deleteTag: [name: string];
  pushTag: [name: string];
}>();

const draftName = ref("");
const draftMessage = ref("");
const search = ref("");
const nameInputRef = ref<InputInst | null>(null);

const nameInputProps = {
  "data-git-tag-name-input": "",
} as unknown as Record<string, string>;
const messageInputProps = {
  "data-git-tag-message-input": "",
} as unknown as Record<string, string>;
const searchInputProps = {
  "data-git-tag-search": "",
} as unknown as Record<string, string>;

const busy = computed(() => props.busyAction !== null);

// 与后端 validate_git_name / check-ref-format 对齐的前置提示；
// 真正的规则校验仍交给 git。
const nameError = computed(() => {
  const name = draftName.value.trim();
  if (!name) return null;
  if (name.startsWith("-") || /\s/.test(name)) {
    return t("sourceControl.tagNameInvalid");
  }
  return null;
});

const canSubmit = computed(
  () => draftName.value.trim().length > 0 && !nameError.value && !busy.value,
);

const filteredTags = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return props.tags;
  return props.tags.filter(
    (tag) =>
      tag.name.toLowerCase().includes(query) ||
      (tag.subject ?? "").toLowerCase().includes(query),
  );
});

function resetDraft() {
  draftName.value = "";
  draftMessage.value = "";
}

function focusName() {
  void nextTick(() => nameInputRef.value?.focus());
}

function submitCreate() {
  if (!canSubmit.value) return;
  const name = draftName.value.trim();
  const message = draftMessage.value.trim();
  emit("createTag", { name, message: message || null });
  resetDraft();
  focusName();
}

function handleUpdateShow(next: boolean) {
  if (next) return;
  resetDraft();
  emit("close");
}

function tagTitle(tag: GitTagInfo): string {
  return [tag.fullRef ?? tag.name, tag.subject ?? ""]
    .filter(Boolean)
    .join("\n");
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      resetDraft();
      search.value = "";
      focusName();
    }
  },
);
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    :bordered="false"
    :mask-closable="true"
    class="max-w-[520px]"
    @update:show="handleUpdateShow"
  >
    <template #header>
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <NIcon :component="PricetagOutline" :size="16" class="shrink-0 text-muted-foreground" />
        <span class="truncate text-sm font-medium">{{ t("sourceControl.tags") }}</span>
        <NTag v-if="props.tags.length" size="small" round>{{ props.tags.length }}</NTag>
        <NSpin v-if="props.loading" size="small" />
      </div>
    </template>

    <div class="space-y-3">
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <NInput
            ref="nameInputRef"
            v-model:value="draftName"
            size="small"
            :input-props="nameInputProps"
            :placeholder="t('sourceControl.tagNamePlaceholder')"
            :status="nameError ? 'error' : undefined"
            :disabled="busy"
            @keydown.enter.prevent="submitCreate"
          />
          <NButton
            size="small"
            type="primary"
            data-git-tag-create
            :loading="props.busyAction === 'tag-create'"
            :disabled="!canSubmit"
            @click="submitCreate"
          >
            <template #icon><NIcon :component="AddOutline" /></template>
            {{ t("sourceControl.tagCreate") }}
          </NButton>
        </div>
        <p v-if="nameError" class="text-[10.5px] text-destructive">{{ nameError }}</p>
        <NInput
          v-model:value="draftMessage"
          size="small"
          type="textarea"
          :autosize="{ minRows: 1, maxRows: 3 }"
          :input-props="messageInputProps"
          :placeholder="t('sourceControl.tagMessagePlaceholder')"
          :disabled="busy"
          @keydown.enter.prevent="submitCreate"
        />
        <p class="text-[10.5px] text-muted-foreground">
          {{ t("sourceControl.tagMessageHint") }}
        </p>
      </div>

      <NInput
        v-model:value="search"
        size="small"
        clearable
        :input-props="searchInputProps"
        :placeholder="t('sourceControl.tagSearch')"
      />

      <div
        v-if="!props.tags.length"
        class="px-1 text-[11px] text-muted-foreground"
      >
        {{ t("sourceControl.tagsEmpty") }}
      </div>
      <div
        v-else-if="!filteredTags.length"
        class="px-1 text-[11px] text-muted-foreground"
      >
        {{ t("sourceControl.tagSearchEmpty") }}
      </div>
      <div v-else class="max-h-72 min-w-0 space-y-1 overflow-y-auto overscroll-contain">
        <div
          v-for="tag in filteredTags"
          :key="tag.fullRef || tag.name"
          data-git-tag-row
          :data-git-tag="tag.name"
          class="flex min-w-0 items-start gap-2 rounded-md bg-surface-subtle px-2 py-1.5"
        >
          <div class="min-w-0 flex-1 basis-32" :title="tagTitle(tag)">
            <div class="flex min-w-0 items-center gap-1.5">
              <span class="truncate text-[12px] font-medium">{{ tag.name }}</span>
              <NTag v-if="tag.isAnnotated" size="tiny">
                {{ t("sourceControl.tagAnnotated") }}
              </NTag>
            </div>
            <div class="truncate font-mono text-[10.5px] text-muted-foreground">
              {{ tag.shortSha }}<span v-if="tag.subject"> · {{ tag.subject }}</span>
            </div>
          </div>
          <TooltipTitle :label="t('sourceControl.tagPush')">
            <NButton
              size="tiny"
              quaternary
              class="shrink-0"
              :loading="props.busyAction === 'tag-push'"
              :disabled="busy && props.busyAction !== 'tag-push'"
              :data-git-tag-push="tag.name"
              :aria-label="t('sourceControl.tagPush')"
              @click="emit('pushTag', tag.name)"
            >
              <template #icon><NIcon :component="CloudUploadOutline" /></template>
            </NButton>
          </TooltipTitle>
          <NButton
            size="tiny"
            quaternary
            type="error"
            class="shrink-0"
            :loading="props.busyAction === `tag-delete:${tag.name}`"
            :disabled="busy && props.busyAction !== `tag-delete:${tag.name}`"
            :data-git-tag-delete="tag.name"
            :aria-label="t('sourceControl.tagDelete')"
            @click="emit('deleteTag', tag.name)"
          >
            <template #icon><NIcon :component="TrashOutline" /></template>
          </NButton>
        </div>
      </div>
    </div>
  </NModal>
</template>
