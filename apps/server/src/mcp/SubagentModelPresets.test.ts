import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { recommendSubagentModelPresets, type PresetCandidate } from "./SubagentModelPresets.ts";

const candidate = (driver: string, model: string, price: number): PresetCandidate => ({
  instanceId: ProviderInstanceId.make(driver),
  driver: ProviderDriverKind.make(driver),
  model,
  price,
});

const models = (candidates: ReadonlyArray<PresetCandidate>) =>
  Object.fromEntries(
    recommendSubagentModelPresets(candidates).map(({ id, selections }) => [
      id,
      Object.fromEntries(
        Object.entries(selections).map(([role, selection]) => [role, selection.model]),
      ),
    ]),
  );

describe("recommendSubagentModelPresets", () => {
  it("tiers models by their share of the top price and reviews with the other provider", () => {
    expect(
      models([
        candidate("orbit", "orbit-max", 80),
        candidate("orbit", "orbit-pro", 40),
        candidate("orbit", "orbit-mini", 16),
        candidate("drift", "drift-max", 60),
        candidate("drift", "drift-pro", 30),
        candidate("drift", "drift-nano", 0.8),
      ]),
    ).toEqual({
      balanced: {
        implementation: "orbit-pro",
        research: "drift-nano",
        review: "drift-max",
        design: "orbit-pro",
        test: "orbit-mini",
      },
      budget: {
        implementation: "orbit-mini",
        research: "drift-nano",
        // No mid-tier model on the other provider: the review takes the stronger neighbouring tier.
        review: "drift-pro",
        design: "orbit-mini",
        test: "drift-nano",
      },
      maxQuality: {
        implementation: "orbit-max",
        research: "orbit-pro",
        review: "drift-max",
        design: "orbit-max",
        test: "orbit-pro",
      },
    });
  });

  it("keeps the review on the same provider when the other one is too weak for it", () => {
    const presets = models([
      candidate("orbit", "orbit-max", 80),
      candidate("orbit", "orbit-pro", 40),
      candidate("drift", "drift-nano", 0.8),
    ]);
    expect(presets.balanced?.review).toBe("orbit-max");
    expect(presets.maxQuality?.review).toBe("orbit-max");
  });

  it("offers nothing without two priced models to choose between", () => {
    expect(recommendSubagentModelPresets([candidate("orbit", "orbit-pro", 15)])).toEqual([]);
  });
});
