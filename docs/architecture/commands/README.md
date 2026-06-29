# 命令 commands

## 1. 概述

命令系统是"键盘到动作"的统一入口。`CommandPalette` 提供搜索面板，`registry` 把 `CommandDefinition` 列表组织成可执行命令，`keybindings` 解析 `Mod+Shift+P` 风格的快捷键。

## 2. 目录与文件

```
src/modules/commands/
  CommandPalette.vue        # 搜索面板
  registry.ts               # 命令注册表
  commandSpecs.ts           # 命令规范聚合
  coreCommands.ts           # 核心命令（打开、退出、切换主题）
  workbenchCommands.ts      # 工作台命令（侧栏开关、tab 切换）
  keybindings.ts            # 快捷键解析
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

interface CommandSpec {
  id: CommandId;
  titleKey: string;            // i18n key
  category: CommandCategory;
  defaultKeybinding: string | null;
  workspaceRequired?: boolean;
}

interface CommandDefinition<Context extends CommandContext> {
  id: CommandId;
  title: string;
  category: CommandCategory;
  defaultKeybinding: string | null;
  when?: (context: Context) => boolean;
  run: (context: Context) => void | Promise<void>;
}
```

### 4.2 Tauri 命令

不直接 invoke。

### 4.3 事件

通过 `keybindings` 监听 `keydown`；命令执行结果由各模块自行处理。

## 5. Pinia 状态

无独立 store。命令上下文（`CommandContext`）由调用方提供。

## 6. 关键算法

- 模糊搜索评分：精确匹配 > 连续字符 > 间隔字符。
- 快捷键格式：`Mod+Shift+P`（Mod = Cmd on Mac / Ctrl on Win/Linux）。
- `when` 条件决定命令当前是否可用。
- 用户覆盖写入 `preferencesPinia.keybindings`。

## 7. 配置项

- 快捷键默认绑定见各 `<name>Commands.ts`。
- 用户覆盖：`preferencesPinia.keybindings`。

## 8. 测试

- `registry.test.ts` / `keybindings.test.ts` / `commandSpecs.test.ts`
- `CommandPalette.vue.test.ts`

## 9. 相关文档

- [详细设计](./detailed-design.md)
