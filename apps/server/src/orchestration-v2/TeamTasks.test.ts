import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EventId,
  GitCommandError,
  MessageId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2ServerCommand,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type TeamAgent,
  TeamAgentId,
  type TeamPlanStatus,
  type TeamTaskDraft,
  TeamTaskId,
  ThreadId,
  TurnItemId,
} from "@codenine/contracts";
import * as IdAllocator from "@codenine/provider-core/server/IdAllocator";
import type * as ProviderAdapter from "@codenine/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as OrchestrationEventStore from "../persistence/OrchestrationEventStore.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectCloneTracker from "../project/ProjectCloneTracker.ts";
import * as ProjectEnrichmentService from "../project/ProjectEnrichmentService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as WorktreeSetupTracker from "../project/WorktreeSetupTracker.ts";
import * as ProviderRegistryMock from "../provider/testUtils/providerRegistryMock.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { subscribeOrchestrationV2Shell } from "../ws.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as CommandReceiptStore from "./CommandReceiptStore.ts";
import * as EffectWorker from "./EffectWorker.ts";
import * as EventSink from "./EventSink.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as TeamTaskReactor from "./TeamTaskReactor.ts";
import * as TeamTaskService from "./TeamTaskService.ts";
import * as ThreadLaunch from "./ThreadLaunchService.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const projectId = ProjectId.make("project:team");
const leadThreadId = ThreadId.make("thread:team-lead");
const leadCheckout = "/repo/lead";
const instanceId = ProviderInstanceId.make("codex");
const fast = { instanceId, model: "gpt-fast" };
const strong = { instanceId, model: "gpt-strong" };

const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("Team agents here never reach a provider"),
} as ProviderAdapter.ProviderAdapterV2["Service"];

const project = {
  id: projectId,
  title: "Team",
  workspaceRoot: "/repo",
  repositoryIdentity: null,
  faviconPath: null,
  defaultModelSelection: fast,
  defaultThreadEnvMode: null,
  scripts: [],
  pinnedAt: null,
  archivedAt: null,
  createdAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
  deletedAt: null,
} as const;

const agent = (
  id: string,
  modelSelection: TeamAgent["modelSelection"],
  workspace: TeamAgent["workspace"] = "shared",
): TeamAgent => ({
  id: TeamAgentId.make(id),
  label: id,
  role: "implement",
  modelSelection,
  workspace,
});
const builder = agent("builder", fast);
const reviewer = agent("reviewer", strong);

const task = (id: string, dependsOn: ReadonlyArray<string> = [], by = builder): TeamTaskDraft => ({
  id: TeamTaskId.make(id),
  title: `Task ${id}`,
  brief: `Do ${id}.`,
  agentId: by.id,
  dependsOn: dependsOn.map((dependency) => TeamTaskId.make(dependency)),
});

/**
 * The real orchestrator, effect worker, thread launch and team services. Each launched thread
 * stays in workspace setup, which reports its thread id to `launched`, so a test decides how its
 * run ends.
 */
