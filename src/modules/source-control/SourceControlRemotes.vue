<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  AddOutline,
  CloudOutline,
  TrashOutline,
} from "@vicons/ionicons5";
import {
  NButton,
  NIcon,
  NInput,
  NModal,
  NSpin,
  NTag,
} from "naive-ui";
import type { InputInst } from "naive-ui";
import type { GitRemoteInfo } from "@/lib/native";
import { t } from "@/modules/i18n/translate";
import type { BusyAction } from "./useSourceControlState";

const props = defineProps<{
  show: boolean;
  remotes: GitRemoteInfo[];
  loading: boolean;
  busyAction: BusyAction | null;
}>();

const emit = defineEmits<{
  close: [];
  addRemote: [input: { name: string; url: string }];
  updateRemote: [input: { name: string; newUrl: string }];
  removeRemote: [name: string];
}>();

type EditMode =
  | { kind: "add" }
  | { kind: "edit"; remote: GitRemoteInfo };

const editor = ref<EditMode | null>(null);
const draftName = ref("");
const draftUrl = ref("");
const nameInputRef = ref<InputInst | null>(null);
const urlInputRef = ref<InputInst | null>(null);

const nameInputProps = {
  "data-git-remote-name-input": "",
} as unknown as Record<string, string>;
const urlInputProps = {
  "data-git-remote-url-input": "",
} as unknown as Record<string, string>;

const busy = computed(() => props.busyAction !== null);

const nameError = computed(() => {
  const name = draftName.value.trim();
  if (!name) return null;
  if (name.length > 64) return t("sourceControl.remoteNameInvalid");
  if (!/^[A-Za-z0-9_][A-Za-z0-9._-]*$/.test(name)) {
    return t("sourceControl.remoteNameInvalid");
  }
  return null;
});

const urlError = computed(() => {
  // Whether the URL is non-empty is the only validation we enforce client-side.
  // Real validation (ref format, reachability) is left to git.
  if (editor.value && !draftUrl.value.trim()) {
    return t("sourceControl.remoteUrlInvalid");
  }
  return null;
});

const canSubmit = computed(() => {
  if (!editor.value) return false;
  if (nameError.value) return false;
  if (urlError.value) return false;
  return Boolean(draftName.value.trim() && draftUrl.value.trim());
});

const isEdit = computed(() => editor.value?.kind === "edit");

function openAdd() {
  editor.value = { kind: "add" };
  draftName.value = "";
  draftUrl.value = "";
  focusName();
}

function openEdit(remote: GitRemoteInfo) {
  editor.value = { kind: "edit", remote };
  draftName.value = remote.name;
  draftUrl.value = remote.fetchUrl;
  focusUrl();
}

function closeEditor() {
  editor.value = null;
  draftName.value = "";
  draftUrl.value = "";
}

function focusName() {
  void nextTick(() => nameInputRef.value?.focus());
}

function focusUrl() {
  void nextTick(() => urlInputRef.value?.focus());
}

function submitEditor() {
  if (!canSubmit.value || !editor.value) return;
  const name = draftName.value.trim();
  const url = draftUrl.value.trim();
  if (editor.value.kind === "add") {
    emit("addRemote", { name, url });
  } else {
    emit("updateRemote", { name, newUrl: url });
  }
  closeEditor();
}

function handleRemove(remote: GitRemoteInfo) {
  emit("removeRemote", remote.name);
}

function handleUpdateShow(next: boolean) {
  if (next) return;
  closeEditor();
  emit("close");
}

function remoteTitle(remote: GitRemoteInfo): string {
  return `${remote.name}\n${remote.fetchUrl}`;
}

watch(
  () => props.show,
  (show) => {
    if (show) closeEditor();
  },
);
</script>

