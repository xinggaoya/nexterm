import type {
  CommandContext,
  CommandDefinition,
  CommandId,
} from "./types";

function scoreCommand(command: CommandDefinition, query: string): number {
  if (!query) return 0;
  const haystack = `${command.title} ${command.category} ${command.id}`.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (haystack.includes(needle)) return needle.length * 10;

  let score = 0;
  let cursor = 0;
  for (const char of needle) {
    const foundAt = haystack.indexOf(char, cursor);
    if (foundAt === -1) return -1;
    score += Math.max(1, 8 - (foundAt - cursor));
    cursor = foundAt + 1;
  }
  return score;
}

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
  return commands
    .filter((command) => isAvailable(command, context))
    .map((command, index) => ({
      command,
      index,
      score: scoreCommand(command, query),
    }))
    .filter((item) => item.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.command);
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
