import {
  TEAM_BRIEF_MAX_CHARS,
  TEAM_DEFAULT_MAX_PARALLEL_PER_PROVIDER,
  TEAM_RESULT_MAX_CHARS,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
  type TeamDraft,
  type TeamPlan,
  type TeamPlanId,
  type TeamTask,
  type TeamTaskId,
  ThreadId,
} from "@codenine/contracts";
import {
  settledTeamPlanStatus,
  startableTeamTasks,
  validateTeamDraft,
} from "@codenine/shared/team";

export type TeamCommand = Extract<
  OrchestrationV2ServerCommand,
  { readonly type: `team.${string}` }
>;

export type TeamDecision =
  | { readonly type: "rejected"; readonly reason: string }
  /** The command arrived too late to matter, such as a result for a task that was retried. */
  | { readonly type: "unchanged" }
  | {
      readonly type: "updated";
      readonly plan: TeamPlan;
      /** Tasks this command set running; each needs its thread launched. */
      readonly launch: ReadonlyArray<TeamTask>;
      readonly stop: ReadonlyArray<ThreadId>;
      /** The plan just finished or got stuck, so the lead has results to act on. */
      readonly wakeLead: boolean;
      /** The plan just completed or was cancelled, so its task threads are done with. */
      readonly settleTaskThreads: boolean;
    };

/** One thread per attempt: a retry on another model never continues the earlier session. */
export const teamTaskThreadId = (planId: TeamPlanId, taskId: TeamTaskId, attempt: number) =>
  ThreadId.make(
    ["thread", "team", planId, taskId, attempt]
      .map((part) => encodeURIComponent(String(part)))
      .join(":"),
  );

const RESULT_TRUNCATED = "\n\n[Result cut short. Read the task's thread for the rest.]";

function truncatedResult(result: string): string {
  const characters = Array.from(result);
  return characters.length <= TEAM_RESULT_MAX_CHARS
    ? result
    : `${characters.slice(0, TEAM_RESULT_MAX_CHARS).join("")}${RESULT_TRUNCATED}`;
}

const rejected = (code: string, message: string): TeamDecision => ({
  type: "rejected",
  reason: `${code}: ${message}`,
});

const pendingTasks = (draft: TeamDraft): ReadonlyArray<TeamTask> =>
  draft.tasks.map((task) => ({
    ...task,
    status: "pending",
    attempt: 1,
    threadId: null,
    result: null,
    startedAt: null,
    completedAt: null,
  }));

const revisionConflict = (plan: TeamPlan, expectedRevision: number) =>
  rejected(
    "team_revision_conflict",
    `The team is at revision ${plan.revision}, not ${expectedRevision}. Read it again before changing it.`,
  );

