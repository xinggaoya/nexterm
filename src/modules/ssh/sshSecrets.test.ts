import { describe, expect, it } from "vitest";
import {
  clearSshSecrets,
  forgetSshSecret,
  getSshSecret,
  rememberSshSecret,
} from "./sshSecrets";
import { workspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

const sshEnv: WorkspaceEnv = { kind: "ssh", profileId: "p1" };
const otherSsh: WorkspaceEnv = { kind: "ssh", profileId: "p2" };
const localEnv: WorkspaceEnv = { kind: "local" };

describe("sshSecrets", () => {
  it("stores and retrieves by workspace scope", () => {
    clearSshSecrets();
    rememberSshSecret(sshEnv, "hunter2");
    expect(getSshSecret(sshEnv)).toBe("hunter2");
    expect(getSshSecret(otherSsh)).toBeNull();
    expect(getSshSecret(localEnv)).toBeNull();
  });

  it("forgets a single secret", () => {
    clearSshSecrets();
    rememberSshSecret(sshEnv, "a");
    rememberSshSecret(otherSsh, "b");
    forgetSshSecret(sshEnv);
    expect(getSshSecret(sshEnv)).toBeNull();
    expect(getSshSecret(otherSsh)).toBe("b");
  });

  it("never stores empty secrets and clears all", () => {
    clearSshSecrets();
    rememberSshSecret(sshEnv, "");
    expect(getSshSecret(sshEnv)).toBeNull();
    rememberSshSecret(sshEnv, "x");
    clearSshSecrets();
    expect(getSshSecret(sshEnv)).toBeNull();
  });

  it("scope keys isolate ssh profiles", () => {
    expect(workspaceScopeKey(sshEnv)).toBe("ssh:p1");
    expect(workspaceScopeKey(otherSsh)).toBe("ssh:p2");
  });
});
