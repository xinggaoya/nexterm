<script setup lang="ts">
import type { InputInst } from "naive-ui";
import { NInput, NModal } from "naive-ui";
import { nextTick, ref, watch } from "vue";
import { t } from "@/modules/i18n/translate";

const props = defineProps<{
  show: boolean;
  currentTitle: string;
}>();

const emit = defineEmits<{
  submit: [title: string];
  cancel: [];
}>();

const inputRef = ref<InputInst | null>(null);
const value = ref("");

watch(
  () => props.show,
  (show) => {
    if (!show) return;
    value.value = props.currentTitle;
    nextTick(() => {
      const inst = inputRef.value;
      if (!inst) return;
      inst.focus();
      inst.select();
    });
  },
);

function commit() {
  const next = value.value.trim();
  if (!next || next === props.currentTitle) {
    emit("cancel");
    return;
  }
  emit("submit", next);
}
</script>

<template>
  <NModal
    :show="show"
    preset="card"
    :title="t('terminal.rename')"
    :bordered="false"
    :auto-focus="false"
    :mask-closable="true"
    class="max-w-[420px]"
    @update:show="(s) => { if (!s) emit('cancel'); }"
  >
    <NInput
      ref="inputRef"
      v-model:value="value"
      :placeholder="t('terminal.renamePlaceholder')"
      @keyup.enter="commit"
      @keyup.esc="emit('cancel')"
    />
  </NModal>
</template>
