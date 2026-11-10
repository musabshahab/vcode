import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2ThreadProjection,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UsageService from "../usage/UsageService.ts";
import type { TokenRates } from "../usage/usagePricing.ts";

export interface DelegationSpend {
  readonly spentUsd: number;
  readonly budgetUsd: number;
}

type Records = Pick<OrchestrationV2ThreadProjection, "thread" | "providerTurns" | "subagents">;

interface PricedTurn {
  readonly model: string;
  readonly turn: OrchestrationV2ProviderTurn;
}

/** A turn's cost at list prices. Usage a provider did not report, or a model with no price, counts as nothing. */
export function turnCostUsd(turn: OrchestrationV2ProviderTurn, rates: TokenRates | undefined) {
  const usage = turn.turnTokenUsage;
  if (usage === undefined || rates === undefined) return 0;
  const cacheRead = usage.cachedInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationTokens ?? 0;
  const input = (usage.inputTokens ?? 0) + (usage.otherUsage?.inputTokens ?? 0);
  const output = (usage.outputTokens ?? 0) + (usage.otherUsage?.outputTokens ?? 0);
  return (
    Math.max(0, input - cacheRead - cacheWrite) * rates.inputCostPerToken +
    cacheRead * rates.cacheReadCostPerToken +
    cacheWrite * rates.cacheCreationCostPerToken +
    output * rates.outputCostPerToken
  );
}

export class DelegationBudget extends Context.Service<
  DelegationBudget,
  {
    /**
     * What the tasks a run delegated have used, when a budget is set and it is spent. The run's
     * own turn is left out: a provider reports a turn's usage only when the turn ends.
     */
    readonly exceeded: (input: {
      readonly threadId: ThreadId;
      readonly runId: RunId;
    }) => Effect.Effect<Option.Option<DelegationSpend>>;
  }
>()("t3/mcp/DelegationBudget") {}

const make = Effect.gen(function* () {
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const usage = yield* UsageService.UsageService;

  const read = (threadId: ThreadId) =>
    threads.getThreadRecords(threadId, ["providerTurns", "subagents"]).pipe(Effect.option);

  /** The turns of the tasks a thread delegated, in one run when given, and of the tasks under them. */
  const delegated: (
    threadId: ThreadId,
    runId: RunId | undefined,
    seen: Set<ThreadId>,
  ) => Effect.Effect<ReadonlyArray<PricedTurn>> = Effect.fn("DelegationBudget.delegated")(
    function* (threadId, runId, seen) {
      const records: Records | undefined = Option.getOrUndefined(yield* read(threadId));
      const children = (records?.subagents ?? []).flatMap((task) =>
        task.origin === "app_owned" &&
        task.childThreadId !== null &&
        !seen.has(task.childThreadId) &&
        (runId === undefined || task.runId === runId)
          ? [task.childThreadId]
          : [],
      );
      for (const child of children) seen.add(child);
      const turns = yield* Effect.forEach(children, (child) =>
        Effect.gen(function* () {
          const own: Records | undefined = Option.getOrUndefined(yield* read(child));
          if (own === undefined) return [];
          const nested = yield* delegated(child, undefined, seen);
          return [
            ...own.providerTurns.map((turn) => ({
              turn,
              model: turn.model ?? own.thread.modelSelection.model,
            })),
            ...nested,
          ];
        }),
      );
      return turns.flat();
    },
  );

  const exceeded = Effect.fn("DelegationBudget.exceeded")(function* (input: {
    readonly threadId: ThreadId;
    readonly runId: RunId;
  }) {
    const settings = Option.getOrUndefined(yield* Effect.option(serverSettings.getSettings));
    const budgetUsd = settings?.delegationBudgetUsd ?? null;
    if (budgetUsd === null) return Option.none<DelegationSpend>();
    const turns = yield* delegated(input.threadId, input.runId, new Set([input.threadId]));
    const rates = yield* usage.tokenRates([...new Set(turns.map(({ model }) => model))]);
    const spentUsd = turns.reduce(
      (total, { turn, model }) => total + turnCostUsd(turn, rates.get(model)),
      0,
    );
    return spentUsd >= budgetUsd ? Option.some({ spentUsd, budgetUsd }) : Option.none();
  });

  return DelegationBudget.of({ exceeded });
});

export const layer = Layer.effect(DelegationBudget, make);