<template>
  <NModal
    :show="props.show"
    preset="card"
    :bordered="false"
    :mask-closable="true"
    class="max-w-[560px]"
    @update:show="handleUpdateShow"
  >
    <template #header>
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <NIcon :component="CloudOutline" :size="16" class="shrink-0 text-muted-foreground" />
        <span class="truncate text-sm font-medium">{{ t("sourceControl.remotes") }}</span>
        <NSpin v-if="props.loading" size="small" />
        <div class="ml-auto flex min-w-0 gap-2">
          <NButton
            size="small"
            type="primary"
            data-git-remote-add
            :disabled="busy || !props.remotes"
            @click="openAdd"
          >
            <template #icon><NIcon :component="AddOutline" /></template>
            {{ t("sourceControl.remoteAdd") }}
          </NButton>
        </div>
      </div>
    </template>

    <div class="space-y-3">
      <div v-if="!props.remotes.length" class="px-1 text-[11px] text-muted-foreground">
        {{ t("sourceControl.remotesEmpty") }}
      </div>

      <div v-else class="max-h-72 min-w-0 space-y-1 overflow-y-auto overscroll-contain">
        <div
          v-for="remote in props.remotes"
          :key="remote.name"
          data-git-remote-row
          :data-git-remote-name="remote.name"
          class="flex min-w-0 items-start gap-2 rounded-md bg-surface-subtle px-2 py-1.5"
        >
          <div class="min-w-0 flex-1 basis-32">
            <div class="truncate text-[12px] font-medium" :title="remoteTitle(remote)">
              {{ remote.name }}
            </div>
            <div class="truncate font-mono text-[10.5px] text-muted-foreground" :title="remote.fetchUrl">
              {{ remote.fetchUrl }}
            </div>
            <NTag
              v-if="remote.pushUrl && remote.pushUrl !== remote.fetchUrl"
              size="tiny"
              class="mt-0.5"
              :title="t('sourceControl.remotePushUrl', { url: remote.pushUrl })"
            >
              {{ t("sourceControl.remotePushUrl", { url: remote.pushUrl }) }}
            </NTag>
            <NTag
              v-else
              size="tiny"
              type="default"
              class="mt-0.5"
              :title="remote.pushUrl"
            >
              {{ t("sourceControl.remoteSameUrl") }}
            </NTag>
          </div>
          <NButton
            size="tiny"
            class="shrink-0"
            quaternary
            :disabled="busy"
            :data-git-remote-edit="remote.name"
            @click="openEdit(remote)"
          >
            {{ t("sourceControl.remoteEdit") }}
          </NButton>
          <NButton
            size="tiny"
            class="shrink-0"
            quaternary
            type="error"
            :disabled="busy"
            :data-git-remote-remove="remote.name"
            @click="handleRemove(remote)"
          >
            <template #icon><NIcon :component="TrashOutline" /></template>
          </NButton>
        </div>
      </div>
    </div>

    <NModal
      :show="editor !== null"
      preset="card"
      :bordered="false"
      :mask-closable="true"
      class="max-w-[420px]"
      :title="isEdit ? t('sourceControl.remoteEditTitle') : t('sourceControl.remoteAddTitle')"
      @update:show="(show) => { if (!show) closeEditor(); }"
    >
      <div v-if="editor" class="space-y-3">
        <p v-if="!isEdit" class="text-[11px] text-muted-foreground">
          {{ t("sourceControl.remoteAddDescription") }}
        </p>
        <div class="space-y-1">
          <span class="text-[11px] font-medium text-muted-foreground">
            {{ t("sourceControl.remoteName") }}
          </span>
          <NInput
            ref="nameInputRef"
            v-model:value="draftName"
            :input-props="nameInputProps"
            :placeholder="t('sourceControl.remoteNamePlaceholder')"
            :status="nameError ? 'error' : undefined"
            :disabled="isEdit"
          />
          <p v-if="nameError" class="text-[10.5px] text-destructive">
            {{ nameError }}
          </p>
        </div>
        <div class="space-y-1">
          <span class="text-[11px] font-medium text-muted-foreground">
            {{ t("sourceControl.remoteUrl") }}
          </span>
          <NInput
            ref="urlInputRef"
            v-model:value="draftUrl"
            :input-props="urlInputProps"
            :placeholder="t('sourceControl.remoteUrlPlaceholder')"
            :status="urlError ? 'error' : undefined"
            @keydown.enter.prevent="submitEditor"
          />
          <p v-if="urlError" class="text-[10.5px] text-destructive">
            {{ urlError }}
          </p>
        </div>
        <div class="flex justify-end gap-2">
          <NButton size="small" data-git-remote-cancel @click="closeEditor">
            {{ t("common.cancel") }}
          </NButton>
          <NButton
            size="small"
            type="primary"
            :data-git-remote-submit="isEdit ? 'edit' : 'add'"
            :disabled="!canSubmit"
            @click="submitEditor"
          >
            {{ isEdit ? t("editor.save") : t("sourceControl.remoteAdd") }}
          </NButton>
        </div>
      </div>
    </NModal>
  </NModal>
</template>
