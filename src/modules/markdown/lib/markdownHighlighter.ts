import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import go from "highlight.js/lib/languages/go";
import graphql from "highlight.js/lib/languages/graphql";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import lua from "highlight.js/lib/languages/lua";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import plaintext from "highlight.js/lib/languages/plaintext";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { LanguageFn } from "highlight.js";

/**
 * 代码高亮。
 *
 * 用 highlight.js（GitHub 自己用的也是它），但只注册 README 里真正会出现的
 * 语言子集：全量包会把 ~200 个语言打进产物，对一个终端 IDE 毫无意义。
 * 语言别名（sh / yml / ts …）由各语言模块在注册时一并登记。
 */
const LANGUAGE_MODULES: Record<string, LanguageFn> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  markdown,
  php,
  plaintext,
  powershell,
  python,
  ruby,
  rust,
  scss,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};

let registered = false;

function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  for (const [name, definition] of Object.entries(LANGUAGE_MODULES)) {
    hljs.registerLanguage(name, definition);
  }
}

/**
 * 高亮一段代码。
 *
 * 返回 highlight.js 产出的 HTML（内部已转义，只有 `<span class="hljs-*">`
 * 是我们自己加的标签）；语言未知或为空时返回 null，由调用方退回纯文本。
 */
export function highlightCode(code: string, language: string): string | null {
  const name = language.trim().toLowerCase();
  if (!name) return null;
  ensureRegistered();
  if (!hljs.getLanguage(name)) return null;
  return hljs.highlight(code, { language: name, ignoreIllegals: true }).value;
}
