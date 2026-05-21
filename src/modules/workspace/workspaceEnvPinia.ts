import { invoke } from "@tauri-apps/api/core";
import { defineStore } from "pinia";
import { setLastWslDistro } from "@/modules/settings/store";
import {
  LOCAL_WORKSPACE,
  setCurrentWorkspaceEnv,
  type WorkspaceEnv,
  type WslDistro,
} from "./workspaceEnvSnapshot";

type State = {
  env: WorkspaceEnv;
  distros: WslDistro[];
  loading: boolean;
  error: string | null;
};

export const useWorkspaceEnvPiniaStore = defineStore("workspace-env", {
  state: (): State => ({
    env: LOCAL_WORKSPACE,
    distros: [],
    loading: false,
    error: null,
  }),
  actions: {
    setEnv(env: WorkspaceEnv) {
      this.env = env;
      setCurrentWorkspaceEnv(env);
      if (env.kind === "wsl") {
        void Promise.resolve(setLastWslDistro(env.distro)).catch(() => {});
      }
    },
    async refreshDistros(): Promise<WslDistro[]> {
      this.loading = true;
      this.error = null;
      try {
        const distros = await invoke<WslDistro[]>("wsl_list_distros");
        this.distros = distros;
        this.loading = false;
        return distros;
      } catch (error) {
        this.distros = [];
        this.loading = false;
        this.error = String(error);
        return [];
      }
    },
  },
});
