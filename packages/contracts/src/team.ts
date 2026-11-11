import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  IsoDateTime,
  NonNegativeInt,
  PositiveInt,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";

export const TEAM_MAX_AGENTS = 8;
export const TEAM_MAX_TASKS = 16;
export const TEAM_LABEL_MAX_CHARS = 120;
export const TEAM_BRIEF_MAX_CHARS = 6_000;
export const TEAM_RESULT_MAX_CHARS = 4_000;
export const TEAM_DEFAULT_MAX_PARALLEL_PER_PROVIDER = 2;

export const TeamPlanId = TrimmedNonEmptyString.pipe(Schema.brand("TeamPlanId"));
export type TeamPlanId = typeof TeamPlanId.Type;

// The lead agent chooses these, and a task's thread id is derived from them.
const TeamSlug = TrimmedNonEmptyString.check(Schema.isMaxLength(64));
export const TeamAgentId = TeamSlug.pipe(Schema.brand("TeamAgentId"));
export type TeamAgentId = typeof TeamAgentId.Type;
export const TeamTaskId = TeamSlug.pipe(Schema.brand("TeamTaskId"));
export type TeamTaskId = typeof TeamTaskId.Type;

export const TeamAgentRole = Schema.Literals([
  "plan",
  "research",
  "implement",
  "test",
  "review",
  "integrate",
  "custom",
]);
export type TeamAgentRole = typeof TeamAgentRole.Type;

/** `shared` works in the lead's checkout; `worktree` gets its own, cut from the lead's HEAD. */
export const TeamWorkspace = Schema.Literals(["shared", "worktree"]);
export type TeamWorkspace = typeof TeamWorkspace.Type;

export const TeamAgent = Schema.Struct({
  id: TeamAgentId,
  label: TrimmedNonEmptyString,
  role: TeamAgentRole,
  modelSelection: ModelSelection,
  workspace: TeamWorkspace,
});
export type TeamAgent = typeof TeamAgent.Type;

export const TeamTaskDraft = Schema.Struct({
  id: TeamTaskId,
  title: TrimmedNonEmptyString,
  brief: TrimmedNonEmptyString,
  agentId: TeamAgentId,
  dependsOn: Schema.Array(TeamTaskId),
});
export type TeamTaskDraft = typeof TeamTaskDraft.Type;

/** What a proposal or an edit carries: the plan without its runtime state. */
export const TeamDraft = Schema.Struct({
  agents: Schema.Array(TeamAgent),
  tasks: Schema.Array(TeamTaskDraft),
});
export type TeamDraft = typeof TeamDraft.Type;

export const TeamTaskStatus = Schema.Literals([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type TeamTaskStatus = typeof TeamTaskStatus.Type;

export const TeamTaskUsage = Schema.Struct({
  inputTokens: NonNegativeInt,
  outputTokens: NonNegativeInt,
});
export type TeamTaskUsage = typeof TeamTaskUsage.Type;

export const TeamTask = Schema.Struct({
  ...TeamTaskDraft.fields,
  status: TeamTaskStatus,
  /** Counts from 1. A retry starts the next attempt in a new thread. */
  attempt: PositiveInt,
  threadId: Schema.NullOr(ThreadId),
  result: Schema.NullOr(Schema.String),
  usage: Schema.optional(TeamTaskUsage),
  startedAt: Schema.NullOr(IsoDateTime),
  completedAt: Schema.NullOr(IsoDateTime),
});
export type TeamTask = typeof TeamTask.Type;

export const TeamPlanStatus = Schema.Literals([
  "proposed",
  "running",
  "completed",
  "failed",
  "cancelled",
]);
export type TeamPlanStatus = typeof TeamPlanStatus.Type;

export const TeamPlan = Schema.Struct({
  id: TeamPlanId,
  /** Counts edits while the plan is proposed; approval names the revision it accepts. */
  revision: PositiveInt,
  status: TeamPlanStatus,
  goal: TrimmedNonEmptyString,
  agents: Schema.Array(TeamAgent),
  tasks: Schema.Array(TeamTask),
  maxParallelPerProvider: PositiveInt,
  proposedAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TeamPlan = typeof TeamPlan.Type;

/** Where a lead's plan stands, for thread lists. Pending tasks are `total` less the other counts. */
export const TeamPlanSummary = Schema.Struct({
  planId: TeamPlanId,
  status: TeamPlanStatus,
  revision: PositiveInt,
  total: NonNegativeInt,
  completed: NonNegativeInt,
  failed: NonNegativeInt,
  running: NonNegativeInt,
  cancelled: NonNegativeInt,
});
export type TeamPlanSummary = typeof TeamPlanSummary.Type;

/** A plan this build cannot read becomes null instead of failing the whole thread. */
export const StoredTeamPlan = Schema.NullOr(TeamPlan).pipe(
  Schema.catchDecoding(() => Effect.succeedSome(null)),
);

/** On a team agent's thread: the task it runs for the plan on `rootThreadId`. */
export const TeamTaskRef = Schema.Struct({
  rootThreadId: ThreadId,
  planId: TeamPlanId,
  taskId: TeamTaskId,
  attempt: PositiveInt,
});
export type TeamTaskRef = typeof TeamTaskRef.Type;
