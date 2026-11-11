import {
  type CommandId,
  type ModelSelection,
  type OrchestrationV2Command,
  type OrchestrationV2Notification,
  type OrchestrationV2ThreadShell,
  TeamAgentId,
  type TeamAgentRole,
  type TeamDraft,
  type TeamPlan,
  type TeamPlanId,
  type TeamPlanStatus,
  type TeamPlanSummary,
  type TeamTask,
  type TeamTaskId,
  type TeamTaskRef,
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

/** A team a thread belongs to: the plan it holds as the lead, or the one it runs a task for. */
export interface ThreadTeam {
  readonly role: "lead" | "agent";
  readonly leadThreadId: ThreadId;
  readonly planId: TeamPlanId;
  /** Null while the lead's shell is not loaded, or once the lead holds another plan. */
  readonly summary: TeamPlanSummary | null;
}

/** Reads shells only, so a thread list or a strip never subscribes to the lead's detail. */
export function threadTeam(
  thread: Pick<OrchestrationV2ThreadShell, "id" | "teamTask" | "teamSummary">,
  lead: Pick<OrchestrationV2ThreadShell, "teamSummary"> | null,
): ThreadTeam | null {
  if (thread.teamTask !== undefined) {
    const { rootThreadId, planId } = thread.teamTask;
    const summary = lead?.teamSummary;
    return {
      role: "agent",
      leadThreadId: rootThreadId,
      planId,
      summary: summary?.planId === planId ? summary : null,
    };
  }
  if (thread.teamSummary === undefined) return null;
  return {
    role: "lead",
    leadThreadId: thread.id,
    planId: thread.teamSummary.planId,
    summary: thread.teamSummary,
  };
}

const TEAM_STATUS_LABELS: Record<TeamPlanStatus, string> = {
  proposed: "Waiting for your approval",
  running: "Running",
  completed: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export interface TeamStatusText {
  readonly label: string;
  /** How far the tasks got, such as "2 of 3 done, 1 failed"; null before the team starts. */
  readonly progress: string | null;
  /** The label, with the progress while the team still needs watching. */
  readonly line: string;
}

export function teamStatusText(
  summary: Pick<TeamPlanSummary, "status" | "total" | "completed" | "failed">,
): TeamStatusText {
  const label = TEAM_STATUS_LABELS[summary.status];
  if (summary.status === "proposed") return { label, progress: null, line: label };
  const failed = summary.failed > 0 ? `, ${summary.failed} failed` : "";
  const progress = `${summary.completed} of ${summary.total} done${failed}`;
  const watching = summary.status === "running" || summary.status === "failed";
  return { label, progress, line: watching ? `${label} · ${progress}` : label };
}

function listLabels(labels: ReadonlyArray<string>): string {
  return labels.length < 2
    ? (labels[0] ?? "")
    : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * The line shown above each task that starts from other tasks' results, keyed by that task. It
 * names the senders unless they are the tasks just above it, which the list already shows.
 */
export function teamHandoffs(
  plan: Pick<TeamPlan, "agents" | "tasks">,
): ReadonlyMap<TeamTaskId, string> {
  const labelOf = (task: TeamTask) =>
    plan.agents.find((agent) => agent.id === task.agentId)?.label ?? task.title;
  const indexById = new Map(plan.tasks.map((task, index) => [task.id, index]));
  const handoffs = new Map<TeamTaskId, string>();
  for (const [index, task] of plan.tasks.entries()) {
    const sources = [...new Set(task.dependsOn)]
      .flatMap((id) => {
        const source = indexById.get(id);
        return source === undefined ? [] : [source];
      })
      .toSorted((a, b) => a - b);
    if (sources.length === 0) continue;
    const plural = sources.length > 1;
    const verb = task.status !== "pending" ? "passed to" : plural ? "go to" : "goes to";
    const receiver = labelOf(task);
    const adjacent = sources.every((source, k) => source === index - sources.length + k);
    if (adjacent) {
      const subject = !plural
        ? "Result"
        : sources.length === 2
          ? "Both results"
          : `All ${sources.length} results`;
      handoffs.set(task.id, `${subject} ${verb} ${receiver}`);
      continue;
    }
    const senders = listLabels([...new Set(sources.map((source) => labelOf(plan.tasks[source]!)))]);
    handoffs.set(task.id, `${plural ? "Results" : "Result"} from ${senders} ${verb} ${receiver}`);
  }
  return handoffs;
}

/** The task an agent's thread runs in its lead's plan; null once the lead holds another plan. */
export function teamTaskOfThread(
  plan: Pick<TeamPlan, "id" | "tasks">,
  ref: Pick<TeamTaskRef, "planId" | "taskId" | "attempt">,
): { readonly task: TeamTask; readonly superseded: boolean } | null {
  if (plan.id !== ref.planId) return null;
  const task = plan.tasks.find((candidate) => candidate.id === ref.taskId);
  // A retry runs the next attempt in a new thread, so this one's usage is no longer the task's.
  return task === undefined ? null : { task, superseded: ref.attempt < task.attempt };
}

/**
 * The notification that wakes a lead once every task of its team completed. TeamTaskService is
 * the only sender of a completed system notification; a restart continuation is `updated`.
 */
export function isTeamFinishedNotification(
  notification: Pick<OrchestrationV2Notification, "source" | "outcome">,
): boolean {
  return notification.source.kind === "system" && notification.outcome === "completed";
}
