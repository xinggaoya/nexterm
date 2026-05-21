<script setup lang="ts">
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

const inputRef = ref<HTMLInputElement | null>(null);
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

onMounted(() => {
  void nextTick(() => {
    const input = inputRef.value;
    if (!input) return;
    input.focus({ preventScroll: true });
    const dot = props.initial.lastIndexOf(".");
    if (dot > 0) input.setSelectionRange(0, dot);
    else input.select();
  });
});
</script>

<template>
  <input
    ref="inputRef"
    v-model="value"
    data-inline-tree-input
    :placeholder="placeholder"
    class="min-w-0 flex-1 truncate rounded-sm border border-border bg-background px-1.5 py-0.5 text-[12px] text-foreground outline-none focus:border-ring"
    @keydown="handleKeydown"
    @blur="commit"
  />
</template>
