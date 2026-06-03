import { defineStore } from "pinia";
import { ref } from "vue";
import { setLastWslDistro } from "@/modules/settings/store";
import { native } from "@/lib/native";
import {
  LOCAL_WORKSPACE,
  setCurrentWorkspaceEnv,
  type WorkspaceEnv,
  type WslDistro,
} from "./workspaceEnvSnapshot";

export const useWorkspaceEnvPiniaStore = defineStore("workspace-env", () => {
  const env = ref<WorkspaceEnv>(LOCAL_WORKSPACE);
  const distros = ref<WslDistro[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  function setEnv(next: WorkspaceEnv): void {
    env.value = next;
    setCurrentWorkspaceEnv(next);
    if (next.kind === "wsl") {
      void Promise.resolve(setLastWslDistro(next.distro)).catch(() => {});
    }
  }

  async function refreshDistros(): Promise<WslDistro[]> {
    loading.value = true;
    error.value = null;
    try {
      const list = await native.wslListDistros();
      distros.value = list;
      loading.value = false;
      return list;
    } catch (err) {
      distros.value = [];
      loading.value = false;
      error.value = String(err);
      return [];
    }
  }

  return {
    env,
    distros,
    loading,
    error,
    setEnv,
    refreshDistros,
  };
});
