import { nextTick } from "vue";
import { createI18n } from "vue-i18n";
import enUS from "./locales/en-US";
import {
  readSystemLanguages,
  resolveAppLocale,
  type AppLocale,
  type LanguagePref,
} from "./types";

type WidenMessages<T> = {
  readonly [K in keyof T]: T[K] extends string ? string : WidenMessages<T[K]>;
};

export type MessageSchema = WidenMessages<typeof enUS>;

type LocaleModule = {
  default: MessageSchema;
};

const localeLoaders: Record<AppLocale, () => Promise<LocaleModule>> = {
  "en-US": async () => ({ default: enUS }),
  "zh-CN": () => import("./locales/zh-CN"),
};

const loadedLocales = new Set<AppLocale>(["en-US"]);

export const i18n = createI18n<MessageSchema, AppLocale, false>({
  legacy: false,
  locale: "en-US",
  fallbackLocale: "en-US",
  messages: {
    "en-US": enUS,
  } as unknown as Record<AppLocale, MessageSchema>,
  missingWarn: false,
  fallbackWarn: false,
});

export async function ensureLocaleMessages(locale: AppLocale): Promise<void> {
  if (loadedLocales.has(locale)) return;
  const messages = await localeLoaders[locale]();
  i18n.global.setLocaleMessage(locale, messages.default);
  loadedLocales.add(locale);
}

export function setI18nLanguage(locale: AppLocale): void {
  i18n.global.locale.value = locale;
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("lang", locale);
  }
}

export async function applyLanguagePreference(
  preference: LanguagePref,
  systemLanguages: readonly string[] = readSystemLanguages(),
): Promise<AppLocale> {
  const locale = resolveAppLocale(preference, systemLanguages);
  setI18nLanguage(locale);
  await ensureLocaleMessages(locale);
  setI18nLanguage(locale);
  await nextTick();
  return locale;
}
