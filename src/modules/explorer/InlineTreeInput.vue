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
  <!--
    blur 必须绑在 NInput 组件级 prop 上：Naive UI 渲染原生 <input> 时是
    `{ ...inputProps, onBlur: handleInputBlur }`，input-props 里的 onBlur 会被
    内部处理器覆盖而永不触发；keydown 没有内部覆盖，留在 input-props 即可。
  -->
  <NInput
    ref="inputRef"
    v-model:value="value"
    size="tiny"
    :placeholder="placeholder"
    :input-props="{
      'data-inline-tree-input': '',
      onKeydown: handleKeydown,
    } as Record<string, unknown>"
    @blur="handleBlur"
  />
</template>