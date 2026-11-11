import {
  CommandId,
  type OrchestrationV2DomainEvent,
  type TeamTaskUsage,
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

  // Runs for every domain event; all but the end of a team agent's run return at once.
  const handle: TeamTaskReactor["Service"]["handle"] = Effect.fnUntraced(
    function* (event) {
      if (event.type !== "run.updated" || !TERMINAL_RUN_STATUSES.has(event.payload.status)) return;
      const thread = yield* projections.getThread(event.threadId);
      const ref = thread.teamTask;
      if (ref === undefined) return;
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
        return;
      }
      const work = yield* projections.getThreadRecords(
        thread.id,
        ["runs", "messages", "subagents", "providerThreads"],
        { messageRoles: ["user"], omitSettledSubagents: true },
      );
      // A queued follow-up or a delegate still running means the agent is not done.
      const progress = delegatedTaskProgress(work);
      const run = progress.resultRun;
      if (progress.state !== "result_available" || run === undefined) return;
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
      yield* engine.dispatch({
        type: "team.task.settle",
        commandId: CommandId.make(`server:team-task-settle:${thread.id}`),
        threadId: ref.rootThreadId,
        planId: ref.planId,
        taskId: ref.taskId,
        attempt: ref.attempt,
        status:
          run.status === "completed"
            ? "completed"
            : run.status === "failed"
              ? "failed"
              : "cancelled",
        result: subagentResultForRun(output, run).text,
        ...(usage === undefined ? {} : { usage }),
      });
    },
    (effect, event) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("settling a team task failed", { threadId: event.threadId, cause }),
        ),
      ),
  );

  const start: TeamTaskReactor["Service"]["start"] = () =>
    forkParked(
      Stream.runForEach(engine.streamDomainEvents, handle).pipe(
        Effect.catchCause((cause) => Effect.logWarning("team task event stream failed", { cause })),
      ),
    );

  return { start, handle } satisfies TeamTaskReactor["Service"];
});

export const layer = Layer.effect(TeamTaskReactor, make);
