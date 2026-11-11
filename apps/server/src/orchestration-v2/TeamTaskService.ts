import {
  CommandId,
  MessageId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ThreadLaunchWorkspaceStrategy,
  ProjectId,
  type TeamAgent,
  type TeamPlan,
  type TeamPlanId,
  type TeamTask,
  type TeamTaskId,
  ThreadId,
} from "@codenine/contracts";
import { formatThreadLink } from "@codenine/shared/threadLinks";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as ProjectService from "../project/ProjectService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import * as ThreadLaunchService from "./ThreadLaunchService.ts";
import { teamTaskThreadId } from "./TeamPlan.ts";
import * as ThreadManagementService from "./ThreadManagementService.ts";
import { userFacingDispatchErrorMessage } from "./UserFacingErrors.ts";

export class TeamTaskError extends Schema.TaggedError<TeamTaskError>()("TeamTaskError", {
  operation: Schema.Literals(["launch", "stop", "wake-lead", "settle-threads"]),
  threadId: ThreadId,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Team task ${this.operation} failed for thread ${this.threadId}.`;
  }
}

const WORKSPACE_ERROR_MESSAGES = {
  "project-missing": "The lead thread's project no longer exists.",
  "head-unresolved": "The lead thread's checkout has no commit to start a worktree from.",
  "commit-outside-project":
    'The lead thread\'s checkout is another repository, so a worktree cannot start from its commit. Use workspace "shared" for this agent.',
} as const;

class TeamTaskWorkspaceError extends Schema.TaggedError<TeamTaskWorkspaceError>()(
  "TeamTaskWorkspaceError",
  {
    reason: Schema.Literals(["project-missing", "head-unresolved", "commit-outside-project"]),
    projectId: ProjectId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return WORKSPACE_ERROR_MESSAGES[this.reason];
  }
}

export class TeamTaskService extends Context.Service<
  TeamTaskService,
  {
    /** Starts the thread of a task its plan marked running. Stale requests do nothing. */
    readonly launchTask: (input: {
      readonly leadThreadId: ThreadId;
      readonly planId: TeamPlanId;
      readonly taskId: TeamTaskId;
      readonly attempt: number;
    }) => Effect.Effect<void, TeamTaskError>;
    readonly stopTask: (input: {
      readonly taskThreadId: ThreadId;
      readonly commandId: CommandId;
    }) => Effect.Effect<void, TeamTaskError>;
    /** Tells the lead agent its plan finished or got stuck, once per `commandId`. */
    readonly wakeLead: (input: {
      readonly leadThreadId: ThreadId;
      readonly planId: TeamPlanId;
      readonly commandId: CommandId;
    }) => Effect.Effect<void, TeamTaskError>;
    /** Settles the threads of every attempt of a completed or cancelled plan, never the lead. */
    readonly settleTaskThreads: (input: {
      readonly leadThreadId: ThreadId;
      readonly planId: TeamPlanId;
    }) => Effect.Effect<void, TeamTaskError>;
  }
>()("codenine/orchestration-v2/TeamTaskService") {}

interface EarlierResult {
  readonly task: TeamTask;
  /** Set when the task worked in a checkout of its own. */
  readonly checkout: Pick<OrchestrationV2AppThread, "branch" | "worktreePath"> | undefined;
}

function taskBrief(input: {
  readonly plan: TeamPlan;
  readonly agent: TeamAgent;
  readonly task: TeamTask;
  readonly earlier: ReadonlyArray<EarlierResult>;
}): string {
  const { agent, task } = input;
  const sections = [
    agent.role === "custom"
      ? `Act as "${agent.label}" on this team.`
      : `Act as the ${agent.role} agent "${agent.label}" on this team.`,
    `Team goal:\n${input.plan.goal}`,
    `Your task: ${task.title}\n${task.brief}`,
  ];
  if (input.earlier.length > 0) {
    sections.push(
      [
        "Results from earlier tasks:",
        ...input.earlier.map(({ task: earlier, checkout }) => {
          const where =
            checkout === undefined
              ? ""
              : `\nIts work is on branch ${checkout.branch ?? "(detached)"} in worktree ${checkout.worktreePath}.`;
          return `### ${earlier.title}${where}\n${earlier.result ?? "No result was recorded."}`;
        }),
      ].join("\n\n"),
    );
  }
  sections.push(
    "Your final message is the hand-off to the next agent. State what you did and where: files, branch, and anything left open.",
  );
  return sections.join("\n\n");
}

