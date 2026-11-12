import { scopeThreadRef } from "@codenine/client-runtime/environment";
import type { EnvironmentThreadShell } from "@codenine/client-runtime/state/shell";
import {
  teamAgentHeader,
  teamResultHandoff,
  type TeamAgentHeader,
} from "@codenine/client-runtime/team";
import type {
  EnvironmentId,
  ProjectId,
  ScopedThreadRef,
  TeamPlan,
  TeamTaskRef,
  ThreadId,
} from "@codenine/contracts";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { ArrowDownIcon, MessageSquareIcon } from "lucide-react";

import { useQuietThreadShell } from "../../state/entities";
import { environmentThreadDetails } from "../../state/threads";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { teamModelText, useTeamModelCatalog } from "./TeamAgentModel";
import type { ThreadNowItem } from "./ThreadNow";

const NO_TEAM_PLAN_ATOM = Atom.make<TeamPlan | null>(null);

export interface TeamAgentThread {
  readonly leadRef: ScopedThreadRef;
  /** Null while this client holds no shell for the lead, which it then cannot open. */
  readonly leadTitle: string | null;
  readonly teamTask: TeamTaskRef;
  /** The lead's plan, which the Task tab reads too; null while it loads. */
  readonly plan: TeamPlan | null;
  /** Null until the plan is loaded, or once the lead holds another plan. */
  readonly header: TeamAgentHeader | null;
  /** Once the task completed, the line naming the agents its result went to. */
  readonly handoff: string | null;
}

/** A team agent's thread, with the lead's plan it runs a task for. */
export function useTeamAgentThread(shell: EnvironmentThreadShell | null): TeamAgentThread | null {
  const teamTask = shell?.source.teamTask;
  const leadRef =
    shell === null || teamTask === undefined
      ? null
      : scopeThreadRef(shell.environmentId, teamTask.rootThreadId);
  const lead = useQuietThreadShell(leadRef);
  const plan = useAtomValue(
    leadRef === null ? NO_TEAM_PLAN_ATOM : environmentThreadDetails.teamAtom(leadRef),
  );
  if (leadRef === null || teamTask === undefined) return null;
  return {
    leadRef,
    leadTitle: lead?.title ?? null,
    teamTask,
    plan,
    header: plan === null ? null : teamAgentHeader(plan, teamTask),
    handoff: plan === null ? null : teamResultHandoff(plan, teamTask),
  };
}

/** "Agent 2 of 3 · Claude · Haiku 5.5 · Low · Done", under an agent thread's title. */
export function TeamAgentHeaderLine(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId | null;
  header: TeamAgentHeader;
}) {
  const { header } = props;
  const catalog = useTeamModelCatalog(props.environmentId, props.projectId);
  const model =
    header.modelSelection === null ? null : teamModelText(catalog, header.modelSelection);
  const text = [
    header.position,
    model?.entry?.displayName ?? null,
    model?.name ?? null,
    model?.effort || null,
    header.status,
  ]
    .filter((part) => part !== null)
    .join(" · ");
  return <span className="min-w-0 truncate">{text}</span>;
}

/** The quiet line over an agent's composer: the plan is the lead's to change. */
export function teamAgentHintBannerItem(label: string | null): ComposerBannerStackItem {
  return {
    id: "team-agent-messages",
    variant: "default",
    icon: <MessageSquareIcon />,
    title: `Messages here go to ${label ?? "this agent"} only.`,
    description: "To change the plan, ask the lead.",
  };
}

/** Under an agent's result, at the end of its timeline: which agents it went to. */
export function teamHandoffNowItem(threadId: ThreadId, line: string): ThreadNowItem {
  return { id: `team-handoff:${threadId}`, icon: <ArrowDownIcon />, title: line };
}
