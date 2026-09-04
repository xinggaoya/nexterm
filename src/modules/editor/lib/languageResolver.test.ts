import { describe, expect, it } from "vitest";
import {
  languageLabelForPath,
  resolveLanguage,
} from "./languageResolver";

describe("language resolver", () => {
  it.each([
    ["/repo/src/App.vue", "Vue"],
    ["/repo/src/styles/main.scss", "SCSS"],
    ["/repo/src/styles/main.sass", "Sass"],
    ["/repo/public/site.xml", "XML"],
    ["/repo/changes.patch", "Diff"],
    ["/repo/.env", "Env"],
    ["/repo/nginx.conf", "Nginx"],
    ["/repo/CMakeLists.txt", "CMake"],
  ])("resolves %s as %s", async (path, label) => {
    await expect(resolveLanguage(path)).resolves.toBeTruthy();
    expect(languageLabelForPath(path)).toBe(label);
  });
});
