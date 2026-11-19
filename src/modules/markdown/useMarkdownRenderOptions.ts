import { computed, type ComputedRef } from "vue";
import { t } from "@/modules/i18n/translate";
import type { MarkdownRenderOptions } from "./lib/markdownRenderer";

/**
 * Markdown 渲染需要的界面文案。
 *
 * 渲染器产出的是静态 HTML，代码块复制按钮的无障碍标签、GFM alert 的标题
 * 都要在渲染时写进标记里，所以文案必须跟着语言切换走。
 */
export function useMarkdownRenderOptions(): ComputedRef<MarkdownRenderOptions> {
  return computed(() => ({
    copyLabel: t("markdown.copyCode"),
    alertTitles: {
      note: t("markdown.alertNote"),
      tip: t("markdown.alertTip"),
      important: t("markdown.alertImportant"),
      warning: t("markdown.alertWarning"),
      caution: t("markdown.alertCaution"),
    },
  }));
}
