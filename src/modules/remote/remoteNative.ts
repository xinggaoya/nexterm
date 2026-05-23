import { invoke } from "@tauri-apps/api/core";

export type RemoteServiceStatus = {
  enabled: boolean;
  bindHost: string;
  port: number | null;
  url: string | null;
  accessUrls: string[];
};

export function remoteTerminalStatus(): Promise<RemoteServiceStatus> {
  return invoke<RemoteServiceStatus>("remote_terminal_status");
}

export function startRemoteTerminal(input: {
  token: string;
  port: number;
}): Promise<RemoteServiceStatus> {
  return invoke<RemoteServiceStatus>("remote_terminal_start", {
    token: input.token,
    port: input.port,
  });
}

export function stopRemoteTerminal(): Promise<RemoteServiceStatus> {
  return invoke<RemoteServiceStatus>("remote_terminal_stop");
}
