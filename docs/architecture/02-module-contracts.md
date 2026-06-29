# 02. 模块契约与前端规范

> 本文件是所有前端模块的"宪法"。新模块必须遵守，修改模块边界前请先回看本文件。

## 1. 模块边界

### 1.1 目录与文件结构

```
src/modules/<module>/
  <Name>.vue               # 业务组件
  <name>Pinia.ts           # Pinia store（如有）
  <name>Commands.ts        # 注册到全局 commands 的命令（如有）
  <name>Types.ts           # 公共类型
  index.ts                 # 公共导出
  lib/                     # 模块内部 lib（不跨模块导入）
    *.ts
  __tests__/ 已被替代为 co-located *.test.ts
```

应用壳使用 `src/app/`，**不能**从 `src/modules/*` 反向 import `src/app/*` 的组件。

### 1.2 公共导出规范

- `index.ts` 只能 re-export **类型、composable、注册函数**。
- **禁止**从 `index.ts` re-export 具体 Vue 组件（避免 Vite chunk 优化失效），组件由调用方按需 import。
- **禁止**从 `index.ts` 暴露 Pinia store 实例（调用方用 `useXxxPiniaStore()` 拿）。

### 1.3 跨模块通信三通道

| 通道 | 适用场景 | 反例 |
|------|----------|------|
| 共享 Pinia store | 多模块读同一份状态 | 写入频率极高的"实时流" |
| 直接 composable 调用 | A 模块组件挂载 B 模块的 composable | 在 B 模块的 store 内部 import A 模块 |
| Tauri 事件总线 | 后端事件广播（PTY chunk、文件变化、深链） | 模块内部"模拟事件总线"做数据同步 |

**禁止**：

- store A import store B；store 之间只能通过组件/composable 桥接。
- 用 `window` / `globalThis` 共享可变状态。
- 在 composable 内部 `new EventTarget()` 充当事件总线。

## 2. Pinia 写法

### 2.1 setup-function 模式强制

```ts
import { defineStore } from "pinia";
import { ref, computed } from "vue";

export const useFooPiniaStore = defineStore("foo", () => {
  const count = ref(0);
  const doubled = computed(() => count.value * 2);
  function increment() { count.value++; }
  return { count, doubled, increment };
});
```

### 2.2 禁止项

- **禁止** Options API 形式（`defineStore("foo", { state: () => ({}), actions: {} })`）。
- **禁止** `this.*` 引用；setup-function 模式没有 `this`。
- **禁止** 在 store action 中订阅 `onMounted` / `onUnmounted`（生命周期归组件 / composable）。
- **禁止** 在 store 内部 `setTimeout` / `setInterval` 触发副作用（应通过 composable 暴露）。

### 2.3 store 命名

- 业务 store：`use<Domain>PiniaStore`，文件 `<domain>Pinia.ts`。
- 工厂 store：`create<TaskRunStore>(options)`，每个调用方各自 `useXxx()`。
- 容忍列表：`workspaceRootPinia` / `workspaceEnvPinia` 是历史遗留，新 store 不允许再起这种 `Pinia` 后缀的非常规名。

## 3. Tauri IPC 契约

### 3.1 唯一出口

所有 invoke **必须**经 `@/lib/native`：

```ts
import { native } from "@/lib/native";

const result = await native.fsReadFile("/abs/path");
```

边界测试 `src/lib/nativeBoundary.test.ts` 会扫描禁止 `invoke(`、`@tauri-apps/api/core` 的直接 import。

### 3.2 workspace 透传

`native.*` 的每个方法都会把 `workspace: currentWorkspaceEnv()` 透传给 Rust。Rust 端命令签名必须有 `workspace: Option<WorkspaceEnv>` 参数。`currentWorkspaceEnv()` 默认从 `workspaceEnvPinia` 读，必要时可显式 override。

### 3.3 类型签名