const layerTeam = (
  launched: Queue.Queue<ThreadId>,
  options: { readonly headResolves?: boolean } = {},
) => {
  const layerDatabase = SqlitePersistence.layerMemory;
  const layerServerSettings = ServerSettings.layerTest();
  const layerReceipts = CommandReceiptStore.layer.pipe(Layer.provide(layerDatabase));
  const layerThreadManagement = ThreadManagement.layer.pipe(
    Layer.provide(layerServerSettings),
    Layer.provide(layerReceipts),
  );
  const layerProjects = Layer.mock(ProjectService.ProjectService)({
    getById: (id) => Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
  });
  const layerLaunchDependencies = Layer.mergeAll(
    WorktreeSetupTracker.layer,
    Layer.mock(ProjectCloneTracker.ProjectCloneTracker)({ get: () => Effect.succeed(null) }),
    Layer.mock(TerminalManager.TerminalManager)({ close: () => Effect.void }),
    layerProjects,
    Layer.mock(GitWorkflow.GitWorkflowService)({
      hasCommit: () => Effect.succeed(false),
      createWorktree: (input) =>
        Effect.succeed({
          worktree: { path: `/repo-worktrees/${input.newRefName}`, refName: input.newRefName },
        } as never),
      removeWorktree: () => Effect.void,
      deleteLocalBranch: () => Effect.void,
    }),
    Layer.succeed(ProjectSetupScriptRunner.ProjectSetupScriptRunner, {
      runForThread: (input) =>
        Queue.offer(launched, ThreadId.make(input.threadId)).pipe(Effect.andThen(Effect.never)),
    }),
    // Renaming a worktree branch runs beside setup; these tests read the branch setup recorded.
    Layer.mock(TextGeneration.TextGeneration)({ generateBranchName: () => Effect.never }),
    layerServerSettings,
    ProviderRegistryMock.layer(),
    Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
      namedProjectsRoot: "/projects",
      isScratchProject: () => Effect.succeed(false),
      folderForThread: () => Effect.succeedNone,
    }),
  );
  const layerTeamTasks = TeamTaskService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        ThreadLaunch.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              layerLaunchDependencies,
              layerThreadManagement,
              layerReceipts,
              IdAllocator.layer,
            ),
          ),
        ),
        layerThreadManagement,
        layerProjects,
        Layer.mock(GitVcsDriver.GitVcsDriver)({
          resolveCommit: (input) =>
            options.headResolves === false
              ? Effect.fail(
                  new GitCommandError({
                    operation: "resolveCommit",
                    command: "git rev-parse",
                    cwd: input.cwd,
                    detail: "unknown revision",
                  }),
                )
              : Effect.succeed({ commitSha: "abc1234" }),
        }),
      ),
    ),
    Layer.orDie,
  );
  const layerHarness = ProviderReplayHarness.layerWithRegistry(
    { name: "team-tasks" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false, teamTasks: layerTeamTasks },
  );
  return Layer.mergeAll(
    TeamTaskReactor.layer.pipe(
      Layer.provide(ProjectionStore.layer.pipe(Layer.provide(layerDatabase))),
    ),
    layerTeamTasks,
    // A shell subscription reads these from the same database; see `streamedShell`.
    layerThreadManagement,
    OrchestrationEventStore.layer.pipe(Layer.provideMerge(layerDatabase)),
  ).pipe(Layer.provideMerge(layerHarness));
};

const dispatch = (command: OrchestrationV2ServerCommand) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) => orchestrator.dispatch(command));

const thread = (threadId: ThreadId) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    orchestrator.getThreadProjection(threadId),
  );

const team = thread(leadThreadId).pipe(Effect.map((projection) => projection.thread.team!));

const taskStates = team.pipe(
  Effect.map((plan) =>
    Object.fromEntries(
      plan.tasks.map((candidate) => [candidate.id, `${candidate.status}#${candidate.attempt}`]),
    ),
  ),
);

/** The last shell a client resuming the shell stream after `afterSequence` receives for a thread. */
const streamedShell = (threadId: ThreadId, afterSequence: number) =>
  subscribeOrchestrationV2Shell({ afterSequence, requestCompletionMarker: true }).pipe(
    Effect.flatMap((stream) =>
      stream.pipe(
        Stream.takeUntil((item) => item.kind === "synchronized"),
        Stream.runCollect,
      ),
    ),
    Effect.map((items) =>
      items
        .flatMap((item) =>
          item.kind === "thread.updated" && item.thread.id === threadId ? [item.thread] : [],
        )
        .at(-1),
    ),
    Effect.provide(
      Layer.mergeAll(
        Layer.mock(ProjectStore.ProjectStoreV2)({ listShells: () => Effect.succeed([]) }),
        Layer.mock(ProjectService.ProjectService)({}),
        Layer.mock(ProjectEnrichmentService.ProjectEnrichmentService)({
          subscribeChanges: Effect.flatMap(
            PubSub.unbounded<ProjectEnrichmentService.ProjectEnrichmentChange>(),
            PubSub.subscribe,
          ),
        }),
      ),
    ),
  );

const settledOverrides = (threadIds: ReadonlyArray<ThreadId>) =>
  Effect.flatMap(Orchestrator.OrchestratorV2, (orchestrator) =>
    Effect.forEach(threadIds, (threadId) =>
      orchestrator.getThreadShell(threadId).pipe(Effect.map((shell) => shell?.settledOverride)),
    ),
  );