export function decideTeamCommand(input: {
  readonly thread: Pick<OrchestrationV2AppThread, "team" | "teamTask">;
  readonly command: TeamCommand;
  readonly now: string;
  /** The id a plan proposed by this command gets. */
  readonly newPlanId: TeamPlanId;
}): TeamDecision {
  const { command, now } = input;
  const current = input.thread.team ?? null;

  // Starts every task that may run now and settles the plan's status on what is left.
  const advance = (plan: TeamPlan, wakeWhenSettled: boolean): TeamDecision => {
    const starting = new Set(startableTeamTasks(plan).map((task) => task.id));
    const tasks = plan.tasks.map((task): TeamTask =>
      starting.has(task.id)
        ? {
            ...task,
            status: "running",
            threadId: teamTaskThreadId(plan.id, task.id, task.attempt),
            startedAt: now,
            completedAt: null,
          }
        : task,
    );
    const status = settledTeamPlanStatus({ ...plan, tasks });
    return {
      type: "updated",
      plan: { ...plan, tasks, status, updatedAt: now },
      launch: tasks.filter((task) => starting.has(task.id)),
      stop: [],
      wakeLead: wakeWhenSettled && status !== "running",
      settleTaskThreads: status === "completed",
    };
  };

  switch (command.type) {
    case "team.propose": {
      if (input.thread.teamTask !== undefined) {
        return rejected("team_task_thread", "A team agent's thread cannot propose a team.");
      }
      if (current?.status === "running") {
        return rejected(
          "team_plan_running",
          "A team is running on this thread. Cancel it before proposing another.",
        );
      }
      if (command.goal.length > TEAM_BRIEF_MAX_CHARS) {
        return rejected(
          "team_invalid",
          `The goal is longer than ${TEAM_BRIEF_MAX_CHARS} characters.`,
        );
      }
      const issue = validateTeamDraft(command);
      if (issue !== null) return rejected("team_invalid", issue.message);
      return {
        type: "updated",
        plan: {
          id: input.newPlanId,
          revision: 1,
          status: "proposed",
          goal: command.goal,
          agents: command.agents,
          tasks: pendingTasks(command),
          maxParallelPerProvider: TEAM_DEFAULT_MAX_PARALLEL_PER_PROVIDER,
          proposedAt: now,
          updatedAt: now,
        },
        launch: [],
        stop: [],
        wakeLead: false,
        settleTaskThreads: false,
      };
    }
    case "team.edit": {
      if (current?.status !== "proposed") {
        return rejected("team_plan_not_proposed", "Only a proposed team can be edited.");
      }
      if (current.revision !== command.expectedRevision) {
        return revisionConflict(current, command.expectedRevision);
      }
      const issue = validateTeamDraft(command);
      if (issue !== null) return rejected("team_invalid", issue.message);
      return {
        type: "updated",
        plan: {
          ...current,
          revision: current.revision + 1,
          agents: command.agents,
          tasks: pendingTasks(command),
          maxParallelPerProvider: command.maxParallelPerProvider ?? current.maxParallelPerProvider,
          updatedAt: now,
        },
        launch: [],
        stop: [],
        wakeLead: false,
        settleTaskThreads: false,
      };
    }
    case "team.approve": {
      if (current?.status !== "proposed") {
        return rejected("team_plan_not_proposed", "Only a proposed team can be approved.");
      }
      if (current.revision !== command.expectedRevision) {
        return revisionConflict(current, command.expectedRevision);
      }
      return advance({ ...current, status: "running" }, false);
    }
    case "team.cancel": {
      if (current?.status !== "proposed" && current?.status !== "running") {
        return rejected("team_plan_not_active", "There is no proposed or running team to cancel.");
      }
      const running = current.tasks.filter((task) => task.status === "running");
      return {
        type: "updated",
        plan: {
          ...current,
          status: "cancelled",
          tasks: current.tasks.map((task) =>
            task.status === "running" ? { ...task, status: "cancelled", completedAt: now } : task,
          ),
          updatedAt: now,
        },
        launch: [],
        stop: running.flatMap((task) => (task.threadId === null ? [] : [task.threadId])),
        wakeLead: false,
        // A proposed team has no threads yet.
        settleTaskThreads: current.status === "running",
      };
    }
    case "team.task.retry": {
      if (current?.status !== "running" && current?.status !== "failed") {
        return rejected(
          "team_plan_not_retryable",
          "A task can be retried only while its team is running or has failed.",
        );
      }
      const task = current.tasks.find((candidate) => candidate.id === command.taskId);
      if (task === undefined) {
        return rejected("team_task_unknown", `The team has no task "${command.taskId}".`);
      }
      if (task.status !== "failed" && task.status !== "cancelled") {
        return rejected(
          "team_task_not_retryable",
          `Task "${task.id}" is ${task.status}. Only a failed or cancelled task can be retried.`,
        );
      }
      const agentId = command.agentId ?? task.agentId;
      if (!current.agents.some((agent) => agent.id === agentId)) {
        return rejected("team_agent_unknown", `The team has no agent "${agentId}".`);
      }
      const { usage: _usage, ...settled } = task;
      const retried: TeamTask = {
        ...settled,
        agentId,
        status: "pending",
        attempt: task.attempt + 1,
        threadId: null,
        result: null,
        startedAt: null,
        completedAt: null,
      };
      return advance(
        {
          ...current,
          tasks: current.tasks.map((candidate) => (candidate.id === task.id ? retried : candidate)),
        },
        false,
      );
    }
    case "team.task.settle": {
      const task =
        current?.id === command.planId && current.status === "running"
          ? current.tasks.find((candidate) => candidate.id === command.taskId)
          : undefined;
      if (
        current === null ||
        task === undefined ||
        task.status !== "running" ||
        task.attempt !== command.attempt
      ) {
        return { type: "unchanged" };
      }
      const settled: TeamTask = {
        ...task,
        status: command.status,
        result: truncatedResult(command.result),
        ...(command.usage === undefined ? {} : { usage: command.usage }),
        completedAt: now,
      };
      return advance(
        {
          ...current,
          tasks: current.tasks.map((candidate) => (candidate.id === task.id ? settled : candidate)),
        },
        true,
      );
    }
  }
}
