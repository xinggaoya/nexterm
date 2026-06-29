export type TerminalSnippet = {
  id: string;
  nameKey: string;
  command: string;
};

export const DEFAULT_TERMINAL_SNIPPETS: TerminalSnippet[] = [
  {
    id: "tsc-watch",
    nameKey: "snippets.tscWatch",
    command: "pnpm tsc --watch",
  },
  {
    id: "vite-dev",
    nameKey: "snippets.viteDev",
    command: "pnpm dev",
  },
  {
    id: "cargo-watch",
    nameKey: "snippets.cargoWatch",
    command: "cargo watch -x run",
  },
  {
    id: "npm-install",
    nameKey: "snippets.npmInstall",
    command: "pnpm install",
  },
  {
    id: "git-status",
    nameKey: "snippets.gitStatus",
    command: "git status",
  },
];
