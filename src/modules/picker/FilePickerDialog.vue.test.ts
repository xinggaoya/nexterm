// @vitest-environment jsdom
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FsDirEntry } from "@/lib/native";
import FilePickerDialog from "./FilePickerDialog.vue";
import type { FilePickerOptions } from "./pickerTypes";

// NVirtualList（vueuc）依赖 window.matchMedia 与 ResizeObserver 测量视口，
// jsdom 均未提供；布局属性也全为 0 导致视口为空、一行都不渲染。
// 与 SourceControlPanel.vue.test.ts 同款最小 stub，先于组件导入安装。
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
if (
  typeof window !== "undefined" &&
  typeof (window as unknown as { ResizeObserver?: unknown }).ResizeObserver !==
    "function"
) {
  (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(_callback: ResizeObserverCallback) {}
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
// vueuc 的测量循环用 rAF 驱动。jsdom 的原生实现是 ~16ms 的帧定时器，
// 与本文件其余的定时等待交错后时序不稳（这个文件历史上就是随机红的）。
// 这里**无条件**换成微任务版，让「测量 → 渲染」在同一个 tick 内完成。
// 注意不能写成 setTimeout(0)：那会让测量循环空转，反而挤掉用例自己的等待。
{
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    queueMicrotask(() => cb(performance.now()));
    return 0;
  };
  globalThis.cancelAnimationFrame = (): void => {};
}
if (typeof window !== "undefined") {
  const proto = (window as unknown as { HTMLElement: { prototype: HTMLElement } })
    .HTMLElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(proto, "clientHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(proto, "clientWidth", {
    configurable: true,
    get() {
      return 320;
    },
  });
  Object.defineProperty(proto, "offsetHeight", {
    configurable: true,
    get() {
      return 600;
    },
  });
  Object.defineProperty(proto, "offsetWidth", {
    configurable: true,
    get() {
      return 320;
    },
  });
  Object.defineProperty(proto, "getClientRects", {
    configurable: true,
    value() {
      return [{ top: 0, left: 0, right: 320, bottom: 600, width: 320, height: 600 }];
    },
  });
  Object.defineProperty(proto, "getBoundingClientRect", {
    configurable: true,
    value() {
      return {
        width: 320,
        height: 600,
        top: 0,
        left: 0,
        right: 320,
        bottom: 600,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      };
    },
  });
}

const nativeMock = vi.hoisted(() => ({
  fsReadDir: vi.fn(),
  fsCreateDir: vi.fn(),
  getWslHome: vi.fn(),
  getLaunchDir: vi.fn(),
  listLocalRoots: vi.fn(),
}));

vi.mock("@/lib/native", () => ({
  createNativeForEnv: () => ({
    fsReadDir: nativeMock.fsReadDir,
    fsCreateDir: nativeMock.fsCreateDir,
  }),
  native: {
    getWslHome: nativeMock.getWslHome,
    getLaunchDir: nativeMock.getLaunchDir,
    listLocalRoots: nativeMock.listLocalRoots,
  },
}));

vi.mock("@/modules/explorer/lib/iconResolver", () => ({
  fileIconUrl: () => "data:,file",
  folderIconUrl: () => "data:,folder",
}));

const wslUbuntu = { kind: "wsl" as const, distro: "Ubuntu" };

function dirEntry(name: string): FsDirEntry {
  return { name, kind: "dir", size: 0, mtime: 0 };
}

function fileEntry(name: string, size = 0): FsDirEntry {
  return { name, kind: "file", size, mtime: 0 };
}

/** /home/dev 的模拟目录：隐藏项仅在 showHidden=true 时返回。 */
function mockListings(): void {
  nativeMock.getWslHome.mockResolvedValue("/home/dev");
  nativeMock.fsReadDir.mockImplementation(
    async (path: string, showHidden: boolean) => {
      if (path === "/home/dev") {
        const entries = [dirEntry("proj"), fileEntry("notes.txt", 42)];
        return showHidden ? [dirEntry(".cache"), ...entries] : entries;
      }
      if (path === "/") return [dirEntry("home")];
      if (path === "/home/dev/proj") return [fileEntry("main.rs", 3)];
      throw new Error(`ENOENT: ${path}`);
    },
  );
}

/**
 * 等待虚拟列表渲染出视口行。
 *
 * NVirtualList（vueuc）要先拿到一次视口测量才会渲染任何一行，而这里的
 * `ResizeObserver` 是空壳 stub（不发回调）。原先的实现是「造一个属性变更
 * + 30 × 10ms 有界轮询」—— 轮询预算刚好压在测量发生的时刻上，于是这个文件
 * 在不同并发度下会随机失败（实测 forks 下偶尔红、threads 下更频繁）。
 *
 * 改成对**真实条件**重试：行出现就返回，不出现就一直重试到超时。用固定
 * 睡眠次数去赌一个异步时序，本质上就是把 flake 写进测试里。
 */
