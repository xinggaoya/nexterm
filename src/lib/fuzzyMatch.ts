import Fuse, { type FuseOptionKey } from "fuse.js";

/**
 * 统一的模糊匹配层。
 *
 * 命令面板与文件选择器此前各写一套：一个用子序列位置衰减打分，一个用
 * 子串包含判断 —— 命中语义割裂（同一个查询在两处行为不同）。fuse.js 是
 * 这个领域的事实标准（bitap 模糊匹配），换过去后两处体验一致，并且支持
 * 缩写与少量 typo。
 *
 * 匹配质量由 `threshold` 控制：0 = 必须精确命中，1 = 任意位置都算命中。
 * 默认 0.4 —— 足够宽松地支持 "ntr" → "New Terminal"，又不至于把
 * "Command Center" 这种跨词散字命中也塞进结果里。
 */
const DEFAULT_THRESHOLD = 0.4;

export interface FuzzyMatchOptions<T> {
  /** 参与匹配的字段；权重大的排前面。 */
  keys: FuseOptionKey<T>[];
  /** 匹配阈值，越小越严格。默认 0.4。 */
  threshold?: number;
}

/**
 * 按模糊匹配过滤并排序。
 *
 * 空查询返回原列表（保持原顺序）——「清空输入框回到全量」是列表控件的
 * 基本预期，不能因为换了排序算法就丢掉。
 */
export function fuzzyFilter<T>(
  items: T[],
  query: string,
  options: FuzzyMatchOptions<T>,
): T[] {
  const needle = query.trim();
  if (!needle) return items;

  const fuse = new Fuse(items, {
    keys: options.keys,
    threshold: options.threshold ?? DEFAULT_THRESHOLD,
    // 忽略命中位置：命令标题在列表里的下标不该影响匹配质量。
    ignoreLocation: true,
    minMatchCharLength: 1,
  });

  return fuse.search(needle).map((result) => result.item);
}
