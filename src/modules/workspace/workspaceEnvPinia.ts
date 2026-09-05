import { defineStore } from "pinia";
import { ref } from "vue";
import { native } from "@/lib/native";
import type { WslDistro, WorkspaceEnv } from "./workspaceEnvSnapshot";

/**
 * WSL distro catalog + selection state for the "add workspace" flow.
 *
 * Historically this store also owned a global `env` singleton
 * (`selectedWorkspaceEnv`) that every native call read implicitly. That has
 * been removed — workspace envs now live per-`WorkspaceInstance` in
 * `workspacesPinia`. This store only retains the distro list (which is a
 * global OS-level concern, not per-workspace) plus a transient selector
 * state used by the add-workspace dialog.
 */
export const useWorkspaceEnvPiniaStore = defineStore("workspace-env", () => {
  const distros = ref<WslDistro[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);
  // Transient: which env the add-workspace dialog currently shows. Defaults
  // to local; the dialog may flip it to a wsl distro. Not persisted — purely
  // UI state for the picker.
  const pendingEnv = ref<WorkspaceEnv>({
    kind: "local",
  });

  function setPendingEnv(next: WorkspaceEnv): void {
    pendingEnv.value = next;
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
    distros,
    loading,
    error,
    pendingEnv,
    setPendingEnv,
    refreshDistros,
  };
});
