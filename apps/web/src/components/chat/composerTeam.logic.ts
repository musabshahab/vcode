import type { OrchestrationV2AppThreadLineage } from "@codenine/contracts";

/**
 * Team is offered where a lead can start one: a draft or a top-level thread that neither leads a
 * team nor works for one. Subagents and side chats answer to another thread, so they have none.
 */
export function teamToggleAvailable(input: {
  readonly lineage: Pick<OrchestrationV2AppThreadLineage, "relationshipToParent" | "sideChat">;
  readonly inTeam: boolean;
}): boolean {
  return (
    !input.inTeam &&
    input.lineage.relationshipToParent !== "subagent" &&
    input.lineage.sideChat !== true
  );
}

/** A slash command goes to the provider as typed, so Team does not ride on it. */
export function sendsTeamRequest(input: {
  readonly teamRequested: boolean;
  readonly prompt: string;
}): boolean {
  return input.teamRequested && !input.prompt.trimStart().startsWith("/");
}

export interface DraftHeroExample {
  readonly prompt: string;
  readonly team: boolean;
}

const DRAFT_HERO_EXAMPLES: ReadonlyArray<DraftHeroExample> = [
  { prompt: "Add sign-in with tests, then have a stronger model review it", team: true },
  { prompt: "Explain how this project is structured", team: false },
  { prompt: "Fix the failing test and explain the cause", team: false },
];

/** Examples talk about the project, so a chat without one shows none, and typing hides them. */
export function draftHeroExamples(input: {
  readonly hasProject: boolean;
  readonly composerEmpty: boolean;
  readonly teamAvailable: boolean;
}): ReadonlyArray<DraftHeroExample> {
  if (!input.hasProject || !input.composerEmpty) return [];
  return input.teamAvailable
    ? DRAFT_HERO_EXAMPLES
    : DRAFT_HERO_EXAMPLES.filter((example) => !example.team);
}
