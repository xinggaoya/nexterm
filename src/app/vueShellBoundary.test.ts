import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = fileURLToPath(new URL("../", import.meta.url));

const legacyShellPaths = [
  "components/WindowControls.tsx",
  "lib/use-mobile.ts",
  "lib/useZoom.ts",
  "modules/editor/NewEditorDialog.tsx",
  "modules/header/Header.tsx",
  "modules/header/SearchInline.tsx",
  "modules/header/index.ts",
  "modules/sidebar/SidebarRail.tsx",
  "modules/sidebar/index.ts",
  "modules/sidebar/types.ts",
  "modules/statusbar/AiTools.tsx",
  "modules/statusbar/CwdBreadcrumb.tsx",
  "modules/statusbar/StatusBar.tsx",
  "modules/statusbar/WorkspaceEnvSelector.tsx",
  "modules/statusbar/index.ts",
  "modules/statusbar/lib/pathUtils.ts",
  "modules/tabs/TabBar.tsx",
  "modules/tabs/lib/useTabs.ts",
  "modules/tabs/lib/useWorkspaceCwd.ts",
  "modules/theme/ThemeProvider.tsx",
  "modules/workspace/env.ts",
];

describe("Vue shell boundary", () => {
  it("does not keep replaced React shell modules", () => {
    const remaining = legacyShellPaths.filter((path) =>
      existsSync(join(srcRoot, path)),
    );

    expect(remaining).toEqual([]);
  });
});
