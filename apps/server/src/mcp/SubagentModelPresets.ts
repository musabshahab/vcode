import type {
  ProviderDriverKind,
  ProviderInstanceId,
  SubagentModelPresetId,
  SubagentModelPresetsResult,
  TeamRoleModelSelections,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as UsageService from "../usage/UsageService.ts";
import { listCapabilityModels, providerConstraints } from "./OrchestratorMcpService.ts";

export interface PresetCandidate {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly model: string;
  /** USD per million output tokens. */
  readonly price: number;
}

// List price is the one strength signal every provider's models share. Tiers are shares of the
// strongest offered model's price, strongest first, so they hold as prices drift.
const TIER_FLOORS = [0.6, 0.3, 0.05, 0] as const;
const [PREMIUM, FRONTIER, MID, FAST] = [0, 1, 2, 3];

type Role = keyof TeamRoleModelSelections;

const PRESET_TIERS: Record<SubagentModelPresetId, Record<Role, number>> = {
  balanced: {
    implementation: FRONTIER,
    research: FAST,
    review: PREMIUM,
    design: FRONTIER,
    test: MID,
  },
  budget: { implementation: MID, research: FAST, review: MID, design: MID, test: FAST },
  maxQuality: {
    implementation: PREMIUM,
    research: FRONTIER,
    review: PREMIUM,
    design: PREMIUM,
    test: FRONTIER,
  },
};

/** The model nearest a tier; the strongest in a tier wins. A tie between tiers goes to `onTie`. */
function pick(
  candidates: ReadonlyArray<PresetCandidate>,
  tierOf: (candidate: PresetCandidate) => number,
  tier: number,
  onTie: "cheaper" | "stronger" = "cheaper",
): PresetCandidate | undefined {
  const rank = (candidate: PresetCandidate) => {
    const candidateTier = tierOf(candidate);
    return [
      Math.abs(candidateTier - tier),
      onTie === "cheaper" ? -candidateTier : candidateTier,
      -candidate.price,
    ] as const;
  };
  return candidates.toSorted((left, right) => {
    const [a, b] = [rank(left), rank(right)];
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  })[0];
}

export function recommendSubagentModelPresets(
  candidates: ReadonlyArray<PresetCandidate>,
): SubagentModelPresetsResult["presets"] {
  if (candidates.length < 2) return [];
  const top = Math.max(...candidates.map((candidate) => candidate.price));
  const tierOf = (candidate: PresetCandidate) =>
    TIER_FLOORS.findIndex((floor) => candidate.price >= floor * top);
  return Object.entries(PRESET_TIERS).map(([id, tiers]) => {
    const choose = (role: Role) => pick(candidates, tierOf, tiers[role]) ?? candidates[0]!;
    const implementation = choose("implementation");
    // A second model family catches different mistakes, if it is within a tier of the target.
    const otherProviders = candidates.filter(
      (candidate) =>
        candidate.driver !== implementation.driver &&
        Math.abs(tierOf(candidate) - tiers.review) <= 1,
    );
    const chosen: Record<Role, PresetCandidate> = {
      implementation,
      research: choose("research"),
      // The review gates the change, so between two tiers it takes the stronger.
      review: pick(otherProviders, tierOf, tiers.review, "stronger") ?? choose("review"),
      design: choose("design"),
      test: choose("test"),
    };
    return {
      id: id as SubagentModelPresetId,
      selections: Object.fromEntries(
        Object.entries(chosen).map(([role, candidate]) => [
          role,
          { instanceId: candidate.instanceId, model: candidate.model },
        ]),
      ) as TeamRoleModelSelections,
    };
  });
}

export class SubagentModelPresets extends Context.Service<
  SubagentModelPresets,
  { readonly list: Effect.Effect<SubagentModelPresetsResult> }
>()("t3/mcp/SubagentModelPresets") {}

const make = Effect.gen(function* () {
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const providerAdapters = yield* ProviderAdapterRegistry.ProviderAdapterRegistryV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const usage = yield* UsageService.UsageService;

  const list = Effect.gen(function* () {
    const providers = yield* providerRegistry.getProviders;
    const capable = new Set(yield* providerAdapters.list());
    const settings = Option.getOrUndefined(yield* Effect.option(serverSettings.getSettings));
    // The short list an agent is offered, so a preset never lands on a model the user hid.
    const offered = providers
      .filter(
        (provider) => providerConstraints(provider, capable.has(provider.instanceId)).length === 0,
      )
      .flatMap((provider) =>
        listCapabilityModels({
          provider,
          preferences: settings?.providerModelPreferences?.[provider.instanceId],
          searchTerms: [],
          isPinned: (model) =>
            model.isCustom ||
            (settings?.favorites ?? []).some(
              (favorite) =>
                favorite.provider === provider.instanceId && favorite.model === model.slug,
            ),
        })
          .listed.filter((model) => !model.isLegacy)
          .map((model) => ({ provider, model: model.slug })),
      );
    const prices = yield* usage.outputPricesPerMillion(offered.map(({ model }) => model));
    return {
      presets: recommendSubagentModelPresets(
        offered.flatMap(({ provider, model }) => {
          const price = prices.get(model);
          return price === undefined
            ? []
            : [{ instanceId: provider.instanceId, driver: provider.driver, model, price }];
        }),
      ),
    };
  }).pipe(Effect.withSpan("SubagentModelPresets.list"));

  return SubagentModelPresets.of({ list });
});

export const layer = Layer.effect(SubagentModelPresets, make);
