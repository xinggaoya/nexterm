/**
 * OSC sequence parsing for terminal integration.
 *
 * We extract two classes of OS commands from the PTY output stream:
 *   - OSC 7 ("file://host/path"): the shell's current working directory
 *   - OSC 0/2 ("title"): window/icon title
 *
 * Output is split into a clean string (with OSC bytes removed) and the
 * collected events. State held across chunks is purely the tail of any
 * OSC sequence that wasn't terminated in this buffer; the parser is
 * deliberately simple (no OSC 133, no DA filter) — the v2 frontend trusts
 * xterm's internal handling for everything else.
 */

export type OscEvent =
  | { type: "cwd"; value: string }
  | { type: "title"; value: string };

export interface OscResult {
  cleaned: string;
  events: OscEvent[];
  /** Bytes waiting to complete an OSC sequence started in the previous chunk. */
  pendingBuffer: string;
}

const OSC_TERMINATORS = ["\x07", "\x1b\\"];

export function handleOscData(data: string, prevPending: string): OscResult {
  const combined = prevPending + data;
  const events: OscEvent[] = [];
  const out: string[] = [];
  let pending = "";
  let cursor = 0;
  let searchFrom = 0;

  while (searchFrom < combined.length) {
    const escIdx = combined.indexOf("\x1b]", searchFrom);
    if (escIdx === -1) {
      out.push(combined.slice(cursor));
      cursor = combined.length;
      break;
    }

    if (escIdx > cursor) {
      out.push(combined.slice(cursor, escIdx));
      cursor = escIdx;
    }

    const endIdx = findOscEnd(combined, escIdx + 2);
    if (endIdx === -1) {
      // OSC sequence isn't terminated yet — keep only the OSC tail for the
      // next chunk; everything before it is part of the regular output.
      out.push(combined.slice(cursor, escIdx));
      pending = combined.slice(escIdx);
      cursor = combined.length;
      break;
    }

    const payload = combined.slice(escIdx + 2, endIdx.value);
    const ev = parseOscPayload(payload);
    if (ev) events.push(ev);
    cursor = endIdx.end;
    searchFrom = endIdx.end;
  }

  if (cursor < combined.length) {
    out.push(combined.slice(cursor));
  }

  return {
    cleaned: out.join(""),
    events,
    pendingBuffer: pending,
  };
}

function findOscEnd(
  text: string,
  from: number,
): { value: number; end: number } | -1 {
  for (const term of OSC_TERMINATORS) {
    const idx = text.indexOf(term, from);
    if (idx !== -1) return { value: idx, end: idx + term.length };
  }
  return -1;
}

function parseOscPayload(payload: string): OscEvent | null {
  const semi = payload.indexOf(";");
  if (semi === -1) return null;
  const code = payload.slice(0, semi);
  const value = payload.slice(semi + 1);
  if (code === "7") {
    const pathMatch = value.match(/^file:\/\/[^\/]*(\/.*)$/);
    if (pathMatch) {
      let raw = pathMatch[1];
      try {
        raw = decodeURIComponent(raw);
      } catch {
        // Malformed percent-encoding — keep the raw path rather than crash.
      }
      const fixed = /^\/[A-Za-z]:/.test(raw) ? raw.slice(1) : raw;
      return { type: "cwd", value: fixed };
    }
    return null;
  }
  if (code === "0" || code === "2") {
    const clean = value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 120);
    if (!clean) return null;
    return { type: "title", value: clean };
  }
  return null;
}
