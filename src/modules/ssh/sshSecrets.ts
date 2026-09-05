/**
 * SSH 连接机密的进程内缓存。
 *
 * 约束(安全边界):
 * - 仅存于 webview 内存,从不写入 preferences / localStorage / 磁盘;
 * - 以 workspaceScopeKey(env) 为键,同一 SSH 工作区的多个终端复用一次
 *   口令输入;工作区关闭时应调用 forget();
 * - Phase 3 计划替换为 OS keychain。
 */

import { workspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

const secrets = new Map<string, string>();

export function rememberSshSecret(env: WorkspaceEnv, secret: string): void {
  if (!secret) return;
  secrets.set(workspaceScopeKey(env), secret);
}

export function getSshSecret(env: WorkspaceEnv): string | null {
  return secrets.get(workspaceScopeKey(env)) ?? null;
}

export function forgetSshSecret(env: WorkspaceEnv): void {
  secrets.delete(workspaceScopeKey(env));
}

/** 测试与登出场景:清空全部缓存。 */
export function clearSshSecrets(): void {
  secrets.clear();
}