const isWorkspaceError = Schema.is(TeamTaskWorkspaceError);

// A launch failure reads best from its deepest cause; a workspace failure already says what to do.
const startFailureReason = (failure: unknown): string =>
  isWorkspaceError(failure)
    ? failure.message
    : (userFacingDispatchErrorMessage(failure) ?? "its thread could not be launched.");

const WAKE_RESULT_BUDGET_CHARS = 16_000;

function wakeText(plan: TeamPlan): string {
  let budget = WAKE_RESULT_BUDGET_CHARS;
  const tasks = plan.tasks.map((task) => {
    const agent = plan.agents.find((candidate) => candidate.id === task.agentId);
    const who =
      agent === undefined ? task.agentId : `${agent.label} (${agent.modelSelection.model})`;
    const thread =
      task.threadId === null
        ? "not started"
        : formatThreadLink({ environmentId: null, threadId: task.threadId }, task.title);
    const heading = `- ${task.title}: ${task.status}. Agent: ${who}. Thread: ${thread}`;
    if (task.result === null) return heading;
    if (task.result.length > budget) {
      return `${heading}\n  Result left out to keep this message short. Read the thread.`;
    }
    budget -= task.result.length;
    return `${heading}\n${task.result}`;
  });
  return [
    plan.status === "completed"
      ? "Your team finished: every task completed."
      : "Your team is stuck: a task did not complete, so the tasks that depend on it cannot start.",
    `Goal: ${plan.goal}`,
    ["Tasks:", ...tasks].join("\n"),
    plan.status === "completed"
      ? "Write the user one final summary: what changed and in which main files, how it was verified (the tests or checks the agents ran, and their results), what is still open or untested, and how to run or try it. End with each task thread's link for detail."
      : "Tell the user which task failed and which tasks it blocks. They decide whether to retry it; do not redo the work yourself unless they ask.",
  ].join("\n\n");
}

const STOP_SETTLE_WAIT_MS = 10 * 60 * 1_000;

