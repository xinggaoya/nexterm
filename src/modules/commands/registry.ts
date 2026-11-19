import { fuzzyFilter } from "@/lib/fuzzyMatch";
import type {
  CommandContext,
  CommandDefinition,
  CommandId,
} from "./types";

function isAvailable(
  command: CommandDefinition,
  context: CommandContext,
): boolean {
  return command.when ? command.when(context) : true;
}

export function filterCommands(
  commands: CommandDefinition[],
  query: string,
  context: CommandContext,
): CommandDefinition[] {
  const available = commands.filter((command) =>
    isAvailable(command, context),
  );
  // 标题是用户认得的东西，权重最高；分类与命令 id 作为补充入口。
  return fuzzyFilter(available, query, {
    keys: [
      { name: "title", weight: 3 },
      { name: "category", weight: 2 },
      { name: "id", weight: 1 },
    ],
  });
}

export function createCommandRegistry(definitions: CommandDefinition[]) {
  const commands = new Map<CommandId, CommandDefinition>();
  for (const definition of definitions) {
    if (commands.has(definition.id)) {
      throw new Error(`Duplicate command id: ${definition.id}`);
    }
    commands.set(definition.id, definition);
  }

  return {
    all(): CommandDefinition[] {
      return [...commands.values()];
    },
    get(id: CommandId): CommandDefinition | null {
      return commands.get(id) ?? null;
    },
    filter(query: string, context: CommandContext): CommandDefinition[] {
      return filterCommands([...commands.values()], query, context);
    },
    async execute(id: CommandId, context: CommandContext): Promise<void> {
      const command = commands.get(id);
      if (!command) throw new Error(`Unknown command id: ${id}`);
      if (!isAvailable(command, context)) return;
      await command.run(context);
    },
  };
}

export type CommandRegistry = ReturnType<typeof createCommandRegistry>;
