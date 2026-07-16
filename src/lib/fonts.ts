const NERD_FONT_CANDIDATES = [
  "JetBrainsMono Nerd Font",
  "JetBrainsMono Nerd Font Mono",
  "JetBrainsMonoNL Nerd Font",
  "FiraCode Nerd Font",
  "FiraCode Nerd Font Mono",
  "MesloLGS NF",
  "MesloLGM Nerd Font",
  "Hack Nerd Font",
  "Hack Nerd Font Mono",
  "CaskaydiaCove Nerd Font",
  "CaskaydiaMono Nerd Font",
  "Iosevka Nerd Font",
  "Iosevka Term Nerd Font",
  "SauceCodePro Nerd Font",
  "Hasklug Nerd Font",
];

export const NERD_SYMBOL_FONT_FAMILY = "Pure Nerd Font";
export const DEFAULT_MONO_FONT_FAMILY =
  '"JetBrains Mono", "Pure Nerd Font", SFMono-Regular, Menlo, monospace';

const FALLBACK_CHAIN = DEFAULT_MONO_FONT_FAMILY;

let detected: string | null = null;
let monoReady: Promise<void> | null = null;

export function ensureMonoFontsLoaded(): Promise<void> {
  if (monoReady) return monoReady;
  if (typeof document === "undefined" || !document.fonts?.load) {
    monoReady = Promise.resolve();
    return monoReady;
  }
  monoReady = Promise.allSettled([
    document.fonts.load('400 14px "JetBrains Mono"'),
    document.fonts.load('700 14px "JetBrains Mono"'),
    document.fonts.load('400 14px "Pure Nerd Font"', "\ue0b0\uf120"),
  ]).then(() => undefined);
  return monoReady;
}

export async function ensureFontFamilyLoaded(
  fontFamily: string,
  fontSize: number,
): Promise<void> {
  if (typeof document === "undefined" || !document.fonts?.load) return;
  await Promise.allSettled([
    document.fonts.load(`400 ${fontSize}px ${fontFamily}`, "MW\u2500\u2502"),
    document.fonts.load(`700 ${fontSize}px ${fontFamily}`, "MW\u2500\u2502"),
    document.fonts.load(
      `400 ${fontSize}px ${fontFamily}`,
      "\ue0b0\ue0b1\uf120",
    ),
  ]);
}

export function buildTerminalFontFamily(preferred: string): string {
  const trimmed = preferred.trim();
  if (!trimmed || trimmed === "JetBrains Mono") return DEFAULT_MONO_FONT_FAMILY;
  if (trimmed === NERD_SYMBOL_FONT_FAMILY) return FALLBACK_CHAIN;
  const quoted = `"${trimmed.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  return `${quoted}, ${FALLBACK_CHAIN}`;
}

export function detectMonoFontFamily(): string {
  if (detected) return detected;
  if (typeof document === "undefined" || !document.fonts) {
    detected = FALLBACK_CHAIN;
    return detected;
  }
  for (const f of NERD_FONT_CANDIDATES) {
    try {
      if (document.fonts.check(`12px "${f}"`)) {
        detected = `"${f}", ${FALLBACK_CHAIN}`;
        return detected;
      }
    } catch {
      // Some browsers throw on invalid font shorthand; ignore.
    }
  }
  detected = FALLBACK_CHAIN;
  return detected;
}