const taskThreadId = (id: string) =>
  team.pipe(Effect.map((plan) => plan.tasks.find((candidate) => candidate.id === id)!.threadId!));

const createLead = dispatch({
  type: "thread.create",
  commandId: CommandId.make("create-lead"),
  threadId: leadThreadId,
  projectId,
  title: "Lead",
  modelSelection: fast,
  runtimeMode: "auto-accept-edits",
  interactionMode: "default",
  branch: "main",
  worktreePath: leadCheckout,
  createdBy: "user",
  creationSource: "web",
});

const proposeOnLead = (
  tasks: ReadonlyArray<TeamTaskDraft>,
  agents: ReadonlyArray<TeamAgent> = [builder, reviewer],
) =>
  dispatch({
    type: "team.propose",
    commandId: CommandId.make("propose"),
    threadId: leadThreadId,
    goal: "Ship the feature",
    agents,
    tasks,
  });

const propose = (...args: Parameters<typeof proposeOnLead>) =>
  createLead.pipe(Effect.andThen(proposeOnLead(...args)));

const approve = (expectedRevision = 1) =>
  dispatch({
    type: "team.approve",
    commandId: CommandId.make(`approve:${expectedRevision}`),
    threadId: leadThreadId,
    expectedRevision,
  });

/** Runs the team's pending effects and returns the threads they launched, once each reached setup. */
const runEffects = (launched: Queue.Queue<ThreadId>, expectedLaunches: number) =>
  Effect.gen(function* () {
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    yield* worker.drain();
    return yield* Queue.takeN(launched, expectedLaunches);
  });

/** Ends a team agent's run as its provider would, then lets the reactor see it unless `unheard`. */
const endRun = (
  threadId: ThreadId,
  status: "completed" | "failed" | "interrupted",
  result?: string,
  unheard = false,
) =>
  Effect.gen(function* () {
    const sink = yield* EventSink.EventSinkV2;
    const reactor = yield* TeamTaskReactor.TeamTaskReactor;
    const run = (yield* thread(threadId)).runs[0]!;
    const now = yield* DateTime.now;
    const ended = {
      id: EventId.make(`event:${threadId}:ended`),
      type: "run.updated",
      threadId,
      runId: run.id,
      occurredAt: now,
      payload: { ...run, status, completedAt: now },
    } satisfies OrchestrationV2DomainEvent;
    yield* sink.write({
      events: [
        ...(result === undefined
          ? []
          : [
              {
                id: EventId.make(`event:${threadId}:result`),
                type: "turn-item.updated" as const,
                threadId,
                runId: run.id,
                occurredAt: now,
                payload: {
                  id: TurnItemId.make(`item:${threadId}:result`),
                  threadId,
                  runId: run.id,
                  nodeId: null,
                  providerThreadId: null,
                  providerTurnId: null,
                  nativeItemRef: null,
                  parentItemId: null,
                  ordinal: 2,
                  status: "completed" as const,
                  title: null,
                  startedAt: now,
                  completedAt: now,
                  updatedAt: now,
                  type: "assistant_message" as const,
                  messageId: MessageId.make(`message:${threadId}:result`),
                  text: result,
                  streaming: false,
                },
              },
            ]),
        ended,
      ],
    });
    if (!unheard) yield* reactor.handle(ended);
    return ended;
  });

const withTeam = <A, E>(
  test: (
    launched: Queue.Queue<ThreadId>,
  ) => Effect.Effect<A, E, Layer.Success<ReturnType<typeof layerTeam>> | Scope.Scope>,
  options?: Parameters<typeof layerTeam>[1],
) =>
  Effect.gen(function* () {
    const launched = yield* Queue.unbounded<ThreadId>();
    return yield* test(launched).pipe(Effect.provide(layerTeam(launched, options)));
  });

const rejection = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? JSON.stringify(exit.cause) : "accepted";