const make = Effect.gen(function* () {
  const scope = yield* Effect.scope;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const launches = yield* ThreadLaunchService.ThreadLaunchService;
  const projects = yield* ProjectService.ProjectService;
  const git = yield* GitVcsDriver.GitVcsDriver;

  const workspaceFor = Effect.fn("TeamTaskService.workspaceFor")(function* (
    lead: OrchestrationV2AppThread,
    agent: TeamAgent,
  ): Effect.fn.Return<OrchestrationV2ThreadLaunchWorkspaceStrategy, TeamTaskWorkspaceError> {
    const branch = lead.branch === null ? {} : { branch: lead.branch };
    if (agent.workspace === "shared") {
      return lead.worktreePath === null
        ? { type: "root", ...branch }
        : { type: "existing_worktree", worktreePath: lead.worktreePath, ...branch };
    }
    const { projectId } = lead;
    const project = Option.getOrUndefined(
      yield* projects
        .getById(projectId)
        .pipe(
          Effect.mapError(
            (cause) => new TeamTaskWorkspaceError({ reason: "project-missing", projectId, cause }),
          ),
        ),
    );
    if (project === undefined) {
      return yield* new TeamTaskWorkspaceError({ reason: "project-missing", projectId });
    }
    const base = yield* git
      .resolveCommit({ cwd: lead.worktreePath ?? project.workspaceRoot, revision: "HEAD" })
      .pipe(
        Effect.mapError(
          (cause) => new TeamTaskWorkspaceError({ reason: "head-unresolved", projectId, cause }),
        ),
      );
    // Launch creates the worktree from the project root, which must hold the lead's commit.
    if (lead.worktreePath !== null) {
      yield* git.resolveCommit({ cwd: project.workspaceRoot, revision: base.commitSha }).pipe(
        Effect.mapError(
          (cause) =>
            new TeamTaskWorkspaceError({
              reason: "commit-outside-project",
              projectId,
              cause,
            }),
        ),
      );
    }
    return { type: "worktree", baseRef: base.commitSha, startFromOrigin: false };
  });

  const earlierResults = Effect.fn("TeamTaskService.earlierResults")(function* (
    lead: OrchestrationV2AppThread,
    plan: TeamPlan,
    task: TeamTask,
  ) {
    return yield* Effect.forEach(task.dependsOn, (dependencyId) =>
      Effect.gen(function* () {
        const earlier = plan.tasks.find((candidate) => candidate.id === dependencyId);
        if (earlier === undefined) return [];
        const shell =
          earlier.threadId === null ? null : yield* threads.getThreadShell(earlier.threadId);
        const ownCheckout =
          shell !== null && shell.worktreePath !== null && shell.worktreePath !== lead.worktreePath;
        return [
          {
            task: earlier,
            checkout: ownCheckout
              ? { branch: shell.branch, worktreePath: shell.worktreePath }
              : undefined,
          } satisfies EarlierResult,
        ];
      }),
    ).pipe(Effect.map((results) => results.flat()));
  });

  const launchTask: TeamTaskService["Service"]["launchTask"] = Effect.fn(
    "TeamTaskService.launchTask",
  )(
    function* (input) {
      const { thread: lead } = yield* threads.getThreadRecords(input.leadThreadId, []);
      const plan = lead.team;
      const task =
        plan?.id === input.planId
          ? plan.tasks.find((candidate) => candidate.id === input.taskId)
          : undefined;
      // A cancel or a retry since this effect was written owns the task now.
      if (
        plan == null ||
        task === undefined ||
        task.status !== "running" ||
        task.attempt !== input.attempt ||
        task.threadId === null
      ) {
        return;
      }
      const taskThreadId = task.threadId;
      const agent = plan.agents.find((candidate) => candidate.id === task.agentId);
      const launched = yield* Effect.gen(function* () {
        if (agent === undefined) {
          return yield* Effect.fail(`The team has no agent "${task.agentId}".`);
        }
        yield* launches.launch({
          commandId: CommandId.make(`server:team-task-launch:${taskThreadId}`),
          threadId: taskThreadId,
          projectId: lead.projectId,
          title: task.title,
          modelSelection: agent.modelSelection,
          // The lead's mode is the ceiling its user set; a team agent never gets a broader one.
          runtimeMode: lead.runtimeMode,
          interactionMode: "default",
          workspaceStrategy: yield* workspaceFor(lead, agent),
          initialMessage: {
            text: taskBrief({
              plan,
              agent,
              task,
              earlier: yield* earlierResults(lead, plan, task),
            }),
            attachments: [],
          },
          teamTask: {
            rootThreadId: lead.id,
            planId: plan.id,
            taskId: task.id,
            attempt: task.attempt,
          },
          createdBy: "system",
          creationSource: "server",
        });
      }).pipe(Effect.result);
      if (launched._tag === "Success") return;
      yield* threads.dispatch({
        type: "team.task.settle",
        commandId: CommandId.make(`server:team-task-launch-failed:${taskThreadId}`),
        threadId: lead.id,
        planId: plan.id,
        taskId: task.id,
        attempt: task.attempt,
        status: "failed",
        result: `This task could not start: ${startFailureReason(launched.failure)}`,
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new TeamTaskError({ operation: "launch", threadId: input.leadThreadId, cause }),
        ),
      ),
  );

  const stopTask: TeamTaskService["Service"]["stopTask"] = Effect.fn("TeamTaskService.stopTask")(
    function* (input) {
      // A task cancelled before its launch ran has no thread to stop.
      const shell = yield* threads.getThreadShell(input.taskThreadId);
      if (shell === null || shell.deletedAt !== null) return;
      yield* threads.dispatch({
        type: "thread.stop",
        commandId: CommandId.make(`${input.commandId}:team-task-stop:${input.taskThreadId}`),
        threadId: input.taskThreadId,
        reason: "The team was cancelled",
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) => new TeamTaskError({ operation: "stop", threadId: input.taskThreadId, cause }),
        ),
      ),
  );

  const wakeLead: TeamTaskService["Service"]["wakeLead"] = Effect.fn("TeamTaskService.wakeLead")(
    function* (input) {
      const { thread: lead } = yield* threads.getThreadRecords(input.leadThreadId, []);
      const plan = lead.team;
      // A retry since this effect was written set the plan running again.
      if (
        plan?.id !== input.planId ||
        (plan.status !== "completed" && plan.status !== "failed") ||
        lead.archivedAt !== null ||
        lead.deletedAt !== null
      ) {
        return;
      }
      yield* threads
        .dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(`${input.commandId}:team-lead-wake`),
          threadId: lead.id,
          messageId: MessageId.make(`message:team-lead-wake:${input.commandId}`),
          text: wakeText(plan),
          notification: {
            source: { kind: "system" },
            outcome: plan.status,
            summary: plan.status === "completed" ? "The team finished" : "The team is stuck",
          },
          attachments: [],
          dispatchMode: { type: "queue_after_active" },
          createdBy: "agent",
          creationSource: "server",
        })
        .pipe(
          // A lead whose provider was turned off cannot act on the results; the plan keeps them.
          Effect.catchTags({
            ThreadManagementProviderInstanceDisabledError: (error) =>
              Effect.logInfo("orchestration-v2.team.lead-wake.instance-disabled", {
                threadId: lead.id,
                instanceId: error.instanceId,
              }),
          }),
        );
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new TeamTaskError({ operation: "wake-lead", threadId: input.leadThreadId, cause }),
        ),
      ),
  );

  const settleTaskThread = Effect.fn("TeamTaskService.settleTaskThread")(function* (
    threadId: ThreadId,
  ) {
    const shell = yield* threads.getThreadShell(threadId);
    // An explicit "active" is the user keeping the thread out of Settled.
    if (
      shell === null ||
      shell.deletedAt !== null ||
      shell.archivedAt !== null ||
      shell.settledOverride !== null
    ) {
      return;
    }
    const settle = (attempt: "first" | "after-stop") =>
      threads
        .dispatch({
          type: "thread.settle",
          commandId: CommandId.make(`server:team-thread-settle:${attempt}:${threadId}`),
          threadId,
        })
        .pipe(
          Effect.as(true),
          // Settling refuses a thread that still runs, has a queued message or awaits an answer.
          Effect.catchTags({
            OrchestratorDispatchError: () => Effect.succeed(false),
            OrchestratorCommandPreviouslyRejectedError: () => Effect.succeed(false),
          }),
        );
    if (yield* settle("first")) return;
    if ((yield* threads.getThreadShell(threadId))?.activeRunId == null) return;
    // A cancelled team's thread settles once the Stop it was sent ends its run.
    yield* threads
      .waitForThread({ projectId: shell.projectId, threadId, timeoutMs: STOP_SETTLE_WAIT_MS })
      .pipe(Effect.andThen(settle("after-stop")), Effect.ignore, Effect.forkIn(scope));
  });

  const settleTaskThreads: TeamTaskService["Service"]["settleTaskThreads"] = Effect.fn(
    "TeamTaskService.settleTaskThreads",
  )(
    function* (input) {
      const plan = (yield* threads.getThreadRecords(input.leadThreadId, [])).thread.team;
      if (plan?.id !== input.planId || (plan.status !== "completed" && plan.status !== "cancelled"))
        return;
      // A retry replaced earlier attempts' threads; their ids are derived, so each is found here.
      yield* Effect.forEach(
        plan.tasks.flatMap((task) =>
          Array.from({ length: task.attempt }, (_, index) =>
            teamTaskThreadId(plan.id, task.id, index + 1),
          ),
        ),
        settleTaskThread,
        { discard: true },
      );
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new TeamTaskError({ operation: "settle-threads", threadId: input.leadThreadId, cause }),
        ),
      ),
  );

  return TeamTaskService.of({ launchTask, stopTask, wakeLead, settleTaskThreads });
});

export const layer = Layer.effect(TeamTaskService, make);
