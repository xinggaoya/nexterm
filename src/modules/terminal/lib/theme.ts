/**
 * Theme integration between the app's CSS variables and xterm.js.
 *
 * xterm accepts a string per color slot, and `getComputedStyle` returns the
 * oklch variables declared in globals.css already resolved to `rgb(...)` /
 * `#rrggbb` by the browser, so no manual color-space conversion is needed.
 *
 * Listening to the document element lets us pick up both light/dark toggles
 * (.dark class) and any future token mutations triggered by the Settings
 * drawer without re-rendering the terminal UI.
 */

import type { ITheme } from "@xterm/xterm";

const THEME_VARIABLES = [
  "--term-bg",
  "--term-fg",
  "--term-cursor",
  "--term-cursor-accent",
  "--term-selection",
  "--term-black",
  "--term-red",
  "--term-green",
  "--term-yellow",
  "--term-blue",
  "--term-magenta",
  "--term-cyan",
  "--term-white",
  "--term-bright-black",
  "--term-bright-red",
  "--term-bright-green",
  "--term-bright-yellow",
  "--term-bright-blue",
  "--term-bright-magenta",
  "--term-bright-cyan",
  "--term-bright-white",
] as const;

function readCssVars(): Record<(typeof THEME_VARIABLES)[number], string> {
  const styles = getComputedStyle(document.documentElement);
  const result = {} as Record<(typeof THEME_VARIABLES)[number], string>;
  for (const name of THEME_VARIABLES) {
    result[name] = styles.getPropertyValue(name).trim();
  }
  return result;
}

export function buildTerminalTheme(): ITheme {
  const v = readCssVars();
  return {
    background: v["--term-bg"],
    foreground: v["--term-fg"],
    cursor: v["--term-cursor"],
    cursorAccent: v["--term-cursor-accent"],
    selectionBackground: v["--term-selection"],
    black: v["--term-black"],
    red: v["--term-red"],
    green: v["--term-green"],
    yellow: v["--term-yellow"],
    blue: v["--term-blue"],
    magenta: v["--term-magenta"],
    cyan: v["--term-cyan"],
    white: v["--term-white"],
    brightBlack: v["--term-bright-black"],
    brightRed: v["--term-bright-red"],
    brightGreen: v["--term-bright-green"],
    brightYellow: v["--term-bright-yellow"],
    brightBlue: v["--term-bright-blue"],
    brightMagenta: v["--term-bright-magenta"],
    brightCyan: v["--term-bright-cyan"],
    brightWhite: v["--term-bright-white"],
  };
}

export function applyTerminalTheme(target: { options: { theme?: ITheme } }): void {
  target.options.theme = buildTerminalTheme();
}

export function watchTerminalTheme(callback: () => void): () => void {
  const observer = new MutationObserver(() => callback());
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  return () => observer.disconnect();
}
