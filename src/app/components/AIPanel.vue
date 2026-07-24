<script setup lang="ts">
/**
 * Assistant panel — v2 UI placeholder.
 *
 * This is a visual shell only (header, conversation area, input box) with a
 * "coming soon" state. It intentionally contains NO model/provider/IPC logic
 * so it stays compatible with the project's no-AI-backend boundary. When a
 * future decision re-introduces assistant capabilities, the contract lives in
 * docs/architecture and this component swaps the placeholder for a live view.
 */
import { SparklesOutline, SendOutline, CloseOutline } from "@vicons/ionicons5";
import { NIcon } from "naive-ui";
import { ref } from "vue";
import NextermIconButton from "@/components/NextermIconButton.vue";
import { t } from "@/modules/i18n/translate";

const emit = defineEmits<{
  close: [];
}>();

const draft = ref("");

function handleSend() {
  // Placeholder — no backend. Input is cleared to give feedback.
  draft.value = "";
}
</script>

<template>
  <aside
    data-ai-panel
    class="v2-glass flex h-full w-full flex-col overflow-hidden"
  >
    <!-- Header -->
    <header class="flex h-10 shrink-0 items-center justify-between border-b border-border/60 px-3">
      <div class="flex items-center gap-2">
        <NIcon :component="SparklesOutline" :size="15" class="text-primary" />
        <span class="text-[12px] font-semibold tracking-tight text-foreground">
          {{ t("app.ai.title") }}
        </span>
      </div>
      <NextermIconButton
        class="!size-6"
        :aria-label="t('app.ai.close')"
        @click="emit('close')"
      >
        <NIcon :component="CloseOutline" :size="14" />
      </NextermIconButton>
    </header>

    <!-- Conversation area -->
    <div class="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
      <div class="v2-dot-glow v2-anim-breathe mb-4 size-9 rounded-full bg-primary/15" />
      <h3 class="text-sm font-medium text-foreground">
        {{ t("app.ai.comingSoon") }}
      </h3>
      <p class="mt-2 max-w-[260px] text-[12px] leading-relaxed text-muted-foreground">
        {{ t("app.ai.description") }}
      </p>
    </div>

    <!-- Input box -->
    <div class="shrink-0 border-t border-border/60 p-2.5">
      <div class="flex items-end gap-2 rounded-[8px] border border-border bg-surface-subtle/50 px-2.5 py-2">
        <textarea
          v-model="draft"
          rows="1"
          :placeholder="t('app.ai.placeholder')"
          class="max-h-24 min-h-[20px] flex-1 resize-none bg-transparent text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          @keydown.enter.prevent="handleSend"
        />
        <button
          type="button"
          class="grid size-6 shrink-0 place-items-center rounded-[4px] bg-primary text-primary-foreground transition-opacity duration-[var(--dur-fast)] disabled:opacity-40"
          :disabled="!draft.trim()"
          :aria-label="t('app.ai.send')"
          @click="handleSend"
        >
          <NIcon :component="SendOutline" :size="13" />
        </button>
      </div>
    </div>
  </aside>
</template>
