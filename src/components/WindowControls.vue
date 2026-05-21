<script setup lang="ts">
import { CopyOutline, CloseOutline, RemoveOutline, SquareOutline } from "@vicons/ionicons5";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NIcon } from "naive-ui";
import { onMounted, onUnmounted, ref } from "vue";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";

const props = defineProps<{
  closeOnly?: boolean;
}>();

const maximized = ref(false);
const windowRef = getCurrentWindow();
let unlisten: (() => void) | undefined;

onMounted(() => {
  if (!USE_CUSTOM_WINDOW_CONTROLS || props.closeOnly) return;
  void windowRef.isMaximized().then((value) => {
    maximized.value = value;
  });
  void windowRef.onResized(() => {
    void windowRef.isMaximized().then((value) => {
      maximized.value = value;
    });
  }).then((fn) => {
    unlisten = fn;
  });
});

onUnmounted(() => {
  unlisten?.();
});
</script>

<template>
  <div
    v-if="USE_CUSTOM_WINDOW_CONTROLS"
    class="flex h-full shrink-0 items-center gap-0.5 pr-1"
  >
    <template v-if="!closeOnly">
      <button
        type="button"
        aria-label="Minimize"
        title="Minimize"
        class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        @click="windowRef.minimize()"
      >
        <NIcon :component="RemoveOutline" :size="13" />
      </button>
      <button
        type="button"
        :aria-label="maximized ? 'Restore' : 'Maximize'"
        :title="maximized ? 'Restore' : 'Maximize'"
        class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        @click="windowRef.toggleMaximize()"
      >
        <NIcon :component="maximized ? CopyOutline : SquareOutline" :size="13" />
      </button>
    </template>
    <button
      type="button"
      aria-label="Close"
      title="Close"
      class="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
      @click="windowRef.close()"
    >
      <NIcon :component="CloseOutline" :size="15" />
    </button>
  </div>
</template>
