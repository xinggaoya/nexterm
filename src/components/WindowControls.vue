<script setup lang="ts">
import { CopyOutline, CloseOutline, RemoveOutline, SquareOutline } from "@vicons/ionicons5";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { NIcon } from "naive-ui";
import { onMounted, onUnmounted, ref } from "vue";
import { USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { t } from "@/modules/i18n/translate";
import NextermIconButton from "./NextermIconButton.vue";
import TooltipTitle from "./TooltipTitle.vue";

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
      <TooltipTitle :label="t('app.windowControls.minimize')">
        <NextermIconButton
          :aria-label="t('app.windowControls.minimize')"
          @click="windowRef.minimize()"
        >
          <NIcon :component="RemoveOutline" :size="13" />
        </NextermIconButton>
      </TooltipTitle>
      <TooltipTitle :label="maximized ? t('app.windowControls.restore') : t('app.windowControls.maximize')">
        <NextermIconButton
          :aria-label="maximized ? t('app.windowControls.restore') : t('app.windowControls.maximize')"
          @click="windowRef.toggleMaximize()"
        >
          <NIcon :component="maximized ? CopyOutline : SquareOutline" :size="13" />
        </NextermIconButton>
      </TooltipTitle>
    </template>
    <TooltipTitle :label="t('app.windowControls.close')">
      <NextermIconButton
        :aria-label="t('app.windowControls.close')"
        class="hover:!bg-destructive/15 hover:!text-destructive"
        @click="windowRef.close()"
      >
        <NIcon :component="CloseOutline" :size="15" />
      </NextermIconButton>
    </TooltipTitle>
  </div>
</template>