it.effect("a proposed team starts nothing, and only the revision the user saw can change it", () =>
  withTeam(() =>
    Effect.gen(function* () {
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      yield* propose([task("build"), task("review", ["build"], reviewer)]);
      assert.equal(yield* worker.drain(), 0);
      const proposed = yield* team;
      assert.deepInclude(proposed, { status: "proposed", revision: 1 });

      const edit = (expectedRevision: number, commandId: string) =>
        dispatch({
          type: "team.edit",
          commandId: CommandId.make(commandId),
          threadId: leadThreadId,
          expectedRevision,
          agents: [builder],
          tasks: [task("build")],
        });
      assert.include(
        rejection(yield* Effect.exit(edit(2, "stale-edit"))),
        "team_revision_conflict",
      );
      assert.deepEqual(yield* team, proposed);

      yield* edit(1, "edit");
      assert.include(rejection(yield* Effect.exit(approve(1))), "team_revision_conflict");
      assert.deepEqual(yield* taskStates, { build: "pending#1" });
      assert.equal(yield* worker.drain(), 0);
    }),
  ),
);

it.effect(
  "approval starts what the cap allows, and a finished task hands its result to the tasks it unblocks",
  () =>
    withTeam((launched) =>
      Effect.gen(function* () {
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const applicationEvents = yield* OrchestrationEventStore.OrchestrationEventStore;
        const listed = (threadId: ThreadId, location: "active" | "archive") =>
          orchestrator
            .getShellSnapshot({ location })
            .pipe(
              Effect.map((snapshot) =>
                [...snapshot.threads, ...snapshot.archivedThreads].find(
                  (shell) => shell.id === threadId,
                ),
              ),
            );
        // Thread lists read where a lead's plan stands from its shell alone, and the shell
        // stream resends the lead when the plan changes.
        const expectLeadSummaryAfter = <E, R>(
          change: Effect.Effect<unknown, E, R>,
          status: TeamPlanStatus,
          counts: { readonly running: number; readonly completed: number },
        ) =>
          Effect.gen(function* () {
            const since = yield* applicationEvents.latestApplicationSequence;
            yield* change;
            const expected = {
              planId: (yield* team).id,
              status,
              revision: 1,
              total: 4,
              failed: 0,
              cancelled: 0,
              ...counts,
            };
            for (const shell of [
              yield* orchestrator.getThreadShell(leadThreadId),
              yield* listed(leadThreadId, "active"),
              ProjectionStore.threadShellFromProjection(yield* thread(leadThreadId)),
              yield* streamedShell(leadThreadId, since),
            ]) {
              assert.deepEqual(shell?.teamSummary, expected);
            }
            return expected;
          });

        yield* createLead;
        assert.isUndefined((yield* orchestrator.getThreadShell(leadThreadId))?.teamSummary);
        yield* expectLeadSummaryAfter(
          proposeOnLead([task("a"), task("b"), task("c"), task("d", ["a"], reviewer)]),
          "proposed",
          { running: 0, completed: 0 },
        );
        yield* expectLeadSummaryAfter(approve(), "running", { running: 2, completed: 0 });
        const first = yield* runEffects(launched, 2);
        assert.sameMembers(first, [yield* taskThreadId("a"), yield* taskThreadId("b")]);
        assert.deepEqual(yield* taskStates, {
          a: "running#1",
          b: "running#1",
          c: "pending#1",
          d: "pending#1",
        });
        assert.include(
          rejection(
            yield* Effect.exit(
              dispatch({
                type: "team.propose",
                commandId: CommandId.make("propose-again"),
                threadId: leadThreadId,
                goal: "Another",
                agents: [builder],
                tasks: [task("x")],
              }),
            ),
          ),
          "team_plan_running",
        );

        // `c` comes first in the plan, so it takes the slot `a` frees; `d` waits for `b`.
        yield* endRun(yield* taskThreadId("a"), "completed", "Wrote src/a.ts on main.");
        assert.deepEqual(yield* runEffects(launched, 1), [yield* taskThreadId("c")]);
        assert.deepInclude(yield* taskStates, { a: "completed#1", d: "pending#1" });

        yield* endRun(yield* taskThreadId("b"), "completed", "Wrote src/b.ts.");
        const dThreadId = yield* taskThreadId("d");
        assert.deepEqual(yield* runEffects(launched, 1), [dThreadId]);
        const d = yield* thread(dThreadId);
        assert.deepInclude(d.thread, {
          title: "Task d",
          modelSelection: strong,
          runtimeMode: "auto-accept-edits",
          worktreePath: leadCheckout,
          createdBy: "system",
        });
        assert.deepEqual(d.thread.teamTask, {
          rootThreadId: leadThreadId,
          planId: (yield* team).id,
          taskId: TeamTaskId.make("d"),
          attempt: 1,
        });
        const brief = d.messages[0]!.text;
        assert.include(brief, 'Act as the implement agent "reviewer" on this team.');
        assert.include(brief, "Ship the feature");
        assert.include(brief, "### Task a\nWrote src/a.ts on main.");
        assert.notInclude(brief, "Wrote src/b.ts.");

        // Thread lists group a task thread under its lead from the shell alone.
        for (const shell of [
          yield* orchestrator.getThreadShell(dThreadId),
          yield* listed(dThreadId, "active"),
          ProjectionStore.threadShellFromProjection(d),
        ]) {
          assert.deepEqual(shell?.teamTask, d.thread.teamTask);
          assert.isUndefined(shell?.teamSummary);
        }
        assert.isUndefined((yield* orchestrator.getThreadShell(leadThreadId))?.teamTask);

        // The lead wakes and settles the team once it completes; neither is under test here.
        const completed = yield* expectLeadSummaryAfter(
          Effect.andThen(
            endRun(yield* taskThreadId("c"), "completed", "Wrote src/c.ts."),
            endRun(dThreadId, "completed", "Reviewed it."),
          ),
          "completed",
          { running: 0, completed: 4 },
        );
        for (const threadId of [dThreadId, leadThreadId]) {
          yield* dispatch({
            type: "thread.archive",
            commandId: CommandId.make(`archive:${threadId}`),
            threadId,
          });
        }
        assert.deepEqual((yield* listed(dThreadId, "archive"))?.teamTask, d.thread.teamTask);
        assert.deepEqual((yield* listed(leadThreadId, "archive"))?.teamSummary, completed);
      }),
    ),
);

