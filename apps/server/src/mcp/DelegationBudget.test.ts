import { assert, describe, it } from "@effect/vitest";
import { type OrchestrationV2ThreadProjection, RunId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UsageService from "../usage/UsageService.ts";
import * as DelegationBudget from "./DelegationBudget.ts";

const lead = ThreadId.make("thread:lead");
const child = ThreadId.make("thread:child");
const grandchild = ThreadId.make("thread:grandchild");
const earlierChild = ThreadId.make("thread:earlier-child");
const run = RunId.make("run:current");
const earlierRun = RunId.make("run:earlier");

// One million output tokens per turn, so a turn costs its model's output rate in dollars.
const turn = (attempt: string | null, model?: string) => ({
  runAttemptId: attempt,
  ...(model === undefined ? {} : { model }),
  turnTokenUsage: { inputTokens: 0, outputTokens: 1_000_000 },
});

const threads: Record<string, unknown> = {
  [lead]: {
    thread: { modelSelection: { model: "lead-model" } },
    providerTurns: [turn("attempt:current")],
    subagents: [
      { origin: "app_owned", runId: run, childThreadId: child },
      { origin: "app_owned", runId: earlierRun, childThreadId: earlierChild },
      { origin: "provider_native", runId: run, childThreadId: null },
    ],
  },
  [child]: {
    thread: { modelSelection: { model: "child-model" } },
    providerTurns: [turn("attempt:child"), turn("attempt:child", "unpriced-model")],
    subagents: [{ origin: "app_owned", runId: earlierRun, childThreadId: grandchild }],
  },
  [grandchild]: {
    thread: { modelSelection: { model: "lead-model" } },
    providerTurns: [turn("attempt:grandchild")],
    subagents: [],
  },
  [earlierChild]: {
    thread: { modelSelection: { model: "child-model" } },
    providerTurns: [turn("attempt:earlier-child")],
    subagents: [],
  },
};

const rate = (outputCostPerToken: number) => ({
  inputCostPerToken: 0,
  outputCostPerToken,
  cacheReadCostPerToken: 0,
  cacheCreationCostPerToken: 0,
});

const exceeded = (delegationBudgetUsd: number | null) =>
  Effect.gen(function* () {
    const budget = yield* DelegationBudget.DelegationBudget;
    return yield* budget.exceeded({ threadId: lead, runId: run });
  }).pipe(
    Effect.provide(
      DelegationBudget.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            ServerSettings.layerTest({ delegationBudgetUsd }),
            Layer.mock(ThreadManagementService.ThreadManagementService)({
              getThreadRecords: (threadId) =>
                Effect.succeed(threads[threadId] as OrchestrationV2ThreadProjection),
            }),
            Layer.mock(UsageService.UsageService)({
              tokenRates: () =>
                Effect.succeed(
                  new Map([
                    ["lead-model", rate(3 / 1_000_000)],
                    ["child-model", rate(1 / 1_000_000)],
                  ]),
                ),
            }),
          ),
        ),
      ),
    ),
  );

describe("DelegationBudget", () => {
  it.effect("counts the tasks the run delegated and those under them, at each model's price", () =>
    Effect.gen(function* () {
      // $1 for the child's priced turn and $3 for its own delegate; not the lead or an earlier run.
      assert.deepEqual(yield* exceeded(4), Option.some({ spentUsd: 4, budgetUsd: 4 }));
      assert.isTrue(Option.isNone(yield* exceeded(4.01)));
      assert.isTrue(Option.isNone(yield* exceeded(null)));
    }),
  );

  it("prices cached and fresh input apart, and counts native subagent tokens", () => {
    const cost = DelegationBudget.turnCostUsd(
      {
        turnTokenUsage: {
          inputTokens: 1000,
          cachedInputTokens: 600,
          cacheCreationTokens: 300,
          outputTokens: 10,
          otherUsage: { inputTokens: 100, outputTokens: 5 },
        },
      } as never,
      {
        inputCostPerToken: 1,
        cacheReadCostPerToken: 0.1,
        cacheCreationCostPerToken: 2,
        outputCostPerToken: 10,
      },
    );
    // 200 fresh input, 600 cache reads, 300 cache writes, 15 output.
    assert.closeTo(cost, 200 + 60 + 600 + 150, 1e-9);
  });
});
