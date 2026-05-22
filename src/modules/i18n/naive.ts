import { dateEnUS, dateZhCN, enUS, zhCN } from "naive-ui";
import type { AppLocale } from "./types";

export function getNaiveLocaleConfig(locale: AppLocale) {
  return locale === "zh-CN"
    ? { locale: zhCN, dateLocale: dateZhCN }
    : { locale: enUS, dateLocale: dateEnUS };
}
