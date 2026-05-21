/**
 * Runtime resolution of shadcn CSS custom properties into concrete rgb strings.
 *
 * globals.css declares tokens in oklch(), which xterm.js (WebGL) and
 * CodeMirror's static theme builder can't consume directly. We resolve each
 * token through the browser, then normalize modern color syntax into rgb/rgba.
 * Recent Chromium builds can preserve oklch() in getComputedStyle(), while
 * Naive UI's color helpers still expect legacy color strings.
 *
 * Tokens are read once per call. Callers that need to react to theme changes
 * (light/dark toggle) should re-invoke and rebuild their theme object.
 */

type TokenName =
  | "background"
  | "foreground"
  | "card"
  | "muted"
  | "muted-foreground"
  | "accent"
  | "accent-foreground"
  | "border"
  | "primary"
  | "destructive"
  | "ring";

export type AppTokens = Record<TokenName, string>;

const TOKENS: TokenName[] = [
  "background",
  "foreground",
  "card",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "primary",
  "destructive",
  "ring",
];

const FALLBACK_TOKENS: AppTokens = {
  background: "rgb(255, 255, 255)",
  foreground: "rgb(24, 24, 27)",
  card: "rgb(255, 255, 255)",
  muted: "rgb(244, 244, 245)",
  "muted-foreground": "rgb(113, 113, 122)",
  accent: "rgb(244, 244, 245)",
  "accent-foreground": "rgb(24, 24, 27)",
  border: "rgb(228, 228, 231)",
  primary: "rgb(24, 24, 27)",
  destructive: "rgb(239, 68, 68)",
  ring: "rgb(161, 161, 170)",
};

let probe: HTMLDivElement | null = null;

function resolve(varName: TokenName): string {
  if (!probe) {
    probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
  }
  if (!probe.isConnected) {
    document.body.appendChild(probe);
  }
  probe.style.color = `var(--${varName})`;
  return getComputedStyle(probe).color;
}

export function readAppTokens(): AppTokens {
  const out = {} as AppTokens;
  for (const name of TOKENS) out[name] = resolve(name);
  return normalizeAppTokens(out);
}

export function normalizeAppTokens(tokens: AppTokens): AppTokens {
  const out = {} as AppTokens;
  for (const name of TOKENS) {
    out[name] = normalizeCssColor(tokens[name], FALLBACK_TOKENS[name]);
  }
  return out;
}

function normalizeCssColor(color: string, fallback: string): string {
  const trimmed = color.trim();
  if (isSeemlyCompatibleColor(trimmed)) return trimmed;

  const oklch = parseOklch(trimmed);
  if (oklch) return oklchToRgbString(oklch);

  return fallback;
}

function isSeemlyCompatibleColor(color: string): boolean {
  return /^rgba?\(\s*\d/.test(color) || /^#[0-9a-f]{3,8}$/i.test(color);
}

type OklchColor = {
  lightness: number;
  chroma: number;
  hue: number;
  alpha: number;
};

function parseOklch(color: string): OklchColor | null {
  const match = /^oklch\(\s*(.*?)\s*\)$/i.exec(color);
  if (!match) return null;

  const slashIndex = match[1].indexOf("/");
  const colorPart =
    slashIndex === -1 ? match[1] : match[1].slice(0, slashIndex);
  const alphaPart = slashIndex === -1 ? null : match[1].slice(slashIndex + 1);
  const parts = colorPart.replace(/,/g, " ").trim().split(/\s+/);
  if (parts.length < 3) return null;

  const lightness = parseLightness(parts[0]);
  const chroma = parseChroma(parts[1]);
  const hue = parseHue(parts[2]);
  const alpha = alphaPart ? parseAlpha(alphaPart.trim()) : 1;

  if (![lightness, chroma, hue, alpha].every(Number.isFinite)) return null;

  return {
    lightness,
    chroma,
    hue,
    alpha: clamp(alpha, 0, 1),
  };
}

function parseLightness(value: string): number {
  return value.endsWith("%") ? Number.parseFloat(value) / 100 : Number(value);
}

function parseChroma(value: string): number {
  return value.endsWith("%")
    ? (Number.parseFloat(value) / 100) * 0.4
    : Number(value);
}

function parseHue(value: string): number {
  if (value === "none") return 0;
  if (value.endsWith("turn")) return Number.parseFloat(value) * 360;
  if (value.endsWith("rad")) return Number.parseFloat(value) * (180 / Math.PI);
  if (value.endsWith("grad")) return Number.parseFloat(value) * 0.9;
  return Number.parseFloat(value);
}

function parseAlpha(value: string): number {
  return value.endsWith("%") ? Number.parseFloat(value) / 100 : Number(value);
}

function oklchToRgbString(color: OklchColor): string {
  const hueRad = (color.hue * Math.PI) / 180;
  const a = color.chroma * Math.cos(hueRad);
  const b = color.chroma * Math.sin(hueRad);

  const l_ =
    color.lightness + 0.3963377774 * a + 0.2158037573 * b;
  const m_ =
    color.lightness - 0.1055613458 * a - 0.0638541728 * b;
  const s_ =
    color.lightness - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = encodeRgbChannel(
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
  );
  const g = encodeRgbChannel(
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
  );
  const blue = encodeRgbChannel(
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  );

  if (color.alpha >= 1) return `rgb(${r}, ${g}, ${blue})`;
  return `rgba(${r}, ${g}, ${blue}, ${formatAlpha(color.alpha)})`;
}

function encodeRgbChannel(linear: number): number {
  const clamped = clamp(linear, 0, 1);
  const encoded =
    clamped <= 0.0031308
      ? 12.92 * clamped
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

function formatAlpha(value: number): string {
  return `${Math.round(value * 1000) / 1000}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
