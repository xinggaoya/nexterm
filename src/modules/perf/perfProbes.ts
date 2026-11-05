import type { PerfRecorder } from "./perfRecorder";

/** Chromium 私有的 JS 堆信息（非标准 API，能力探测后使用）。 */
type ChromiumMemory = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

function readChromiumMemory(): ChromiumMemory | null {
  if (typeof performance === "undefined") return null;
  const memory = (performance as Performance & { memory?: ChromiumMemory }).memory;
  if (!memory) return null;
  return memory;
}

function countDomNodes(): number | null {
  if (typeof document === "undefined") return null;
  return document.getElementsByTagName("*").length;
}

/**
 * 安装浏览器侧探针。
 *
 * 全部使用 `buffered: true` 的 PerformanceObserver：即使探针在页面启动
 * 之后才安装，也能补齐导航以来的历史条目（长任务 / LCP / CLS 都不丢）。
 *
 * 返回一个卸载函数，重复调用安全。
 */
export function installProbes(recorder: PerfRecorder): () => void {
  const observers: PerformanceObserver[] = [];
  const disposers: Array<() => void> = [];

  const observe = (
    type: string,
    handler: (entries: PerformanceEntryList) => void,
    options?: PerformanceObserverInit,
  ): void => {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((list) => handler(list.getEntries()));
      observer.observe({ type, buffered: true, ...options });
      observers.push(observer);
    } catch {
      // 某些条目类型在当前引擎不支持（Safari 无 longtask）——忽略即可。
    }
  };

  // 主线程长任务：>50ms 的阻塞，是"界面卡住"的第一嫌疑。
  observe("longtask", (entries) => {
    for (const entry of entries) {
      recorder.recordLongTask(entry.duration, entry.name || "self");
    }
  });

  // 布局偏移：CLS。
  observe("layout-shift", (entries) => {
    for (const entry of entries) {
      const shift = entry as PerformanceEntry & {
        value?: number;
        hadRecentInput?: boolean;
      };
      if (shift.hadRecentInput) continue;
      recorder.addCls(shift.value ?? 0);
    }
  });

  // 最大内容绘制。
  observe("largest-contentful-paint", (entries) => {
    const last = entries[entries.length - 1];
    if (last) recorder.setLcp(last.startTime);
  });

  // 交互延迟（近似 INP）：取观察到的最长一次交互。
  observe("event", (entries) => {
    for (const entry of entries) {
      recorder.setInp(entry.duration);
    }
  }, { durationThreshold: 40 } as PerformanceObserverInit);

  // 帧间隔采样：rAF 在窗口隐藏时会被浏览器节流，这段时间不计入卡顿。
  let rafId = 0;
  let lastFrameAt = 0;
  const tick = (timestamp: number): void => {
    if (lastFrameAt > 0) {
      recorder.recordFrame(timestamp - lastFrameAt);
    }
    lastFrameAt = timestamp;
    rafId = requestAnimationFrame(tick);
  };
  if (typeof requestAnimationFrame === "function") {
    rafId = requestAnimationFrame(tick);
    disposers.push(() => cancelAnimationFrame(rafId));
  }

  // 内存 + DOM 规模：每 5 秒一采。
  const memoryTimer = window.setInterval(() => {
    const memory = readChromiumMemory();
    recorder.recordMemory({
      usedJsHeapMb:
        memory === null ? null : Math.round((memory.usedJSHeapSize / 1048576) * 100) / 100,
      totalJsHeapMb:
        memory === null ? null : Math.round((memory.totalJSHeapSize / 1048576) * 100) / 100,
      domNodes: countDomNodes(),
    });
  }, 5000);
  disposers.push(() => window.clearInterval(memoryTimer));

  return () => {
    for (const observer of observers) {
      try {
        observer.disconnect();
      } catch {
        // 已断开
      }
    }
    for (const dispose of disposers) dispose();
  };
}
