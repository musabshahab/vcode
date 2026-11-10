import type { ServerProvider, ServerProviderSlashCommand } from "@t3tools/contracts";

export const TEAM_COMMAND = {
  name: "team",
  description: "Lead a team on a task, with each role on its own model",
  input: { hint: "task" },
} satisfies ServerProviderSlashCommand;

/** Lists `/team` with every provider's commands, and on workspace catalogs, which replace that list. */
export function withTeamCommand(providers: readonly ServerProvider[]): ServerProvider[] {
  const commands = (items: readonly ServerProviderSlashCommand[]) => [
    ...items.filter((command) => command.name !== TEAM_COMMAND.name),
    TEAM_COMMAND,
  ];
  return providers.map((provider) => ({
    ...provider,
    slashCommands: commands(provider.slashCommands),
    ...(provider.workspaceSnapshots
      ? {
          workspaceSnapshots: provider.workspaceSnapshots.map((snapshot) => ({
            ...snapshot,
            slashCommands: commands(snapshot.slashCommands),
          })),
        }
      : {}),
  }));
}