it.effect(
  "a failed task leaves its dependents pending, fails the plan, and wakes the lead once",
  () =>
    withTeam((launched) =>
      Effect.gen(function* () {
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        const reactor = yield* TeamTaskReactor.TeamTaskReactor;
        yield* propose([task("build"), task("review", ["build"], reviewer)]);
        yield* approve();
        const [buildThreadId] = yield* runEffects(launched, 1);
        const ended = yield* endRun(buildThreadId!, "failed");
        // The wake starts a lead turn; only the wake itself is under test.
        assert.equal(yield* worker.drain(1), 1);
        yield* reactor.handle(ended);

        const plan = yield* team;
        assert.equal(plan.status, "failed");
        assert.deepEqual(yield* taskStates, { build: "failed#1", review: "pending#1" });
        assert.isNull(plan.tasks[1]!.threadId);
        const wakes = (yield* thread(leadThreadId)).messages.filter(
          (message) => message.notification?.source.kind === "system",
        );
        assert.lengthOf(wakes, 1);
        assert.include(wakes[0]!.text, "Your team is stuck");
        assert.include(wakes[0]!.text, "- Task build: failed. Agent: builder (gpt-fast).");
        assert.include(wakes[0]!.text, "- Task review: pending. Agent: reviewer (gpt-strong).");

        // A failed team keeps its threads for the user to read and retry. A settle the plan
        // queued would run next on the lead's lane, ahead of the turn the wake started.
        assert.equal(yield* worker.drain(1), 1);
        const teamTasks = yield* TeamTaskService.TeamTaskService;
        yield* teamTasks.settleTaskThreads({ leadThreadId, planId: plan.id });
        assert.deepEqual(yield* settledOverrides([leadThreadId, buildThreadId!]), [null, null]);
      }),
    ),
);

