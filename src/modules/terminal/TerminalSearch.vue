<script setup lang="ts">
import { NButton, NInput, type InputInst } from "naive-ui";
import { nextTick, ref, watch } from "vue";

const props = defineProps<{
  visible: boolean;
}>();

const emit = defineEmits<{
  close: [];
  search: [query: string];
}>();

const query = ref("");
const inputRef = ref<InputInst | null>(null);

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      await nextTick();
      inputRef.value?.focus();
      inputRef.value?.select();
    } else {
      query.value = "";
    }
  },
);

watch(query, (q) => emit("search", q));

function handleKey(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  } else if (event.key === "Enter") {
    event.preventDefault();
    emit("search", query.value);
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="nexterm-overlay absolute top-9 right-4 z-30 flex items-center gap-1 p-1.5"
    @keydown="handleKey"
  >
    <NInput
      ref="inputRef"
      v-model:value="query"
      size="small"
      placeholder="Search…"
      class="!w-48"
      @keydown="handleKey"
    />
    <NButton
      quaternary
      circle
      size="tiny"
      aria-label="Close search"
      @click="emit('close')"
    >
      <span class="text-base leading-none">×</span>
    </NButton>
  </div>
</template>