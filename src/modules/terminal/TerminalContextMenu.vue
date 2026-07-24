<script setup lang="ts">
import { NButton } from "naive-ui";
import { onBeforeUnmount, onMounted, ref } from "vue";

defineProps<{
  x: number;
  y: number;
  selection: string;
}>();

const emit = defineEmits<{
  close: [];
  copy: [];
  paste: [];
  selectAll: [];
}>();

const menuElement = ref<HTMLElement | null>(null);

function handleOutsidePointerDown(event: Event) {
  const node = event.target instanceof Node ? event.target : null;
  if (node && menuElement.value?.contains(node)) return;
  emit("close");
}

function handleGlobalKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}

onMounted(() => {
  window.addEventListener("pointerdown", handleOutsidePointerDown, true);
  window.addEventListener("keydown", handleGlobalKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
  window.removeEventListener("keydown", handleGlobalKeydown);
});
</script>

<template>
  <div
    ref="menuElement"
    class="nexterm-overlay fixed z-50 min-w-32 p-1 text-[12px]"
    :style="{ top: `${y}px`, left: `${x}px` }"
    @contextmenu.prevent
  >
    <NButton
      text
      block
      size="tiny"
      :disabled="!selection"
     
      @click="emit('copy')"
    >
      Copy
    </NButton>
    <NButton
      text
      block
      size="tiny"
     
      @click="emit('paste')"
    >
      Paste
    </NButton>
    <NButton
      text
      block
      size="tiny"
     
      @click="emit('selectAll')"
    >
      Select All
    </NButton>
  </div>
</template>