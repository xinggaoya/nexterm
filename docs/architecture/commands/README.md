# 命令系统模块

## 概述

命令系统模块提供命令注册、快捷键绑定和命令面板功能。

## 主要组件

### 前端组件

- `src/modules/commands/` - 模块根目录
- `CommandPalette.vue` - 命令面板
- `registry.ts` - 命令注册表
- `commandSpecs.ts` - 命令规范聚合
- `coreCommands.ts` - 核心命令
- `workbenchCommands.ts` - 工作台命令
- `keybindings.ts` - 快捷键处理
- `types.ts` - 类型定义

## 依赖关系

- `@/lib/platform` - 平台检测
- 各模块的命令规范

## 接口定义

### 命令类型

```typescript
type CommandId = "workbench.commandPalette.open" | "workbench.quickOpen.open" | ...

type CommandCategory = "editor" | "explorer" | "workbench" | "terminal" | "panel" | "settings" | "tasks" | "git"

type CommandSpec = {
  id: CommandId
  titleKey: string
  category: CommandCategory
  defaultKeybinding: string | null
  workspaceRequired?: boolean
}

type CommandDefinition<Context extends CommandContext> = {
  id: CommandId
  title: string
  category: CommandCategory
  defaultKeybinding: string | null
  when?: (context: Context) => boolean
  run: (context: Context) => void | Promise<void>
}
```

### Registry API

```typescript
createCommandRegistry(definitions: CommandDefinition[]): {
  all(): CommandDefinition[]
  get(id: CommandId): CommandDefinition | null
  filter(query: string, context: CommandContext): CommandDefinition[]
  execute(id: CommandId, context: CommandContext): Promise<void>
}
```

## 配置选项

- 快捷键格式：`Mod+Shift+P`（Mod = Cmd on Mac, Ctrl on Windows/Linux）
- 模糊搜索评分算法：精确匹配 > 连续字符 > 间隔字符

## 相关文档

- [详细设计](./detailed-design.md)