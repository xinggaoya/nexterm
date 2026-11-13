// 全局测试设置。CodeMirror 6 相关的测试桩由各组件测试通过 vi.mock 注入
// (tests/codemirror-stubs.ts / tests/codemirror-noop-stubs.ts),这里不做事。
import { afterEach } from "vitest";

/**
 * 跨用例重置 git 请求协调器。
 *
 * 两个协调器都是**模块级单例**（它们的职责就是跨面板实例合并请求），
 * 因此状态会跨用例残留：
 * - `gitDiscoverCoordinator` 带 TTL 缓存，上一个用例的结果会被下一个
 *   用例命中（键相同时），导致断言读到别的用例的数据；
 * - `gitStatusCoordinator` 的在途状态在用例未收尾时会残留。
 *
 * 动态 import：协调器模块会连带加载 `@/lib/native`（Tauri API 包装层），
 * 没必要让所有测试文件在收集阶段都付出这个代价。
 */
afterEach(async () => {
  const [{ gitDiscoverCoordinator }, { gitStatusCoordinator }] = await Promise.all([
    import("@/modules/source-control/gitDiscoverCoordinator"),
    import("@/modules/source-control/gitStatusCoordinator"),
  ]);
  gitDiscoverCoordinator.reset();
  gitStatusCoordinator.reset();
});
