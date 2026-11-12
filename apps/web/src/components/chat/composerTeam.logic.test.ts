import { describe, expect, it } from "vite-plus/test";

import { draftHeroExamples, sendsTeamRequest, teamToggleAvailable } from "./composerTeam.logic";

describe("teamToggleAvailable", () => {
  it.each([
    { name: "a draft or top-level thread", parent: null, sideChat: false, inTeam: false, on: true },
    { name: "a fork", parent: "fork", sideChat: false, inTeam: false, on: true },
    { name: "a subagent", parent: "subagent", sideChat: false, inTeam: false, on: false },
    { name: "a side chat", parent: "fork", sideChat: true, inTeam: false, on: false },
    { name: "a lead or team agent", parent: null, sideChat: false, inTeam: true, on: false },
  ] as const)("offers Team on $name: $on", ({ parent, sideChat, inTeam, on }) => {
    expect(
      teamToggleAvailable({ lineage: { relationshipToParent: parent, sideChat }, inTeam }),
    ).toBe(on);
  });
});

describe("sendsTeamRequest", () => {
  it.each([
    { teamRequested: true, prompt: "Add sign-in with tests", sends: true },
    { teamRequested: true, prompt: "  /compact", sends: false },
    { teamRequested: false, prompt: "Add sign-in with tests", sends: false },
  ])("$prompt with Team $teamRequested sends a request: $sends", (input) => {
    expect(sendsTeamRequest(input)).toBe(input.sends);
  });
});

describe("draftHeroExamples", () => {
  it.each([
    { hasProject: true, composerEmpty: true, teamAvailable: true, teams: [true, false, false] },
    { hasProject: true, composerEmpty: true, teamAvailable: false, teams: [false, false] },
    { hasProject: true, composerEmpty: false, teamAvailable: true, teams: [] },
    { hasProject: false, composerEmpty: true, teamAvailable: true, teams: [] },
  ])(
    "project $hasProject, empty $composerEmpty, Team $teamAvailable: $teams",
    ({ teams, ...input }) => {
      expect(draftHeroExamples(input).map((example) => example.team)).toEqual(teams);
    },
  );
});