it.effect(
  "retrying a task on another agent starts a new thread and leaves the first thread's model alone",
  () =>
    withTeam((launched) =>
      Effect.gen(function* () {
        yield* propose([task("build"), task("docs")]);
        yield* approve();
        yield* runEffects(launched, 2);
        const firstThreadId = yield* taskThreadId("build");
        yield* endRun(firstThreadId, "failed");
        assert.equal((yield* team).status, "running");

        yield* dispatch({
          type: "team.task.retry",
          commandId: CommandId.make("retry"),
          threadId: leadThreadId,
          taskId: TeamTaskId.make("build"),
          agentId: reviewer.id,
        });
        const [retryThreadId] = yield* runEffects(launched, 1);
        assert.notEqual(retryThreadId, firstThreadId);
        assert.equal(retryThreadId, yield* taskThreadId("build"));
        assert.deepEqual(yield* taskStates, { build: "running#2", docs: "running#1" });
        assert.deepEqual((yield* thread(retryThreadId!)).thread.modelSelection, strong);
        assert.deepEqual((yield* thread(firstThreadId)).thread.modelSelection, fast);

        // Completing the team settles every attempt's thread, and never the lead.
        const docsThreadId = yield* taskThreadId("docs");
        yield* endRun(docsThreadId, "completed", "Wrote the docs.");
        yield* endRun(retryThreadId!, "completed", "Built it.");
        const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
        // The wake, then the settle; the lead turn the wake starts is not under test.
        assert.equal(yield* worker.drain(2), 2);
        const plan = yield* team;
        assert.equal(plan.status, "completed");
        const taskThreads = [firstThreadId, retryThreadId!, docsThreadId];
        assert.deepEqual(yield* settledOverrides([leadThreadId, ...taskThreads]), [
          null,
          "settled",
          "settled",
          "settled",
        ]);
        const orchestrator = yield* Orchestrator.OrchestratorV2;
        const sequences = Effect.forEach(taskThreads, orchestrator.getThreadEventSequence);
        const before = yield* sequences;
        const teamTasks = yield* TeamTaskService.TeamTaskService;
        yield* teamTasks.settleTaskThreads({ leadThreadId, planId: plan.id });
        assert.deepEqual(yield* sequences, before);
      }),
    ),
);

it.effect(
  "recovery settles once a task whose run ended unheard, and the task it unblocks starts once",
  () =>
    withTeam((launched) =>
      Effect.gen(function* () {
        const reactor = yield* TeamTaskReactor.TeamTaskReactor;
        const sink = yield* EventSink.EventSinkV2;
        yield* propose([task("build"), task("review", ["build"], reviewer)]);
        yield* approve();
        const [buildThreadId] = yield* runEffects(launched, 1);
        const ended = yield* endRun(buildThreadId!, "completed", "Built it.", true);
        assert.deepEqual(yield* taskStates, { build: "running#1", review: "pending#1" });

        yield* reactor.recover();
        yield* reactor.recover();
        yield* reactor.handle(ended);
        assert.deepEqual(yield* taskStates, { build: "completed#1", review: "running#1" });
        const settles = yield* sink
          .readByCommandId({
            commandId: CommandId.make(`server:team-task-settle:${buildThreadId}`),
          })
          .pipe(Stream.runCollect);
        assert.lengthOf(settles, 1);
        const [reviewThreadId] = yield* runEffects(launched, 1);
        assert.equal(reviewThreadId, yield* taskThreadId("review"));
        assert.equal(yield* Queue.size(launched), 0);
        assert.include((yield* thread(reviewThreadId!)).messages[0]!.text, "Built it.");
      }),
    ),
);

it.effect(
  "recovery leaves an unlaunched task and a working one, and the reactor settles the latter",
  () =>
    withTeam((launched) =>
      Effect.gen(function* () {
        const reactor = yield* TeamTaskReactor.TeamTaskReactor;
        yield* propose([task("build")]);
        yield* approve();
        // The plan names the task's thread before its launch effect has created it.
        yield* reactor.recover();
        assert.deepEqual(yield* taskStates, { build: "running#1" });

        const [buildThreadId] = yield* runEffects(launched, 1);
        yield* reactor.recover();
        assert.deepEqual(yield* taskStates, { build: "running#1" });

        yield* endRun(buildThreadId!, "completed", "Built it.");
        assert.deepEqual(yield* taskStates, { build: "completed#1" });
        assert.equal((yield* team).status, "completed");
      }),
    ),
);

