import { ALT_KEY, CTRL_KEY, KEY_SEP, SHIFT_KEY } from "@/lib/platform";
import type {
  CommandDefinition,
  CommandId,
  KeybindingConflict,
  KeybindingOverrides,
  ResolvedKeybindings,
} from "./types";

const MODIFIER_ORDER = ["Mod", "Ctrl", "Alt", "Shift"] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

function normalizeToken(token: string): Modifier | string | null {
  const value = token.trim();
  if (!value) return null;
  const lower = value.toLowerCase();
  if (["mod", "cmd", "command", "meta", "super", "win"].includes(lower)) {
    return "Mod";
  }
  if (["ctrl", "control", "ctl"].includes(lower)) return "Ctrl";
  if (["alt", "option", "opt"].includes(lower)) return "Alt";
  if (["shift", "shft"].includes(lower)) return "Shift";
  if (lower === "escape" || lower === "esc") return "Escape";
  if (lower === "enter" || lower === "return") return "Enter";
  if (lower === "space" || lower === "spacebar") return "Space";
  if (lower === "tab") return "Tab";
  if (lower === "backspace") return "Backspace";
  if (lower === "delete" || lower === "del") return "Delete";
  if (/^f\d{1,2}$/i.test(value)) return value.toUpperCase();
  if (value.length === 1) return value.toUpperCase();
  return value[0]?.toUpperCase() + value.slice(1);
}

function keyFromEvent(event: KeyboardEvent): string {
  const key = event.key;
  if (key === " ") return "Space";
  if (key.length === 1) return key.toUpperCase();
  return normalizeToken(key) ?? key;
}

export function normalizeKeybinding(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const expanded = raw
    .replace(/⌘/g, " Cmd ")
    .replace(/⌃/g, " Ctrl ")
    .replace(/⌥/g, " Alt ")
    .replace(/⇧/g, " Shift ");
  const tokens = expanded
    .trim()
    .split(/[+\s]+/)
    .map(normalizeToken)
    .filter((token): token is Modifier | string => !!token);
  if (tokens.length === 0) return null;

  const modifiers = new Set<Modifier>();
  let key: string | null = null;
  for (const token of tokens) {
    if ((MODIFIER_ORDER as readonly string[]).includes(token)) {
      modifiers.add(token as Modifier);
    } else {
      key = token;
    }
  }
  if (!key) return null;
  return [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    key,
  ].join("+");
}

export function buildResolvedKeybindings(
  commands: CommandDefinition[],
  overrides: KeybindingOverrides,
): ResolvedKeybindings {
  return Object.fromEntries(
    commands.map((command) => [
      command.id,
      command.id in overrides
        ? normalizeKeybinding(overrides[command.id])
        : normalizeKeybinding(command.defaultKeybinding),
    ]),
  ) as ResolvedKeybindings;
}

export function findKeybindingConflicts(
  commands: CommandDefinition[],
  keybindings: Partial<Record<CommandId, string | null>>,
): KeybindingConflict[] {
  const knownIds = new Set(commands.map((command) => command.id));
  const idsByKey = new Map<string, CommandId[]>();
  for (const [id, binding] of Object.entries(keybindings) as [
    CommandId,
    string | null,
  ][]) {
    if (!knownIds.has(id) || !binding) continue;
    const normalized = normalizeKeybinding(binding);
    if (!normalized) continue;
    idsByKey.set(normalized, [...(idsByKey.get(normalized) ?? []), id]);
  }
  return [...idsByKey.entries()]
    .filter(([, commandIds]) => commandIds.length > 1)
    .map(([keybinding, commandIds]) => ({ keybinding, commandIds }));
}

export function formatKeybinding(
  keybinding: string | null | undefined,
  isMac: boolean,
): string {
  const normalized = normalizeKeybinding(keybinding);
  if (!normalized) return "";
  const labels = normalized.split("+").map((part) => {
    if (part === "Mod") return isMac ? "⌘" : "Ctrl";
    if (part === "Ctrl") return isMac ? "⌃" : CTRL_KEY;
    if (part === "Alt") return isMac ? "⌥" : ALT_KEY;
    if (part === "Shift") return isMac ? "⇧" : SHIFT_KEY;
    return part;
  });
  return labels.join(isMac ? "" : KEY_SEP);
}

export function keybindingMatchesEvent(
  keybinding: string | null | undefined,
  event: KeyboardEvent,
  isMac: boolean,
): boolean {
  const normalized = normalizeKeybinding(keybinding);
  if (!normalized) return false;
  const parts = new Set(normalized.split("+"));
  const key = [...parts].find(
    (part) => !(MODIFIER_ORDER as readonly string[]).includes(part),
  );
  if (!key || keyFromEvent(event) !== key) return false;

  const expectsMod = parts.has("Mod");
  const expectsCtrl = parts.has("Ctrl");
  const expectsAlt = parts.has("Alt");
  const expectsShift = parts.has("Shift");
  const modPressed = isMac ? event.metaKey : event.ctrlKey;
  if (expectsMod && !modPressed) return false;
  if (!expectsMod && modPressed && !(expectsCtrl && !isMac)) return false;
  const ctrlPressedOutsideMod = event.ctrlKey && !(expectsMod && !isMac);
  if (expectsCtrl !== ctrlPressedOutsideMod) return false;
  if (expectsAlt !== event.altKey) return false;
  if (expectsShift !== event.shiftKey) return false;
  if (isMac && !expectsMod && event.metaKey) return false;
  if (!isMac && event.metaKey) return false;
  return true;
}

export function keybindingFromEvent(
  event: KeyboardEvent,
  isMac: boolean,
): string | null {
  const key = keyFromEvent(event);
  if (["Control", "Ctrl", "Meta", "Alt", "Shift"].includes(key)) return null;
  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push("Mod");
  if (event.ctrlKey && (isMac || !parts.includes("Mod"))) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  parts.push(key);
  return normalizeKeybinding(parts.join("+"));
}
