import { i18n } from "./index";
import type { MessageSchema } from "./index";

type Params = Record<string, unknown>;

// key 的字面量联合由 en-US 消息树推导（MessageSchema）：拼写错误的 key
// 无法通过类型检查。动态拼出的模板字符串 key（如 `app.status.toggle.${k}`）
// 会推导出字面量联合的子集，仍然可用。运行时仍保留 string 兜底以兼容
// 少数无法静态化的场景（经 as string 显式转换）。
export type MessageKey = FlattenMessageKeys<MessageSchema>;

type FlattenMessageKeys<T> = T extends string
  ? never
  : { [K in keyof T & string]: T[K] extends string ? K : `${K}.${FlattenMessageKeys<T[K]>}` }[keyof T & string];

export function t(key: MessageKey, params?: Params): string {
  // Keep template render functions subscribed to the active global locale.
  void i18n.global.locale.value;
  const translate = i18n.global.t as (key: string, params?: Params) => string;
  return translate(key, params);
}

/**
 * 宽松版 t：key 为运行期字符串（命令 spec 的 titleKey 注入、动态模板键等
 * 无法静态化的场景）。字面量调用点请用严格版 `t`，拼写错误可在编译期暴露。
 */
export function tLoose(key: string, params?: Params): string {
  const translate = i18n.global.t as (key: string, params?: Params) => string;
  return translate(key, params);
}

export function currentLocale(): string {
  return i18n.global.locale.value;
}
