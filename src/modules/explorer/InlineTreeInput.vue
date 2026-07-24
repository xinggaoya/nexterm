<script setup lang="ts">
import { NInput, type InputInst } from "naive-ui";
import { nextTick, onMounted, ref } from "vue";

const props = withDefaults(
  defineProps<{
    initial: string;
    placeholder?: string;
  }>(),
  {
    placeholder: "",
  },
);

const emit = defineEmits<{
  commit: [value: string];
  cancel: [];
}>();

const inputRef = ref<InputInst | null>(null);
const value = ref(props.initial);
let done = false;

function commit() {
  if (done) return;
  done = true;
  emit("commit", value.value);
}

function cancel() {
  if (done) return;
  done = true;
  emit("cancel");
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    commit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    cancel();
  }
}

function handleBlur() {
  commit();
}

function focusAndSelect() {
  const inst = inputRef.value;
  if (!inst) return;
  // InputInst exposes the native input through `inputElRef` (Naive UI v2.44+).
  const el = inst.inputElRef ?? null;
  if (!el) return;
  el.focus({ preventScroll: true });
  const dot = props.initial.lastIndexOf(".");
  if (dot > 0) el.setSelectionRange(0, dot);
  else el.select();
}

onMounted(() => {
  void nextTick(focusAndSelect);
});
</script>

<template>
  <NInput
    ref="inputRef"
    v-model:value="value"
    size="tiny"
    :placeholder="placeholder"
    :input-props="{
      'data-inline-tree-input': '',
      onKeydown: handleKeydown,
      onBlur: handleBlur,
    } as Record<string, unknown>"
  />
</template>