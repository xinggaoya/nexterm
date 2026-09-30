# 命令 commands

## 1. 概述

命令系统是"键盘到动作"的统一入口。`CommandPalette` 提供搜索面板，`registry` 把 `CommandDefinition` 列表组织成可执行命令，`keybindings` 解析 `Mod+Shift+P` 风格的快捷键。

## 2. 目录与文件

```
src/modules/commands/
  CommandPalette.vue        # 搜索面板
  registry.ts               # 命令注册表
  commandSpecs.ts           # 命令规范聚合 + specToDefinition 转换
  coreCommands.ts           # 核心命令（打开、退出、切换主题）
  workbenchCommands.ts      # 工作台命令（侧栏开关、tab 切换）
  keybindings.ts            # 快捷键解析 / 冲突检测 / 终端抢占策略
  shortcutTarget.ts         # 判定按键归属：终端输入面 vs 真正的输入框
  types.ts                  # CommandId / CommandCategory / CommandSpec
  index.ts
```

## 3. 依赖

### 3.1 内部

- `@/lib/platform` -- 平台检测
- `@/modules/settings/preferencesPinia` -- `keybindings` 覆盖
- 各业务模块的 `<name>Commands.ts` -- 命令来源
- `@/modules/notifications/notificationCenter` -- 错误提示

## 4. 数据契约

### 4.1 公共类型

```ts
type CommandId = "workbench.commandPalette.open" | "workbench.quickOpen.open" | ...;
type CommandCategory = "editor" | "explorer" | "workbench" | "terminal" | "panel" | "settings" | "tasks" | "git";
type PaneDirection = "left" | "right" | "up" | "down";

interface CommandSpec {
  id: CommandId;
  titleKey: string;            // i18n key
  category: CommandCategory;
  defaultKeybinding: string | null;
  workspaceRequired?: boolean;
  /** 额外的可用性条件，与 workspaceRequired 取与 */
  when?: (context: CommandContext) => boolean;
  /** 终端聚焦时是否仍抢按键；省略时按“该命令有绑定”推导 */
  captureInTerminal?: boolean;
}

interface CommandDefinition<Context extends CommandContext> {
  id: CommandId;
  title: string;
  category: CommandCategory;
  defaultKeybinding: string | null;
  when?: (context: Context) => boolean;
  captureInTerminal?: boolean;
  run: (context: Context) => void | Promise<void>;
}

type CommandContext = {
  workspaceReady: boolean;
  /** 活动分屏在每个方位上是否存在相邻 pane（缺失按 false = 不抢键） */
  paneNeighbour?: Partial<Record<PaneDirection, boolean>>;
  /** 活动标签的 kind，用于编辑器专属命令的可用性 */
  activeTabKind?: string | null;
};
```

> `CommandId` 是手写联合类型（spec 表分布在各模块，反向推导会与 `types.ts` 形成循环
> 依赖）。`commandSpecsContract.test.ts` 直接读 `types.ts` 校验它与 spec 表一一对应，
> 避免“加了命令忘了加进联合类型”。

### 4.2 Tauri 命令

不直接 invoke。

### 4.3 事件

通过 `keybindings` 监听 `keydown`；命令执行结果由各模块自行处理。

## 5. Pinia 状态

无独立 store。命令上下文（`CommandContext`）由调用方提供。

## 6. 关键算法

- 模糊搜索评分：精确匹配 > 连续字符 > 间隔字符。
- 快捷键格式：`Mod+Shift+P`（Mod = Cmd on Mac / Ctrl on Win/Linux）。
- **不支持和弦**：`normalizeKeybinding` 遇到多键序列返回 `null`。以前它只取最后一个
  非修饰键 token，`"Mod+K Mod+W"` 会被静默折叠成 `"Mod+W"` 而与 `tab.close` 撞车。
- `when` 条件决定命令当前是否可用。
- 用户覆盖写入 `preferencesPinia.keybindings`。

### 6.1 按键归属判定（终端优先的命脉）

xterm 用隐藏的 `<textarea class="xterm-helper-textarea">` 接收键盘。若把它和表单里的
`<input>` 一视同仁地当作“可编辑目标”，**所有**全局快捷键在终端里都会被放行成裸字节
发给 PTY。`shortcutTarget.ts` 把两类目标分开，判定分三层：

| 键入目标 | 语义 | 命令是否抢占 |
|------|------|----------------|
| 真的在输入框里打字（搜索框 / 设置项 / 行内重命名 / 命令面板） | 属于 webview | 一律让位 |
| 焦点不在终端 | 属于 workbench | 抢占 |
| 焦点在终端（helper textarea） | 属于 PTY | 取决于 `captureInTerminal`：默认“有绑定就抢”（对齐 VS Code） |

`terminal.focus*` 还额外受 `when` 约束：只有确实存在该方位的相邻分屏时才生效，
否则 `Alt+方向键` 仍然是 shell 的前后词跳转。

## 7. 配置项

- 快捷键默认绑定见各 `<name>Commands.ts`。
- 用户覆盖：`preferencesPinia.keybindings`。

## 8. 测试

- `registry.test.ts` / `keybindings.test.ts` / `commandSpecs.test.ts`
- `commandSpecsContract.test.ts` — 锁死联合类型 ↔ spec 表一致、默认键位两两不撞、和弦被判非法
- `shortcutCapture.test.ts` — 锁死终端 helper textarea 不算输入框、`captureInTerminal` 语义
- `CommandPalette.vue.test.ts`

## 9. 相关文档

- [详细设计](./detailed-design.md)
