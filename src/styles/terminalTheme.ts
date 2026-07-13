/**
 * Compatibility re-export. v2 moved terminal theming into
 * `modules/terminal/lib/theme.ts`. This file keeps the previous import
 * surface (used by editor syntax highlighting and MainApp theme sync)
 * working without churn outside the terminal module.
 */

export {
  buildTerminalTheme,
  applyTerminalTheme,
  watchTerminalTheme,
} from "@/modules/terminal/lib/theme";