async function waitForVirtualRows(): Promise<void> {
  await vi.waitFor(
    () => {
      expect(document.body.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
    },
    { timeout: 4_000, interval: 25 },
  );
}

async function mountPicker(
  options: Partial<FilePickerOptions> = {},
): Promise<VueWrapper> {
  const wrapper = mount(FilePickerDialog, {
    props: {
      options: { mode: "directory", workspace: wslUbuntu, ...options },
    },
    attachTo: document.body,
  });
  await flushPromises();
  await waitForVirtualRows();
  return wrapper;
}

function optionRows(): Element[] {
  return Array.from(document.body.querySelectorAll('[role="option"]'));
}

/** 行内第一个 span 是名称列（其后是大小等元信息）。 */
function rowName(row: Element): string | undefined {
  return row.querySelector("span")?.textContent?.trim();
}

function rowByName(name: string): Element | undefined {
  return optionRows().find((row) => rowName(row) === name);
}

function buttonByText(text: string): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(text),
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("FilePickerDialog", () => {
  it("opens the WSL home, lists directories first and labels the distro", async () => {
    mockListings();
    await mountPicker();

    expect(nativeMock.getWslHome).toHaveBeenCalledWith("Ubuntu");
    expect(nativeMock.fsReadDir).toHaveBeenCalledWith("/home/dev", false);
    expect(document.body.textContent).toContain("WSL · Ubuntu");
    const names = optionRows().map((row) => rowName(row));
    expect(names).toEqual(["proj", "notes.txt"]);
  });

  it("selects a folder row and confirms its joined path", async () => {
    mockListings();
    const wrapper = await mountPicker();

    rowByName("proj")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPromises();
    buttonByText("Select Here")?.click();
    await flushPromises();

    expect(wrapper.emitted("confirm")?.[0]).toEqual(["/home/dev/proj"]);
  });

  it("navigates into a folder on double click", async () => {
    mockListings();
    await mountPicker();

    rowByName("proj")?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await flushPromises();

    expect(nativeMock.fsReadDir).toHaveBeenCalledWith("/home/dev/proj", false);
    expect(
      Array.from(document.body.querySelectorAll("button")).some((button) =>
        button.textContent?.trim() === "proj",
      ),
    ).toBe(true);
  });

  it("filters the current listing", async () => {
    mockListings();
    await mountPicker();

    const input = document.body.querySelector(
      'input[placeholder="Filter current folder"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    input!.value = "notes";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    // 过滤输入带 120ms 防抖，等其生效。
    await new Promise((resolve) => setTimeout(resolve, 150));
    await flushPromises();

    expect(optionRows().map((row) => rowName(row))).toEqual([
      "notes.txt",
    ]);
  });

  it("injects huge listings in chunks and reports the full count", async () => {
    mockListings();
    const huge = Array.from({ length: 5000 }, (_, index) =>
      fileEntry(`entry-${String(index).padStart(4, "0")}`),
    );
    nativeMock.fsReadDir.mockImplementation(async (path: string) => {
      if (path === "/huge") return huge;
      if (path === "/") return [dirEntry("huge")];
      throw new Error(`ENOENT: ${path}`);
    });
    nativeMock.getWslHome.mockResolvedValue("/huge");
    await mountPicker();

    // 分块注入完成后，计数显示全部条目；虚拟列表只渲染视口内的行。
    expect(document.body.textContent).toContain("5000 items");
    expect(optionRows().length).toBeGreaterThan(0);
    expect(optionRows().length).toBeLessThan(100);
  });

  it("re-lists with hidden entries after toggling the hidden switch", async () => {
    mockListings();
    await mountPicker();

    const toggle = document.body.querySelector(
      'button[title="Show hidden files"]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    toggle!.click();
    await flushPromises();

    expect(nativeMock.fsReadDir).toHaveBeenCalledWith("/home/dev", true);
    expect(optionRows().map((row) => rowName(row))).toEqual([
      ".cache",
      "proj",
      "notes.txt",
    ]);
  });

  it("falls back to the filesystem root when home and initial folder are unavailable", async () => {
    mockListings();
    nativeMock.getWslHome.mockRejectedValue(new Error("no distro"));
    await mountPicker({ initialPath: "/gone" });
    // 初始目录与 HOME 都失败——应退回到 "/" 并成功列出根目录。
    expect(nativeMock.fsReadDir).toHaveBeenCalledWith("/", false);
    expect(document.body.textContent).toContain("Filesystem");
    expect(document.body.textContent).not.toContain("Cannot open this folder");
  });

  it("emits cancel without confirm on the cancel button", async () => {
    mockListings();
    const wrapper = await mountPicker();

    buttonByText("Cancel")?.click();
    await flushPromises();

    expect(wrapper.emitted("cancel")).toBeTruthy();
    expect(wrapper.emitted("confirm")).toBeUndefined();
  });

  it("confirms a typed file name in file mode", async () => {
    mockListings();
    const wrapper = await mountPicker({ mode: "file" });

    const input = document.body.querySelector(
      'input[placeholder="File name"]',
    ) as HTMLInputElement | null;
    expect(input).not.toBeNull();
    input!.value = "new.txt";
    input!.dispatchEvent(new Event("input", { bubbles: true }));
    await flushPromises();
    buttonByText("Select")?.click();
    await flushPromises();

    expect(wrapper.emitted("confirm")?.[0]).toEqual(["/home/dev/new.txt"]);
  });

  it("falls back to the first drive root and shows drive places in local mode", async () => {
    nativeMock.listLocalRoots.mockResolvedValue(["C:/", "D:/"]);
    nativeMock.getLaunchDir.mockResolvedValue(null);
    nativeMock.fsReadDir.mockImplementation(async (path: string) => {
      if (path === "C:/" || path === "D:/") return [dirEntry("docs")];
      throw new Error(`ENOENT: ${path}`);
    });
    await mountPicker({ workspace: { kind: "local" } });

    // 没有启动目录时回退到第一个盘符根；盘符以快捷位置展示。
    expect(nativeMock.listLocalRoots).toHaveBeenCalled();
    expect(nativeMock.fsReadDir).toHaveBeenCalledWith("C:/", false);
    expect(document.body.textContent).toContain("C:");
    expect(document.body.textContent).toContain("D:");

    const drivePlace = Array.from(document.body.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "D:",
    );
    expect(drivePlace).toBeDefined();
    drivePlace?.click();
    await flushPromises();
    expect(nativeMock.fsReadDir).toHaveBeenCalledWith("D:/", false);
  });
});
