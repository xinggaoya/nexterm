<script setup lang="ts">
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";

type RemoteSession = {
  id: number;
  title: string | null;
  cwd: string | null;
  cols: number;
  rows: number;
  createdAtMs: number;
  totalOffset: number;
};

type ServerMessage =
  | { type: "snapshot"; session: RemoteSession }
  | {
      type: "output";
      startOffset: number;
      nextOffset: number;
      totalOffset: number;
      dataBase64: string;
    }
  | { type: "error"; message: string };

const token = new URLSearchParams(window.location.search).get("token") ?? "";
const sessions = ref<RemoteSession[]>([]);
const activeSession = ref<RemoteSession | null>(null);
const loading = ref(false);
const error = ref<string | null>(token ? null : "缺少访问 token。请从 Nexterm 设置中复制远程访问 URL。");
const connected = ref(false);
const terminalHost = ref<HTMLDivElement | null>(null);
let terminal: Terminal | null = null;
let fitAddon: FitAddon | null = null;
let socket: WebSocket | null = null;
let inputDisposable: { dispose: () => void } | null = null;

const wsProtocol = computed(() => (window.location.protocol === "https:" ? "wss:" : "ws:"));

function authUrl(path: string): string {
  const url = new URL(path, window.location.origin);
  url.searchParams.set("token", token);
  return url.toString();
}

function sessionLabel(session: RemoteSession): string {
  return session.title || "shell";
}

function sessionMeta(session: RemoteSession): string {
  return session.cwd || `PTY #${session.id}`;
}

async function loadSessions() {
  if (!token) return;
  loading.value = true;
  error.value = null;
  try {
    const res = await fetch(authUrl("/api/terminals"));
    if (!res.ok) throw new Error(res.status === 401 ? "访问 token 无效。" : "无法读取终端列表。");
    sessions.value = await res.json();
    if (!activeSession.value && sessions.value.length > 0) {
      await openSession(sessions.value[0]);
    }
  } catch (err) {
    error.value = String(err);
  } finally {
    loading.value = false;
  }
}

function ensureTerminal() {
  if (terminal || !terminalHost.value) return;
  terminal = new Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, monospace",
    fontSize: 13,
    letterSpacing: 0,
    scrollback: 5000,
    theme: {
      background: "#09090b",
      foreground: "#f4f4f5",
      cursor: "#22c55e",
      selectionBackground: "#3f3f46",
    },
  });
  fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(terminalHost.value);
  inputDisposable = terminal.onData((data) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "input", data }));
    }
  });
  fitTerminal();
}

function fitTerminal() {
  if (!terminal || !fitAddon) return;
  try {
    fitAddon.fit();
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(
        JSON.stringify({
          type: "resize",
          cols: terminal.cols,
          rows: terminal.rows,
        }),
      );
    }
  } catch {
    // xterm can throw while hidden during first mobile layout.
  }
}

async function openSession(session: RemoteSession) {
  activeSession.value = session;
  await nextTick();
  ensureTerminal();
  terminal?.reset();
  socket?.close();
  connected.value = false;

  const url = new URL(`/api/terminals/${session.id}/ws`, window.location.origin);
  url.protocol = wsProtocol.value;
  url.searchParams.set("token", token);
  socket = new WebSocket(url.toString());
  socket.onopen = () => {
    connected.value = true;
    fitTerminal();
  };
  socket.onclose = () => {
    connected.value = false;
  };
  socket.onerror = () => {
    error.value = "远程终端连接失败。";
  };
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "snapshot") {
      activeSession.value = message.session;
      return;
    }
    if (message.type === "error") {
      error.value = message.message;
      return;
    }
    terminal?.write(decodeBase64(message.dataBase64));
  };
}

function sendControl(data: string) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "input", data }));
  }
}

function decodeBase64(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

onMounted(() => {
  void loadSessions();
  window.addEventListener("resize", fitTerminal);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", fitTerminal);
  socket?.close();
  inputDisposable?.dispose();
  terminal?.dispose();
});
</script>

<template>
  <main class="remote-shell">
    <header class="remote-header">
      <div>
        <p class="remote-eyebrow">Nexterm Remote</p>
        <h1>{{ activeSession ? sessionLabel(activeSession) : "终端接管" }}</h1>
      </div>
      <button class="icon-button" type="button" :disabled="loading || !token" @click="loadSessions">
        ↻
      </button>
    </header>

    <section v-if="error" class="remote-alert">
      {{ error }}
    </section>

    <section v-if="sessions.length > 0" class="session-strip" aria-label="终端列表">
      <button
        v-for="session in sessions"
        :key="session.id"
        type="button"
        :class="['session-pill', activeSession?.id === session.id ? 'active' : '']"
        @click="openSession(session)"
      >
        <span>{{ sessionLabel(session) }}</span>
        <small>{{ sessionMeta(session) }}</small>
      </button>
    </section>

    <section v-else-if="!loading && !error" class="remote-empty">
      桌面端当前没有可接管的终端。
    </section>

    <section class="terminal-panel">
      <div ref="terminalHost" class="terminal-host" />
      <div class="connection-badge" :data-connected="connected">
        {{ connected ? "已连接" : "未连接" }}
      </div>
    </section>

    <nav class="control-bar" aria-label="快捷键">
      <button type="button" @click="sendControl('\u0003')">Ctrl C</button>
      <button type="button" @click="sendControl('\u001b')">Esc</button>
      <button type="button" @click="sendControl('\t')">Tab</button>
      <button type="button" @click="sendControl('\r')">Enter</button>
    </nav>
  </main>
</template>
