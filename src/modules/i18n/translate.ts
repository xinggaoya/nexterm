import { i18n } from "./index";

type Params = Record<string, unknown>;

export function t(key: string, params?: Params): string {
  // Keep template render functions subscribed to the active global locale.
  void i18n.global.locale.value;
  const translate = i18n.global.t as (key: string, params?: Params) => string;
  return translate(key, params);
}

export function currentLocale(): string {
  return i18n.global.locale.value;
}