it.effect("cancelling a team stops its running threads and leaves nothing to start", () =>
  withTeam((launched) =>
    Effect.gen(function* () {
      yield* propose([task("build"), task("docs"), task("review", ["build"], reviewer)]);
      yield* approve();
      const running = yield* runEffects(launched, 2);
      yield* dispatch({
        type: "team.cancel",
        commandId: CommandId.make("cancel"),
        threadId: leadThreadId,
      });
      yield* runEffects(launched, 0);

      assert.equal((yield* team).status, "cancelled");
      assert.deepEqual(yield* taskStates, {
        build: "cancelled#1",
        docs: "cancelled#1",
        review: "pending#1",
      });
      for (const threadId of running) {
        assert.notInclude(
          ["preparing", "starting", "running"],
          (yield* thread(threadId)).runs[0]!.status,
        );
      }
      assert.deepEqual(yield* settledOverrides([leadThreadId, ...running]), [
        null,
        "settled",
        "settled",
      ]);
    }),
  ),
);

it.effect("a task whose worktree cannot be cut fails with the reason", () =>
  withTeam(
    (launched) =>
      Effect.gen(function* () {
        const isolated = agent("isolated", fast, "worktree");
        yield* propose([task("build", [], isolated)], [isolated]);
        yield* approve();
        yield* runEffects(launched, 0);
        const plan = yield* team;
        assert.equal(plan.status, "failed");
        assert.equal(
          plan.tasks[0]!.result,
          "This task could not start: The lead thread's checkout has no commit to start a worktree from.",
        );
      }),
    { headResolves: false },
  ),
);

it.effect("a task that worked in its own worktree tells its dependents where", () =>
  withTeam((launched) =>
    Effect.gen(function* () {
      const isolated = agent("isolated", fast, "worktree");
      yield* propose(
        [task("build", [], isolated), task("review", ["build"], reviewer)],
        [isolated, reviewer],
      );
      yield* approve();
      const [buildThreadId] = yield* runEffects(launched, 1);
      const build = yield* thread(buildThreadId!);
      assert.deepInclude(build.runs[0]!.workspacePreparation, {
        type: "worktree",
        baseRef: "abc1234",
      });
      yield* endRun(buildThreadId!, "completed", "Built it.");
      const [reviewThreadId] = yield* runEffects(launched, 1);
      assert.include(
        (yield* thread(reviewThreadId!)).messages[0]!.text,
        `### Task build\nIts work is on branch ${build.thread.branch} in worktree ${build.thread.worktreePath}.\nBuilt it.`,
      );
    }),
  ),
);

it.effect("neither a delegated child nor a fork takes over a thread's team or team task", () =>
  withTeam((launched) =>
    Effect.gen(function* () {
      yield* propose([task("build")]);
      yield* approve();
      const [buildThreadId] = yield* runEffects(launched, 1);
      const fork = (sourceThreadId: ThreadId, targetThreadId: ThreadId) =>
        dispatch({
          type: "thread.fork",
          commandId: CommandId.make(`fork:${targetThreadId}`),
          sourceThreadId,
          targetThreadId,
          sourcePoint: { type: "latest_stable" },
          sideChat: true,
          createdBy: "user",
          creationSource: "web",
        }).pipe(Effect.andThen(thread(targetThreadId)));
      const leadFork = yield* fork(leadThreadId, ThreadId.make("thread:lead-fork"));
      assert.notExists(leadFork.thread.team);
      const taskFork = yield* fork(buildThreadId!, ThreadId.make("thread:task-fork"));
      assert.notExists(taskFork.thread.teamTask);

      yield* dispatch({
        type: "message.dispatch",
        commandId: CommandId.make("start-lead"),
        threadId: leadThreadId,
        messageId: MessageId.make("message:start-lead"),
        text: "Delegate a check",
        attachments: [],
        dispatchMode: { type: "start_immediately" },
        createdBy: "user",
        creationSource: "web",
      });
      const leadRun = (yield* thread(leadThreadId)).runs.at(-1)!;
      yield* dispatch({
        type: "delegated_task.request",
        commandId: CommandId.make("delegate"),
        parentThreadId: leadThreadId,
        parentRunId: leadRun.id,
        parentNodeId: leadRun.rootNodeId!,
        task: "Check the build",
        modelSelection: fast,
        runtimeMode: "auto-accept-edits",
        interactionMode: "default",
        completionWake: "always",
        createdBy: "agent",
        creationSource: "mcp",
      });
      const lead = yield* thread(leadThreadId);
      assert.exists(lead.thread.team);
      const child = yield* thread(lead.subagents[0]!.childThreadId!);
      assert.notExists(child.thread.team);
    }),
  ),
);