- Rust 端用 `#[derive(Serialize, Deserialize)]` + `#[serde(rename_all = "camelCase")]`。
- 前端 `native.ts` 的方法签名必须与 Rust 完全一致；空类型用 `void`、可空用 `T | null`。
- 新增 IPC 命令的步骤：
  1. Rust 端 `#[tauri::command]` + `lib.rs::invoke_handler` 注册。
  2. `src/lib/native.ts` 添加方法签名（与 Rust 同步的 JSDoc）。
  3. 在调用方模块的 README "Tauri 命令" 表中加一行。
  4. 在 01-overview.md 提到的"数据流"叙述如有变化也一并更新。

### 3.4 Channel 与事件

- 高频流式数据（PTY output）走 Tauri `Channel<T>`，**不要**走 `EventBus`。
- 偶发事件（文件变化、深链、Git 操作完成）走 Tauri `emit(event, payload)` + 前端 `listen(event, handler)`。
- 前端订阅用 `useEventListener`（自动配对 add/remove）。

## 4. 命名规范

### 4.1 文件 / 目录

| 类别 | 规则 | 例子 |
|------|------|------|
| Vue 组件 | `PascalCase.vue` | `TerminalPane.vue` |
| Composable | `useCamelCase.ts` | `useWorkspaceLifecycle.ts` |
| Pinia store | `<domain>Pinia.ts` | `preferencesPinia.ts` |
| 内部 lib | `camelCase.ts` | `fileTreeRows.ts` |
| 类型模块 | `<domain>Types.ts` | `tabsTypes.ts` |
| Rust 模块 | `snake_case` | `workspace.rs` |

### 4.2 TypeScript

- `interface` 用于"可以被扩展"的形状；`type` 用于"组合/联合/字面量"。
- 命名导出优先，**禁止**默认导出（除非有明确需要，例如 Vue 组件的 lazy import）。
- 任何 `Object.freeze` 的常量对象用 `as const`。

### 4.3 路径别名

**强制**使用 `@/` 代替深层相对路径：

```ts
// 好
import { native } from "@/lib/native";
import { usePreferencesPiniaStore } from "@/modules/settings/preferencesPinia";

// 坏
import { native } from "../../../lib/native";
```

## 5. 样式与主题

- **组件主题** 一律通过 `NConfigProvider` + `themeOverrides` + `AppTokens` 派生。
- **布局/微调** 用 Tailwind 4 utility。
- 颜色用 oklch 语义 token（`--background` / `--foreground` / `--primary` 等），不要硬编码 `#hex`。
- 圆角 6/8 px、间距 4/8/12/16/24 px、字体 Inter Variable / JetBrains Mono。
- **禁止**写"营销式"大段说明替代实际 UI。

## 6. 测试规范

- 单元测试 co-located：`<source>.test.ts`。
- 组件测试：`<Component>.vue.test.ts`。
- 边界测试：`*Boundary.test.ts`。
- 用 `vi.mock()` mock Tauri API；用 `vi.hoisted()` 处理 mock 提升。
- 组件测试用 `@vue/test-utils` + jsdom。
- 修复 module ownership / framework migration / IPC / 安全相关 bug 时必须新增/更新边界测试。

## 7. 日志

- 业务日志用 `console.*`，production 构建会被 esbuild `pure` 去掉 `console.debug/info/trace`。
- Rust 端用 `log` crate；通过 `tauri-plugin-log` 写入 webview 控制台 + 文件。
- 错误统一走 `normalizeError` 规整后通知用户。
- 用户级错误用 `notifications/notificationCenter` 的 `notifyError` 展示。

## 8. 性能

- 状态粒度优先：`ref` 单一字段，不要"全对象 `reactive`"。
- 长列表用虚拟滚动（文件树、提交历史、任务日志）。
- 高频更新走 rAF / microtask 合并；不要在循环里同步触发 DOM 测量。
- 大量 xterm 输出由 `terminalSessionCore` 内部用 scheduler 合并（`FLUSH_COALESCE = 6ms`）。

## 9. 可访问性 / 国际化

- 颜色对比度遵循 WCAG AA。
- 全部用户可见字符串走 i18n key，**禁止**硬编码中文 / 英文。
- 触屏能力探测见 `@/lib/touchDevice`；`touchOptimizations` 偏好影响点击目标尺寸。
