import { describe, expect, it, vi } from "vitest";
import {
  loadRunConfigurationFile,
  saveRunConfigurationFile,
  type RunConfigurationFile,
} from "./runConfigStore";

function createApi(files: Record<string, string | null> = {}) {
  return {
    readTextFile: vi.fn(async (path: string) => files[path] ?? null),
    createDir: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
  };
}

describe("run configuration store", () => {
  it("loads an empty project configuration file when none exists", async () => {
    const api = createApi();

    await expect(loadRunConfigurationFile("/repo", api)).resolves.toEqual({
      version: 1,
      configurations: [],
      selectedId: null,
    });
    expect(api.readTextFile).toHaveBeenCalledWith("/repo/.nexterm/run-configs.json");
  });

  it("loads and normalizes project run configurations", async () => {
    const api = createApi({
      "/repo/.nexterm/run-configs.json": JSON.stringify({
        version: 1,
        selectedId: "full-stack",
        configurations: [
          {
            id: "full-stack",
            name: "Full Stack",
            commands: [
              {
                id: "web",
                name: "Vue",
                command: " pnpm run dev ",
                cwd: ".",
              },
              {
                id: "api",
                name: "Spring Boot",
                command: "./mvnw spring-boot:run",
                cwd: "backend",
              },
            ],
          },
        ],
      }),
    });

    await expect(loadRunConfigurationFile("/repo", api)).resolves.toEqual({
      version: 1,
      selectedId: "full-stack",
      configurations: [
        {
          id: "full-stack",
          name: "Full Stack",
          commands: [
            {
              id: "web",
              name: "Vue",
              command: "pnpm run dev",
              cwd: ".",
            },
            {
              id: "api",
              name: "Spring Boot",
              command: "./mvnw spring-boot:run",
              cwd: "backend",
            },
          ],
        },
      ],
    });
  });

  it("rejects unsupported or invalid project run configuration files", async () => {
    await expect(
      loadRunConfigurationFile(
        "/repo",
        createApi({
          "/repo/.nexterm/run-configs.json": JSON.stringify({ version: 2 }),
        }),
      ),
    ).rejects.toThrow("Unsupported run configuration file version");

    await expect(
      loadRunConfigurationFile(
        "/repo",
        createApi({
          "/repo/.nexterm/run-configs.json": JSON.stringify({
            version: 1,
            configurations: [
              { id: "bad", name: "Bad", commands: [{ command: "   " }] },
            ],
          }),
        }),
      ),
    ).rejects.toThrow("Run configuration command is required");
  });

  it("creates the project config directory and writes formatted JSON", async () => {
    const api = createApi();
    const file: RunConfigurationFile = {
      version: 1,
      selectedId: "full-stack",
      configurations: [
        {
          id: "full-stack",
          name: "Full Stack",
          commands: [
            {
              id: "web",
              name: "Vue",
              command: "pnpm run dev",
              cwd: ".",
            },
          ],
        },
      ],
    };

    await saveRunConfigurationFile("/repo", file, api);

    expect(api.createDir).toHaveBeenCalledWith("/repo/.nexterm");
    expect(api.writeTextFile).toHaveBeenCalledWith(
      "/repo/.nexterm/run-configs.json",
      `${JSON.stringify(file, null, 2)}\n`,
    );
  });

  it("continues saving when the project config directory already exists", async () => {
    const api = {
      readTextFile: vi.fn(async () => null),
      createDir: vi.fn(async () => {
        throw new Error("already exists: /repo/.nexterm");
      }),
      writeTextFile: vi.fn(async () => undefined),
    };
    const file: RunConfigurationFile = {
      version: 1,
      selectedId: null,
      configurations: [],
    };

    await saveRunConfigurationFile("/repo", file, api);

    expect(api.writeTextFile).toHaveBeenCalledWith(
      "/repo/.nexterm/run-configs.json",
      `${JSON.stringify(file, null, 2)}\n`,
    );
  });
});
