export const SUPPORTED_LANGUAGE_PREFS = ["system", "zh-CN", "en-US"] as const;
export const SUPPORTED_LOCALES = ["zh-CN", "en-US"] as const;

export type LanguagePref = (typeof SUPPORTED_LANGUAGE_PREFS)[number];
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export function readSystemLanguages(): string[] {
  if (typeof navigator === "undefined") return [];
  const languages = navigator.languages?.length
    ? Array.from(navigator.languages)
    : [];
  if (navigator.language) languages.push(navigator.language);
  return languages;
}

export function resolveAppLocale(
  preference: LanguagePref,
  systemLanguages: readonly string[] = readSystemLanguages(),
): AppLocale {
  if (preference !== "system") return preference;
  const normalized = systemLanguages.map((language) => language.toLowerCase());
  return normalized.some(
    (language) => language === "zh" || language.startsWith("zh-"),
  )
    ? "zh-CN"
    : "en-US";
}
