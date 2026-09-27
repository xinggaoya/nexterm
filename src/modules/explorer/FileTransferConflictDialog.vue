<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { NButton, NCheckbox, NModal } from "naive-ui";
import { basename } from "@/lib/path";
import { t } from "@/modules/i18n/translate";
import type { FsConflictPolicy } from "@/lib/native";
import type { TransferPlan } from "./lib/fileTransfer";

/**
 * 搬运冲突对话框：目标目录里已有同名项时征询用户怎么处理。
 *
 * 三个选项与后端 `ConflictPolicy` 一一对应：
 * - `rename` 自动改名（`foo.ts` → `foo copy.ts`），**默认焦点**。
 * - `overwrite` 覆盖。目标若是目录，后端会递归删除整个目录、不可逆，
 *   因此额外要求一次显式勾选确认，避免误点直接丢数据。
 * - `skip` 跳过同名项，其余照常搬运。
 *
 * 用受控的 `NModal` 而非 `useDialog()`：文件树在每个 WorkspaceHost 里各有一
 * 份，dialog provider 是全局单例，走它会把冲突弹到别的工作区去；而且受控
 * 写法能直接断言"选了哪个策略"，比 promise 更好测。
 */
export type ConflictRequest = {
  targetDir: string;
  conflicts: TransferPlan["conflicts"];
  /** 其中有多少条是目录（覆盖会递归删除整个目录）。 */
  dirCount: number;
};

const props = defineProps<{
  /** 待处理冲突；null 表示不显示。 */
  request: ConflictRequest | null;
}>();

const emit = defineEmits<{
  resolve: [policy: FsConflictPolicy];
  cancel: [];
}>();

/** 覆盖目录需要显式勾选；覆盖纯文件不需要。 */
const overwriteConfirmed = ref(false);

// 每次新的冲突请求都重置确认状态 —— 上一轮的勾选不能顺延到下一轮。
watch(
  () => props.request,
  () => {
    overwriteConfirmed.value = false;
  },
);

const count = computed(() => props.request?.conflicts.length ?? 0);
const hasDirConflict = computed(() => (props.request?.dirCount ?? 0) > 0);
const overwriteBlocked = computed(
  () => hasDirConflict.value && !overwriteConfirmed.value,
);

const sampleNames = computed(() => {
  const conflicts = props.request?.conflicts ?? [];
  const shown = conflicts.slice(0, 5).map((conflict) => basename(conflict.existingTo));
  const rest = conflicts.length - shown.length;
  return rest > 0
    ? `${shown.join("、")}${t("explorer.conflictMore", { count: rest })}`
    : shown.join("、");
});

function resolve(policy: FsConflictPolicy): void {
  emit("resolve", policy);
}
</script>

<template>
  <NModal
    v-if="request"
    :show="true"
    preset="card"
    :title="t('explorer.conflictTitle', { count })"
    class="w-[380px] max-w-[92vw]"
    data-transfer-conflict
    @update:show="(show: boolean) => { if (!show) emit('cancel'); }"
  >
    <div class="space-y-2.5 text-[12px] leading-relaxed">
      <p class="m-0">
        {{
          hasDirConflict
            ? t("explorer.conflictDetailWithDirs", {
                count,
                dirs: request.dirCount,
                dir: basename(request.targetDir),
              })
            : t("explorer.conflictDetail", {
                count,
                dir: basename(request.targetDir),
              })
        }}
      </p>
      <p class="m-0 truncate text-[11px] text-muted-foreground" :title="request.targetDir">
        {{ request.targetDir }}
      </p>
      <p v-if="sampleNames" class="m-0 truncate text-[11px] text-muted-foreground">
        {{ sampleNames }}
      </p>
      <NCheckbox
        v-if="hasDirConflict"
        :checked="overwriteConfirmed"
        data-confirm-overwrite-dirs
        @update:checked="(value: boolean) => (overwriteConfirmed = value)"
      >
        {{ t("explorer.confirmOverwriteDirs") }}
      </NCheckbox>
    </div>
    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <NButton size="small" quaternary data-conflict-skip @click="resolve('skip')">
          {{ t("explorer.conflictSkipAll") }}
        </NButton>
        <NButton
          size="small"
          type="warning"
          data-conflict-overwrite
          :disabled="overwriteBlocked"
          @click="resolve('overwrite')"
        >
          {{ t("explorer.conflictOverwriteAll") }}
        </NButton>
        <NButton
          size="small"
          type="primary"
          data-conflict-rename
          @click="resolve('rename')"
        >
          {{ t("explorer.conflictRenameAll") }}
        </NButton>
      </div>
    </template>
  </NModal>
</template>
