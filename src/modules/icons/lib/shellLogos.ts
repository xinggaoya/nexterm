/**
 * Shell profile id → Catppuccin 图标名。
 *
 * profile id 来自后端 `shell_list_profiles`（白名单探测结果）：
 * - Windows：`pwsh` / `powershell` / `cmd` / `git-bash` / `nu` / `cygwin-bash`
 * - Unix：登录 shell 的程序名（`bash` / `zsh` / `fish` …）
 *
 * Catppuccin 没有 `cmd` / `nu` / `zsh` / `fish` 图标，这些 id 不收录。
 */

// @keep-sorted
export const shellLogos: Record<string, string> = {
  bash: "bash",
  "cygwin-bash": "bash",
  "git-bash": "bash",
  powershell: "powershell",
  pwsh: "powershell",
};
