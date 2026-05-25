import { invoke } from "@tauri-apps/api/core";
import { currentWorkspaceEnv } from "@/modules/workspace/workspaceEnvSnapshot";

export type RunConfigurationCommand = {
  id: string;
  name: string;
  command: string;
  cwd?: string;
};

export type RunConfiguration = {
  id: string;
  name: string;
  commands: RunConfigurationCommand[];
};

export type RunConfigurationFile = {
  version: 1;
  configurations: RunConfiguration[];
  selectedId: string | null;
};

export type RunConfigurationFileApi = {
  readTextFile: (path: string) => Promise<string | null>;
  createDir: (path: string) => Promise<void>;
  writeTextFile: (path: string, content: string) => Promise<void>;
};

const RUN_CONFIG_DIR = ".nexterm";
const RUN_CONFIG_FILE = "run-configs.json";

function joinWorkspacePath(root: string, path: string): string {
  const trimmed = root.trim().replace(/\\/g, "/");
  const normalizedRoot =
    trimmed === "/" || /^[A-Za-z]:\/$/.test(trimmed)
      ? trimmed
      : trimmed.replace(/\/+$/, "");
  return `${normalizedRoot || "/"}${normalizedRoot.endsWith("/") ? "" : "/"}${path}`;
}

export function runConfigurationDirectoryPath(root: string): string {
  return joinWorkspacePath(root, RUN_CONFIG_DIR);
}

export function runConfigurationFilePath(root: string): string {
  return joinWorkspacePath(root, `${RUN_CONFIG_DIR}/${RUN_CONFIG_FILE}`);
}

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function requireString(value: unknown, message: string): string {
  const normalized = normalizeString(value);
  if (!normalized) throw new Error(message);
  return normalized;
}

function normalizeCommand(value: unknown): RunConfigurationCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Run configuration command is invalid");
  }
  const record = value as Record<string, unknown>;
  const command = requireString(
    record.command,
    "Run configuration command is required",
  );
  const id = normalizeString(record.id) || command;
  const name = normalizeString(record.name) || command;
  const cwd = normalizeString(record.cwd, ".");
  return { id, name, command, cwd: cwd || "." };
}

function normalizeConfiguration(value: unknown): RunConfiguration {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Run configuration is invalid");
  }
  const record = value as Record<string, unknown>;
  const id = requireString(record.id, "Run configuration id is required");
  const name = requireString(record.name, "Run configuration name is required");
  if (!Array.isArray(record.commands)) {
    throw new Error("Run configuration commands are required");
  }
  const commands = record.commands.map(normalizeCommand);
  if (commands.length === 0) {
    throw new Error("Run configuration must include at least one command");
  }
  return { id, name, commands };
}

export function emptyRunConfigurationFile(): RunConfigurationFile {
  return { version: 1, configurations: [], selectedId: null };
}

export async function loadRunConfigurationFile(
  root: string,
  api: Pick<RunConfigurationFileApi, "readTextFile"> = nativeRunConfigurationApi,
): Promise<RunConfigurationFile> {
  const content = await api.readTextFile(runConfigurationFilePath(root));
  if (content === null) return emptyRunConfigurationFile();

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Run configuration file is not valid JSON");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Run configuration file is invalid");
  }
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error("Unsupported run configuration file version");
  }
  if (!Array.isArray(record.configurations)) {
    throw new Error("Run configuration list is invalid");
  }
  const configurations = record.configurations.map(normalizeConfiguration);
  const selectedId = normalizeString(record.selectedId) || null;
  return { version: 1, configurations, selectedId };
}

export async function saveRunConfigurationFile(
  root: string,
  file: RunConfigurationFile,
  api: RunConfigurationFileApi = nativeRunConfigurationApi,
): Promise<void> {
  try {
    await api.createDir(runConfigurationDirectoryPath(root));
  } catch (error) {
    if (!String(error).includes("already exists")) throw error;
  }
  await api.writeTextFile(
    runConfigurationFilePath(root),
    `${JSON.stringify(file, null, 2)}\n`,
  );
}

export const nativeRunConfigurationApi: RunConfigurationFileApi = {
  async readTextFile(path: string) {
    try {
      const result = await invoke<
        | { kind: "text"; content: string }
        | { kind: "binary" | "toolarge"; size: number; limit?: number }
      >("fs_read_file", {
        path,
        workspace: currentWorkspaceEnv(),
      });
      return result.kind === "text" ? result.content : null;
    } catch {
      return null;
    }
  },
  createDir: (path: string) =>
    invoke<void>("fs_create_dir", {
      path,
      workspace: currentWorkspaceEnv(),
    }),
  writeTextFile: (path: string, content: string) =>
    invoke<void>("fs_write_file", {
      path,
      content,
      workspace: currentWorkspaceEnv(),
      source: "run-configs",
    }),
};
