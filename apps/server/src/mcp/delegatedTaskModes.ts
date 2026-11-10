import {
  type ModelSelection,
  OrchestratorMcpFailure,
  type OrchestratorMcpDelegateTaskInput,
  type OrchestratorMcpInteractionMode,
  type OrchestratorMcpRuntimeMode,
  type ProviderInteractionMode,
  type RuntimeMode,
  type TeamRoleModelSelections,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

/** How much a runtime mode allows, narrowest first. */
export function runtimeModeRank(mode: RuntimeMode): number {
  switch (mode) {
    case "approval-required":
      return 0;
    case "auto-accept-edits":
      return 1;
    case "auto":
      return 2;
    case "full-access":
      return 3;
  }
}

/** How much an interaction mode allows: plan, then default. */
export function interactionModeRank(mode: ProviderInteractionMode): number {
  return mode === "plan" ? 0 : 1;
}

/**
 * The mode a child runs at: the one asked for, never broader than its parent's.
 * An inherited mode the target provider does not offer steps down to the
 * broadest one it does; an explicitly requested one is refused instead.
 */
export function resolveRuntimeMode(
  parentMode: RuntimeMode,
  requested: OrchestratorMcpRuntimeMode | undefined,
  target?: {
    readonly modelSelection: ModelSelection;
    readonly supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined;
  },
): Effect.Effect<RuntimeMode, OrchestratorMcpFailure> {
  const inherited = requested === undefined || requested === "inherit";
  const resolved = inherited ? parentMode : requested;
  if (runtimeModeRank(resolved) > runtimeModeRank(parentMode)) {
    return Effect.fail(
      new OrchestratorMcpFailure({
        code: "runtime_mode_escalation_denied",
        message: `Child runtime mode ${resolved} is broader than parent mode ${parentMode}.`,
      }),
    );
  }
  const supported = target?.supportedRuntimeModes;
  if (supported === undefined || supported.length === 0 || supported.includes(resolved)) {
    return Effect.succeed(resolved);
  }
  if (!inherited) {
    return Effect.fail(
      new OrchestratorMcpFailure({
        code: "invalid_request",
        message: `Provider ${target?.modelSelection.instanceId} does not offer runtime mode ${resolved}, so it would run as approval-required. Use one of: ${supported.join(", ")}.`,
      }),
    );
  }
  return Effect.succeed(
    supported
      .filter((mode) => runtimeModeRank(mode) <= runtimeModeRank(resolved))
      .toSorted((left, right) => runtimeModeRank(right) - runtimeModeRank(left))[0] ??
      "approval-required",
  );
}

/** The same, for interaction modes. */
export function resolveInteractionMode(
  parentMode: ProviderInteractionMode,
  requested: OrchestratorMcpInteractionMode | undefined,
): Effect.Effect<ProviderInteractionMode, OrchestratorMcpFailure> {
  const resolved = requested === undefined || requested === "inherit" ? parentMode : requested;
  return interactionModeRank(resolved) > interactionModeRank(parentMode)
    ? Effect.fail(
        new OrchestratorMcpFailure({
          code: "interaction_mode_escalation_denied",
          message: `Child interaction mode ${resolved} is broader than parent mode ${parentMode}.`,
        }),
      )
    : Effect.succeed(resolved);
}

/** The team model for the task's role, unless the caller named a provider or model itself. */
export function teamRoleSelection(
  input: Pick<OrchestratorMcpDelegateTaskInput, "role" | "target">,
  selections: TeamRoleModelSelections,
): ModelSelection | undefined {
  const { role, target } = input;
  if (role === undefined || role === "general") return undefined;
  if (
    target?.providerInstanceId !== undefined ||
    target?.driverKind !== undefined ||
    target?.model !== undefined
  ) {
    return undefined;
  }
  return selections[role];
}

const ROLE_LINE = /^Act as the ([a-z]+) sub-agent for this task\.\n\n/;
const FILES_LINE = "\n\nYou own these files and may change no others: ";

/** A path as tasks compare it: no leading `./`, no trailing slash. */
const normalizedFile = (file: string) => file.trim().replace(/^\.\//, "").replace(/\/+$/, "");

/** The task as its child receives it, with the role and the files the caller gave it. */
export function taskPrompt(
  input: Pick<OrchestratorMcpDelegateTaskInput, "task" | "role" | "files">,
): string {
  const task =
    input.role === undefined || input.role === "general"
      ? input.task
      : `Act as the ${input.role} sub-agent for this task.\n\n${input.task}`;
  const files = (input.files ?? []).map(normalizedFile).filter((file) => file !== "");
  return files.length === 0 ? task : `${task}${FILES_LINE}${JSON.stringify(files)}`;
}

/** The role a delegated task's prompt was written for. The prompt is the only record of it. */
export function taskRole(prompt: string): string | undefined {
  return ROLE_LINE.exec(prompt)?.[1];
}

/** The files a delegated task's prompt says it owns. */
export function taskFiles(prompt: string): ReadonlyArray<string> {
  const start = prompt.lastIndexOf(FILES_LINE);
  if (start === -1) return [];
  try {
    const files: unknown = JSON.parse(prompt.slice(start + FILES_LINE.length));
    return Array.isArray(files) ? files.filter((file) => typeof file === "string") : [];
  } catch {
    return [];
  }
}

/** The files of `mine` that `theirs` also covers: the same path, or one inside the other. */
export function overlappingFiles(
  mine: ReadonlyArray<string>,
  theirs: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const held = theirs.map(normalizedFile);
  return mine
    .map(normalizedFile)
    .filter((file) =>
      held.some(
        (other) => file === other || file.startsWith(`${other}/`) || other.startsWith(`${file}/`),
      ),
    );
}
