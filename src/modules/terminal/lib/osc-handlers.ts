import type { IMarker, Terminal } from "@xterm/xterm";

const MAX_TERMINAL_TITLE_LENGTH = 120;

/**
 * Cross-handler state shared between the OSC 7 cwd handler and the OSC 133
 * prompt-marker handler. Tracks whether we are currently inside a running
 * command (between OSC 133 B and the next OSC 133 D / A), so the cwd handler
 * can ignore OSC 7 updates emitted by *command output* (e.g. a remote SSH
 * server, a `cat` of an attacker-controlled file). Only OSC 7 issued by the
 * local shell — which fires between commands — should be honored.
 */
export type ShellIntegrationState = {
  inCommand: boolean;
};

export function createShellIntegrationState(): ShellIntegrationState {
  return { inCommand: false };
}

export function registerCwdHandler(
  term: Terminal,
  onCwd: (cwd: string) => void,
  state?: ShellIntegrationState,
): () => void {
  const d = term.parser.registerOscHandler(7, (data) => {
    // Reject OSC 7 emitted while a command is running: command stdout/stderr
    // is untrusted (it can come from a remote shell, an SSH session, a `cat`
    // of attacker-controlled bytes). The local shell only emits OSC 7
    // between commands via its precmd/PROMPT_COMMAND hook.
    if (state?.inCommand) return true;
    const cwd = parseOsc7(data);
    if (cwd) onCwd(cwd);
    return true;
  });
  return () => d.dispose();
}

export function registerTitleHandler(
  term: Terminal,
  onTitle: (title: string) => void,
): () => void {
  const disposers = [0, 2].map((code) =>
    term.parser.registerOscHandler(code, (data) => {
      const title = sanitizeTitle(data);
      if (title) onTitle(title);
      return true;
    }),
  );
  return () => {
    for (const d of disposers) d.dispose();
  };
}

export type PromptTracker = {
  getMarker: () => IMarker | null;
  dispose: () => void;
};

export type PromptTrackerOptions = {
  onCommandComplete?: () => void;
};

export function registerPromptTracker(
  term: Terminal,
  state?: ShellIntegrationState,
  options?: PromptTrackerOptions,
): PromptTracker {
  let marker: IMarker | null = null;
  const d = term.parser.registerOscHandler(133, (data) => {
    if (data.startsWith("A")) {
      if (state) state.inCommand = false;
      marker?.dispose();
      marker = term.registerMarker(0);
    } else if (data.startsWith("B")) {
      if (state) state.inCommand = true;
    } else if (data.startsWith("C")) {
      if (state) state.inCommand = true;
    } else if (data.startsWith("D")) {
      if (state) state.inCommand = false;
      options?.onCommandComplete?.();
    }
    return true;
  });
  return {
    getMarker: () => (marker && !marker.isDisposed ? marker : null),
    dispose: () => {
      d.dispose();
      marker?.dispose();
      marker = null;
    },
  };
}

function parseOsc7(data: string): string | null {
  const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
  if (!m) return null;
  let path = m[1];
  try {
    path = decodeURIComponent(path);
  } catch {}
  // /C:/Users/foo -> C:/Users/foo so it's a valid Windows path.
  if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
  return path;
}

function sanitizeTitle(data: string): string | null {
  const title = data
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x9b[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x1f\x7f-\x9f]/g, "")
    .trim()
    .slice(0, MAX_TERMINAL_TITLE_LENGTH);
  return title.length > 0 ? title : null;
}
