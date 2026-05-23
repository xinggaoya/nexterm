import { describe, expect, it } from "vitest";
import { discoverWorkspaceTasks } from "./taskDiscovery";

function reader(files: Record<string, string>) {
  return async (path: string) => files[path] ?? null;
}

describe("task discovery", () => {
  it("discovers package scripts with the workspace package manager", async () => {
    const tasks = await discoverWorkspaceTasks(
      "/repo",
      reader({
        "/repo/package.json": JSON.stringify({
          scripts: {
            dev: "vite",
            test: "vitest run",
          },
        }),
        "/repo/pnpm-lock.yaml": "lockfileVersion: '9.0'",
      }),
    );

    expect(tasks).toMatchObject([
      {
        id: "package:dev",
        title: "pnpm run dev",
        command: "pnpm run dev",
        source: "package",
      },
      {
        id: "package:test",
        title: "pnpm run test",
        command: "pnpm run test",
        source: "package",
      },
    ]);
  });

  it("discovers Cargo commands when a Cargo manifest exists", async () => {
    const tasks = await discoverWorkspaceTasks(
      "/repo",
      reader({
        "/repo/Cargo.toml": '[package]\nname = "nexterm"\n',
      }),
    );

    expect(tasks.map((task) => task.command)).toEqual([
      "cargo check",
      "cargo test",
      "cargo run",
      "cargo build",
    ]);
  });

  it("discovers public Makefile targets in file order", async () => {
    const tasks = await discoverWorkspaceTasks(
      "/repo",
      reader({
        "/repo/Makefile": ".PHONY: build test\nbuild:\n\tcargo build\ntest:\n\tcargo test\n",
      }),
    );

    expect(tasks).toMatchObject([
      { id: "make:build", title: "make build", command: "make build" },
      { id: "make:test", title: "make test", command: "make test" },
    ]);
  });
});
