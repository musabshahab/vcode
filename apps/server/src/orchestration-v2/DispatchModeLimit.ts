import {
  isRuntimeModeAbove,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@codenine/contracts";
import * as Context from "effect/Context";
import type * as Ref from "effect/Ref";

export interface DispatchModes {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

export interface DispatchModeRefusal extends DispatchModes {
  readonly threadId: ThreadId;
  readonly mode: "runtime" | "interaction";
}

/** Recheck target modes under the command lock; the user can raise them after preflight. */
export interface DispatchModeLimitValue extends DispatchModes {
  readonly refused?: Ref.Ref<DispatchModeRefusal | undefined>;
}

export const DispatchModeLimit = Context.Reference<DispatchModeLimitValue | undefined>(
  "codenine/orchestration-v2/DispatchModeLimit",
  { defaultValue: () => undefined },
);

const interactionModeRank: Record<ProviderInteractionMode, number> = { plan: 0, default: 1 };

export const exceededDispatchModeLimit = (
  limit: DispatchModes,
  modes: DispatchModes,
): "runtime" | "interaction" | undefined =>
  isRuntimeModeAbove(modes.runtimeMode, limit.runtimeMode)
    ? "runtime"
    : interactionModeRank[modes.interactionMode] > interactionModeRank[limit.interactionMode]
      ? "interaction"
      : undefined;
