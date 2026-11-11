import {
  type CommandId,
  type ModelSelection,
  type OrchestrationV2Command,
  TeamAgentId,
  type TeamAgentRole,
  type TeamDraft,
  type TeamPlan,
  type TeamPlanId,
  type TeamTask,
  type TeamTaskId,
  type TeamWorkspace,
  type ThreadId,
} from "@codenine/contracts";
import { validateTeamDraft } from "@codenine/shared/team";

type TeamCommand<T extends OrchestrationV2Command["type"]> = Extract<
  OrchestrationV2Command,
  { readonly type: T }
>;

/** The editable part of a plan: agents and tasks without their runtime state. */
export function teamDraftOf(plan: Pick<TeamPlan, "agents" | "tasks">): TeamDraft {
  return {
    agents: plan.agents,
    tasks: plan.tasks.map(({ id, title, brief, agentId, dependsOn }) => ({
      id,
      title,
      brief,
      agentId,
      dependsOn,
    })),
  };
}

// The team limits bound a plan, so comparing its JSON stays cheap.
function sameJson(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export function sameTeamPlan(a: TeamPlan | null, b: TeamPlan | null): boolean {
  return a === null || b === null ? a === b : sameJson(a, b);
}

export type TeamDraftChange =
  | {
      readonly type: "agent.model";
      readonly agentId: TeamAgentId;
      readonly modelSelection: ModelSelection;
    }
  | {
      readonly type: "agent.add";
      readonly label: string;
      readonly role: TeamAgentRole;
      readonly modelSelection: ModelSelection;
      readonly workspace: TeamWorkspace;
    }
  | { readonly type: "agent.remove"; readonly agentId: TeamAgentId }
  | { readonly type: "task.assign"; readonly taskId: TeamTaskId; readonly agentId: TeamAgentId }
  | { readonly type: "task.remove"; readonly taskId: TeamTaskId }
  | { readonly type: "task.brief"; readonly taskId: TeamTaskId; readonly brief: string };

export function teamAgentInUse(draft: TeamDraft, agentId: TeamAgentId): boolean {
  return draft.tasks.some((task) => task.agentId === agentId);
}

/** A slug from the label that no agent on the team has yet. */
function newTeamAgentId(label: string, agents: TeamDraft["agents"]): TeamAgentId {
  const taken = new Set<string>(agents.map((agent) => agent.id));
  const base =
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56) || "agent";
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`;
  return TeamAgentId.make(id);
}

export function changeTeamDraft(draft: TeamDraft, change: TeamDraftChange): TeamDraft {
  switch (change.type) {
    case "agent.model":
      return {
        ...draft,
        agents: draft.agents.map((agent) =>
          agent.id === change.agentId ? { ...agent, modelSelection: change.modelSelection } : agent,
        ),
      };
    case "agent.add":
      return {
        ...draft,
        agents: [
          ...draft.agents,
          {
            id: newTeamAgentId(change.label, draft.agents),
            label: change.label.trim(),
            role: change.role,
            modelSelection: change.modelSelection,
            workspace: change.workspace,
          },
        ],
      };
    case "agent.remove":
      return teamAgentInUse(draft, change.agentId)
        ? draft
        : { ...draft, agents: draft.agents.filter((agent) => agent.id !== change.agentId) };
    case "task.assign":
      return {
        ...draft,
        tasks: draft.tasks.map((task) =>
          task.id === change.taskId ? { ...task, agentId: change.agentId } : task,
        ),
      };
    case "task.remove":
      return {
        ...draft,
        tasks: draft.tasks.flatMap((task) =>
          task.id === change.taskId
            ? []
            : [{ ...task, dependsOn: task.dependsOn.filter((id) => id !== change.taskId) }],
        ),
      };
    case "task.brief":
      return {
        ...draft,
        tasks: draft.tasks.map((task) =>
          task.id === change.taskId ? { ...task, brief: change.brief } : task,
        ),
      };
  }
}

/** Local edits to a proposed plan. They stay on this client until saved or approved. */
export interface TeamDraftEdit {
  readonly planId: TeamPlanId;
  /** The plan revision the draft applies to; one ahead of the plan while a save catches up. */
  readonly revision: number;
  /** The plan as it stood when these edits began. */
  readonly base: TeamDraft;
  readonly draft: TeamDraft;
}

export interface ResolvedTeamDraft {
  readonly draft: TeamDraft;
  /** The revision `draft` applies to, which a save or an approval names. */
  readonly revision: number;
  /** The draft holds changes the server does not have. */
  readonly dirty: boolean;
  /** The plan changed or left `proposed` under unsaved edits, so they no longer show. */
  readonly overtaken: boolean;
}

/** What the editor shows for `plan`, given the user's local edits. */
export function resolveTeamDraft(plan: TeamPlan, edit: TeamDraftEdit | null): ResolvedTeamDraft {
  const current = teamDraftOf(plan);
  if (edit === null) {
    return { draft: current, revision: plan.revision, dirty: false, overtaken: false };
  }
  const applies = plan.status === "proposed" && edit.planId === plan.id;
  if (applies && edit.revision === plan.revision) {
    return {
      draft: edit.draft,
      revision: edit.revision,
      dirty: !sameJson(edit.draft, current),
      overtaken: false,
    };
  }
  // A save was accepted and the thread has not delivered the new revision yet.
  if (applies && edit.revision > plan.revision) {
    return {
      draft: edit.draft,
      revision: edit.revision,
      dirty: !sameJson(edit.draft, edit.base),
      overtaken: false,
    };
  }
  return {
    draft: current,
    revision: plan.revision,
    dirty: false,
    overtaken: !sameJson(edit.draft, edit.base),
  };
}

/** Applies a change to what the editor shows, starting over from the plan once it moved on. */
export function editTeamDraft(
  plan: TeamPlan,
  edit: TeamDraftEdit | null,
  change: TeamDraftChange,
): TeamDraftEdit {
  const current =
    edit !== null && edit.planId === plan.id && edit.revision >= plan.revision
      ? edit
      : {
          planId: plan.id,
          revision: plan.revision,
          base: teamDraftOf(plan),
          draft: teamDraftOf(plan),
        };
  return { ...current, draft: changeTeamDraft(current.draft, change) };
}

/** The edit once the server accepted `resolved` as the next revision. */
export function savedTeamDraftEdit(plan: TeamPlan, resolved: ResolvedTeamDraft): TeamDraftEdit {
  return {
    planId: plan.id,
    revision: resolved.revision + 1,
    base: resolved.draft,
    draft: resolved.draft,
  };
}

function trimmedTeamDraft(draft: TeamDraft): TeamDraft {
  return {
    agents: draft.agents.map((agent) => ({ ...agent, label: agent.label.trim() })),
    tasks: draft.tasks.map((task) => ({
      ...task,
      title: task.title.trim(),
      brief: task.brief.trim(),
    })),
  };
}

/** The first problem that would make the server reject the draft, as a sentence, or null. */
export function teamDraftIssue(draft: TeamDraft): string | null {
  const unnamed = draft.agents.find((agent) => agent.label.trim() === "");
  if (unnamed !== undefined) return `Agent "${unnamed.id}" needs a name.`;
  const briefless = draft.tasks.find((task) => task.brief.trim() === "");
  if (briefless !== undefined) return `Task "${briefless.title}" needs a brief.`;
  return validateTeamDraft(trimmedTeamDraft(draft))?.message ?? null;
}

export function teamSaveCommand(input: {
  readonly threadId: ThreadId;
  readonly resolved: ResolvedTeamDraft;
  readonly commandId: CommandId;
}): TeamCommand<"team.edit"> {
  return {
    type: "team.edit",
    commandId: input.commandId,
    threadId: input.threadId,
    expectedRevision: input.resolved.revision,
    ...trimmedTeamDraft(input.resolved.draft),
  };
}

/** Saves unsaved edits first, then approves the revision that save creates. */
export function teamApproveCommands(input: {
  readonly threadId: ThreadId;
  readonly resolved: ResolvedTeamDraft;
  readonly newCommandId: () => CommandId;
}): ReadonlyArray<TeamCommand<"team.edit" | "team.approve">> {
  const { threadId, resolved } = input;
  const approve = (expectedRevision: number): TeamCommand<"team.approve"> => ({
    type: "team.approve",
    commandId: input.newCommandId(),
    threadId,
    expectedRevision,
  });
  return resolved.dirty
    ? [
        teamSaveCommand({ threadId, resolved, commandId: input.newCommandId() }),
        approve(resolved.revision + 1),
      ]
    : [approve(resolved.revision)];
}

export function teamCancelCommand(input: {
  readonly threadId: ThreadId;
  readonly commandId: CommandId;
}): TeamCommand<"team.cancel"> {
  return { type: "team.cancel", commandId: input.commandId, threadId: input.threadId };
}

/** Retries on the task's own agent unless `agentId` names another. */
export function teamRetryCommand(input: {
  readonly threadId: ThreadId;
  readonly task: Pick<TeamTask, "id" | "agentId">;
  readonly agentId?: TeamAgentId;
  readonly commandId: CommandId;
}): TeamCommand<"team.task.retry"> {
  return {
    type: "team.task.retry",
    commandId: input.commandId,
    threadId: input.threadId,
    taskId: input.task.id,
    ...(input.agentId === undefined || input.agentId === input.task.agentId
      ? {}
      : { agentId: input.agentId }),
  };
}

export function canCancelTeam(plan: Pick<TeamPlan, "status">): boolean {
  return plan.status === "proposed" || plan.status === "running";
}

/** Mirrors the server: a failed or cancelled task, while its plan runs or has failed. */
export function canRetryTeamTask(
  plan: Pick<TeamPlan, "status">,
  task: Pick<TeamTask, "status">,
): boolean {
  return (
    (plan.status === "running" || plan.status === "failed") &&
    (task.status === "failed" || task.status === "cancelled")
  );
}

export interface TeamCommandFailure {
  /** The plan changed since this client read it, so the command named a stale revision. */
  readonly conflict: boolean;
  readonly message: string;
}

/** Reads a rejected team command, whose message starts with the server's `team_*` code. */
export function teamCommandFailure(error: unknown): TeamCommandFailure {
  const record =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const text = [record.detail, record.message].find(
    (value): value is string => typeof value === "string" && value.trim() !== "",
  );
  const coded = text === undefined ? null : /^(team_[a-z_]+):\s*([\s\S]*)$/.exec(text.trim());
  return {
    conflict: coded?.[1] === "team_revision_conflict",
    message: coded?.[2] || text?.trim() || "The team could not be updated.",
  };
}
