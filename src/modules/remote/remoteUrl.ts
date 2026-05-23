export type RemoteAccessInput = {
  host?: string;
  port: number;
  token: string;
};

export function buildRemoteAccessUrl(input: RemoteAccessInput): string {
  const host = input.host || "127.0.0.1";
  return `http://${host}:${input.port}/?token=${encodeURIComponent(input.token)}`;
}

export function remoteHostFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function redactRemoteToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return token;
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function generateRemoteToken(): string {
  const bytes = new Uint8Array(24);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
