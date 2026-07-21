/**
 * DPI / devicePixelRatio 变化监听。
 *
 * xterm.js v6 的 setDevicePixelRatio 在 mount 时只生效一次,缩放变化后必须
 * 主动调用并重建字符纹理,否则 Windows 125%~200% 缩放下字符发虚。
 * 这里用 matchMedia 监听 resolution 变化,触发回调。
 */

export type DpiCallback = (dpr: number) => void;

export function watchDevicePixelRatio(cb: DpiCallback): () => void {
  if (typeof window === "undefined") return () => {};
  const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const handler = () => {
    cb(window.devicePixelRatio);
    // 分辨率变化后需要重新订阅,matchMedia 不支持单次监听。
    // 由调用方决定何时 dispose。
  };
  // 兼容新旧浏览器 API,addEventListener 优先,addListener 兜底。
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }
  // 旧版(Safari 13.1-)API
  const legacy = mql as MediaQueryList & {
    addListener: (cb: () => void) => void;
    removeListener: (cb: () => void) => void;
  };
  legacy.addListener(handler);
  return () => legacy.removeListener(handler);
}

export function currentDevicePixelRatio(): number {
  if (typeof window === "undefined") return 1;
  return window.devicePixelRatio || 1;
}