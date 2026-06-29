# snippets 模块

## 职责

维护终端命令片段（snippets）的静态集合，供命令面板作为可执行命令注入。本轮只读默认模板，无 UI；用户自定义与持久化属于下一轮。

## 模块边界

- `src/modules/snippets/terminalSnippets.ts`：默认模板（5 条），每条含 `id` / `nameKey` / `command`。
- `src/modules/snippets/index.ts`：模块出口。
- `src/modules/snippets/terminalSnippets.test.ts`：稳定 id、唯一性、命令非空。

## 与命令系统的集成

- CommandId 联合类型在 `src/modules/commands/types.ts` 中加入 `` `snippet.${string}` `` 模板字面量，覆盖动态生成的 snippet 命令。
- `useWorkbenchCommands` 在 `commandDefinitions` 中拼接 `DEFAULT_TERMINAL_SNIPPETS.map(...)`，每条以 `snippet.<id>` 形式注册。
- 执行时调用 `tabs.newTaskTerminal({ cwd: workspaceRoot, command })` 创建新任务终端（已存在能力）。

## 状态归属

- 模板数组：纯模块内常量，无 store / persistence。
- 用户自定义：本轮不支持；下一轮加 `preferencesPinia.terminalSnippets: TerminalSnippet[]` 字段并提供增删 UI。

## 测试

- 模板稳定：id 非空、唯一、command 非空。
- 命令面板集成：smoke test 通过 `useWorkbenchCommands` 单测覆盖执行路径（下一轮补）。
