import { scopeThreadRef } from "@codenine/client-runtime/environment";
import type { EnvironmentThreadShell } from "@codenine/client-runtime/state/shell";
import { teamStatusText, threadTeam, type ThreadTeam } from "@codenine/client-runtime/team";
import { UsersIcon } from "lucide-react";

import { useQuietThreadShell } from "../../state/entities";
import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/** The team a thread leads or works for, read from shells so no lead detail is subscribed. */
export function useThreadTeam(shell: EnvironmentThreadShell | null): ThreadTeam | null {
  const teamTask = shell?.source.teamTask;
  const lead = useQuietThreadShell(
    shell === null || teamTask === undefined
      ? null
      : scopeThreadRef(shell.environmentId, teamTask.rootThreadId),
  );
  return shell === null ? null : threadTeam(shell.source, lead?.source ?? null);
}

/** The line above the composer that leads back to the Task tab while it is out of sight. */
export function taskStripBannerItem(team: ThreadTeam, onOpen: () => void): ComposerBannerStackItem {
  const status = team.summary === null ? null : teamStatusText(team.summary);
  const needsYou = team.summary?.status === "proposed" || team.summary?.status === "failed";
  return {
    id: "team-task",
    variant: needsYou ? "warning" : "default",
    icon: <UsersIcon />,
    title: "Team",
    ...(status === null ? {} : { description: status.line }),
    actions: (
      <Button size="xs" variant="ghost" onClick={onOpen}>
        Open
      </Button>
    ),
  };
}
