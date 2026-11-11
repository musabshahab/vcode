import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type TeamTaskUsage,
  type ThreadId,
} from "@codenine/contracts";
import {
  delegatedTaskProgress,
  subagentResultForRun,
} from "@codenine/provider-core/server/subagentProjection";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { forkParked } from "../serverActivation.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

export class TeamTaskReactor extends Context.Service<
  TeamTaskReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
    readonly handle: (event: OrchestrationV2DomainEvent) => Effect.Effect<void>;
    /** Settles running tasks whose work ended while nothing listened, such as across a restart. */
    readonly recover: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("codenine/orchestration-v2/TeamTaskReactor") {}

const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;

  /**
   * Settles the task `threadId` runs when its work has ended. Returns the run whose restart
   * continuation is still pending, which decides whether the work ended.
   */
  const settleTaskThread = Effect.fn("TeamTaskReactor.settleTaskThread")(function* (
    threadId: ThreadId,
  ) {
    // A task whose launch has not run yet has no thread; the launch effect is still queued.
    const thread = yield* projections
      .getThread(threadId)
      .pipe(Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }));
    const ref = thread?.teamTask;
    if (thread == null || ref === undefined) return undefined;
    const lead = yield* projections
      .getThread(ref.rootThreadId)
      .pipe(Effect.catchTags({ ProjectionStoreThreadNotFoundError: () => Effect.succeed(null) }));
    const task =
      lead?.team?.id === ref.planId
        ? lead.team.tasks.find((candidate) => candidate.id === ref.taskId)
        : undefined;
    // Only the thread the plan launched for this attempt reports its result.
    if (
      task === undefined ||
      task.status !== "running" ||
      task.attempt !== ref.attempt ||
      task.threadId !== thread.id
    ) {
      return undefined;
    }
    const work = yield* projections.getThreadRecords(
      thread.id,
      ["runs", "messages", "subagents", "providerThreads"],
      { messageRoles: ["user"], omitSettledSubagents: true },
    );
    // A queued follow-up or a delegate still running means the agent is not done.
    const progress = delegatedTaskProgress(work);
    const run = progress.resultRun;
    if (progress.state !== "result_available" || run === undefined) return undefined;
    // A run a restart cut short may go on in a continuation run.
    if (yield* engine.restartContinuationPending(run)) return run;
    const output = yield* projections.getThreadRecords(
      thread.id,
      ["messages", "turnItems", "providerTurns"],
      {
        messageRoles: ["assistant"],
        messageRunIds: [run.id],
        turnItemRunIds: [run.id],
        turnItemTypes: ["assistant_message", "error"],
      },
    );
    const usage = output.providerTurns.reduce<TeamTaskUsage | undefined>((total, turn) => {
      const turnUsage = turn.turnTokenUsage;
      if (turnUsage?.inputTokens === undefined || turnUsage.outputTokens === undefined) {
        return total;
      }
      return {
        inputTokens: (total?.inputTokens ?? 0) + turnUsage.inputTokens,
        outputTokens: (total?.outputTokens ?? 0) + turnUsage.outputTokens,
      };
    }, undefined);
    // One id per task thread: the reactor and recovery settling the same task commit once.
    yield* engine.dispatch({
      type: "team.task.settle",
      commandId: CommandId.make(`server:team-task-settle:${thread.id}`),
      threadId: ref.rootThreadId,
      planId: ref.planId,
      taskId: ref.taskId,
      attempt: ref.attempt,
      status:
        run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : "cancelled",
      result: subagentResultForRun(output, run).text,
      ...(usage === undefined ? {} : { usage }),
    });
    return undefined;
  });

  // Runs for every domain event; all but the end of a team agent's run return at once.
  const handle: TeamTaskReactor["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
      if (event.type !== "run.updated" || !TERMINAL_RUN_STATUSES.has(event.payload.status)) return;
      yield* settleTaskThread(event.threadId);
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("settling a team task failed", { threadId: event.threadId, cause }),
        ),
      ),
  );

  const recover: TeamTaskReactor["Service"]["recover"] = Effect.fn("TeamTaskReactor.recover")(
    function* () {
      const leadThreadIds = yield* projections.getRecoveryThreadIds("team-plans");
      yield* Effect.annotateCurrentSpan("recovery.teamPlanThreads", leadThreadIds.length);
      yield* Effect.forEach(
        leadThreadIds,
        (leadThreadId) =>
          Effect.gen(function* () {
            const plan = (yield* projections.getThread(leadThreadId)).team;
            if (plan?.status !== "running") return;
            for (const task of plan.tasks) {
              const taskThreadId = task.threadId;
              if (task.status !== "running" || taskThreadId === null) continue;
              const continuing = yield* settleTaskThread(taskThreadId);
              // A declined continuation writes no event, so nothing else would settle this task.
              if (continuing !== undefined) {
                yield* engine
                  .awaitRestartContinuation(continuing)
                  .pipe(
                    Effect.andThen(settleTaskThread(taskThreadId)),
                    Effect.ignore,
                    Effect.forkScoped,
                  );
              }
            }
          }).pipe(
            Effect.catchCause((cause) =>
              Effect.logWarning("Failed to recover a running team plan", { leadThreadId, cause }),
            ),
          ),
        { concurrency: 8, discard: true },
      );
    },
    Effect.catchCause((cause) =>
      Effect.logWarning("Failed to look for running team plans during recovery", { cause }),
    ),
  );

  const start: TeamTaskReactor["Service"]["start"] = () =>
    forkParked(
      Effect.gen(function* () {
        // Runs end before activation too (restart recovery, the effect worker), unheard by the
        // parked stream, so the sweep follows it. Both may settle a task; the second is a no-op.
        yield* Stream.runForEach(engine.streamDomainEvents, handle).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("team task event stream failed", { cause }),
          ),
          Effect.forkScoped,
        );
        yield* recover();
      }),
    );

  return { start, handle, recover } satisfies TeamTaskReactor["Service"];
});

export const layer = Layer.effect(TeamTaskReactor, make);
