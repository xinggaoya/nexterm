import { describe, expect, it } from "vitest";
import {
  fileExtension,
  imageMimeFromPath,
  isBinaryImagePath,
  isPreviewableImagePath,
} from "./imageFiles";

describe("imageFiles", () => {
  it("extracts extensions from Windows and Unix paths", () => {
    expect(fileExtension("C:/repo/assets/logo.PNG")).toBe("png");
    expect(fileExtension("/repo/assets/photo.jpeg")).toBe("jpeg");
    expect(fileExtension("C:\\repo\\icon.ico")).toBe("ico");
    expect(fileExtension("/repo/README")).toBe("");
    expect(fileExtension("/repo/.gitignore")).toBe("gitignore");
  });

  it("classifies binary image paths for double-click routing", () => {
    expect(isBinaryImagePath("/a/b.png")).toBe(true);
    expect(isBinaryImagePath("/a/b.JPG")).toBe(true);
    expect(isBinaryImagePath("/a/b.webp")).toBe(true);
    expect(isBinaryImagePath("/a/b.svg")).toBe(false);
    expect(isBinaryImagePath("/a/b.txt")).toBe(false);
  });

  it("includes svg in previewable images only", () => {
    expect(isPreviewableImagePath("/a/b.svg")).toBe(true);
    expect(isPreviewableImagePath("/a/b.png")).toBe(true);
    expect(isPreviewableImagePath("/a/b.md")).toBe(false);
  });

  it("maps extensions to mime types", () => {
    expect(imageMimeFromPath("/a/b.png")).toBe("image/png");
    expect(imageMimeFromPath("/a/b.svg")).toBe("image/svg+xml");
    expect(imageMimeFromPath("/a/b.txt")).toBeNull();
  });
});
