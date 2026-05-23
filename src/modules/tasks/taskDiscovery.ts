import type { TaskFileReader, WorkspaceTask } from "./taskTypes";

type PackageJson = {
  scripts?: Record<string, unknown>;
};

const CARGO_COMMANDS = ["check", "test", "run", "build"] as const;
const LOCK_FILES: Array<[fileName: string, runner: string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["package-lock.json", "npm"],
];

function joinPath(root: string, name: string): string {
  if (root.endsWith("/")) return `${root}${name}`;
  return `${root}/${name}`;
}

async function readFirst(
  root: string,
  names: string[],
  readTextFile: TaskFileReader,
): Promise<{ path: string; content: string } | null> {
  for (const name of names) {
    const path = joinPath(root, name);
    const content = await readTextFile(path);
    if (content !== null) return { path, content };
  }
  return null;
}

function safeJson(content: string): PackageJson | null {
  try {
    const parsed = JSON.parse(content) as PackageJson;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function packageRunner(
  root: string,
  readTextFile: TaskFileReader,
): Promise<string> {
  for (const [fileName, runner] of LOCK_FILES) {
    if ((await readTextFile(joinPath(root, fileName))) !== null) return runner;
  }
  return "npm";
}

async function packageTasks(
  root: string,
  readTextFile: TaskFileReader,
): Promise<WorkspaceTask[]> {
  const manifest = await readTextFile(joinPath(root, "package.json"));
  if (manifest === null) return [];

  const parsed = safeJson(manifest);
  if (!parsed?.scripts || typeof parsed.scripts !== "object") return [];

  const runner = await packageRunner(root, readTextFile);
  return Object.entries(parsed.scripts)
    .filter(([, command]) => typeof command === "string")
    .map(([script]) => {
      const command = `${runner} run ${script}`;
      return {
        id: `package:${script}`,
        title: command,
        command,
        source: "package",
        detail: "package.json",
      };
    });
}

async function cargoTasks(
  root: string,
  readTextFile: TaskFileReader,
): Promise<WorkspaceTask[]> {
  const manifest = await readTextFile(joinPath(root, "Cargo.toml"));
  if (manifest === null) return [];

  return CARGO_COMMANDS.map((name) => {
    const command = `cargo ${name}`;
    return {
      id: `cargo:${name}`,
      title: command,
      command,
      source: "cargo",
      detail: "Cargo.toml",
    };
  });
}

function makeTargets(content: string): string[] {
  const targets: string[] = [];
  const seen = new Set<string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9][A-Za-z0-9_.-]*):(?:\s|$)/.exec(line);
    if (!match) continue;
    const target = match[1];
    if (seen.has(target)) continue;
    seen.add(target);
    targets.push(target);
  }
  return targets;
}

async function makeTasks(
  root: string,
  readTextFile: TaskFileReader,
): Promise<WorkspaceTask[]> {
  const file = await readFirst(root, ["Makefile", "makefile"], readTextFile);
  if (!file) return [];

  const targets = makeTargets(file.content);
  if (targets.length === 0) {
    return [
      {
        id: "make:default",
        title: "make",
        command: "make",
        source: "make",
        detail: file.path,
      },
    ];
  }

  return targets.map((target) => {
    const command = `make ${target}`;
    return {
      id: `make:${target}`,
      title: command,
      command,
      source: "make",
      detail: file.path,
    };
  });
}

export async function discoverWorkspaceTasks(
  root: string,
  readTextFile: TaskFileReader,
): Promise<WorkspaceTask[]> {
  const [packages, cargo, make] = await Promise.all([
    packageTasks(root, readTextFile),
    cargoTasks(root, readTextFile),
    makeTasks(root, readTextFile),
  ]);
  return [...packages, ...cargo, ...make];
}

export function selectDefaultWorkspaceTask(
  tasks: readonly WorkspaceTask[],
): WorkspaceTask | null {
  const preferredIds = ["package:dev", "package:start", "package:test"];
  for (const id of preferredIds) {
    const match = tasks.find((task) => task.id === id);
    if (match) return match;
  }

  const firstPackage = tasks.find((task) => task.source === "package");
  if (firstPackage) return firstPackage;

  const cargoTest = tasks.find((task) => task.id === "cargo:test");
  if (cargoTest) return cargoTest;

  const cargoCheck = tasks.find((task) => task.id === "cargo:check");
  if (cargoCheck) return cargoCheck;

  const firstMake = tasks.find((task) => task.source === "make");
  return firstMake ?? tasks[0] ?? null;
}
