export type WorkspaceTaskSource = "package" | "cargo" | "make";

export type WorkspaceTask = {
  id: string;
  title: string;
  command: string;
  source: WorkspaceTaskSource;
  detail: string;
};

export type TaskFileReader = (path: string) => Promise<string | null>;
