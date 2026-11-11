import {
  CommandId,
  OrchestrationV2DispatchCommandError,
  ProviderInstanceId,
  type TeamAgent,
  TeamAgentId,
  type TeamPlan,
  TeamPlanId,
  type TeamTask,
  TeamTaskId,
  ThreadId,
} from "@codenine/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  canRetryTeamTask,
  changeTeamDraft,
  editTeamDraft,
  resolveTeamDraft,
  savedTeamDraftEdit,
  teamApproveCommands,
  teamCommandFailure,
  teamDraftIssue,
  teamDraftOf,
  teamRetryCommand,
} from "./team.ts";

const threadId = ThreadId.make("thread:lead");
const codex = ProviderInstanceId.make("codex");
const agent = (id: string, model = "gpt-fast"): TeamAgent => ({
  id: TeamAgentId.make(id),
  label: id,
  role: "implement",
  modelSelection: { instanceId: codex, model },
  workspace: "shared",
});
const task = (id: string, by: string, dependsOn: ReadonlyArray<string> = []): TeamTask => ({
  id: TeamTaskId.make(id),
  title: `Task ${id}`,
  brief: `Do ${id}.`,
  agentId: TeamAgentId.make(by),
  dependsOn: dependsOn.map((dependency) => TeamTaskId.make(dependency)),
  status: "pending",
  attempt: 1,
  threadId: null,
  result: null,
  startedAt: null,
  completedAt: null,
});
const plan = (overrides: Partial<TeamPlan> = {}): TeamPlan => ({
  id: TeamPlanId.make("plan-1"),
  revision: 1,
  status: "proposed",
  goal: "Ship it",
  agents: [agent("builder"), agent("reviewer", "gpt-strong")],
  tasks: [task("a", "builder"), task("b", "builder", ["a"]), task("c", "reviewer", ["a", "b"])],
  maxParallelPerProvider: 2,
  proposedAt: "2026-06-20T00:00:00.000Z",
  updatedAt: "2026-06-20T00:00:00.000Z",
  ...overrides,
});
const commandIds = () => {
  let next = 0;
  return () => CommandId.make(`command-${(next += 1)}`);
};

describe("changeTeamDraft", () => {
  const draft = teamDraftOf(plan());

  it("drops a removed task from the tasks that depended on it", () => {
    const next = changeTeamDraft(draft, { type: "task.remove", taskId: TeamTaskId.make("a") });
    expect(next.tasks.map((candidate) => [candidate.id, candidate.dependsOn])).toEqual([
      ["b", []],
      ["c", ["b"]],
    ]);
  });

  it("keeps an agent that a task still uses", () => {
    const reviewer = TeamAgentId.make("reviewer");
    expect(changeTeamDraft(draft, { type: "agent.remove", agentId: reviewer })).toBe(draft);
    const reassigned = changeTeamDraft(draft, {
      type: "task.assign",
      taskId: TeamTaskId.make("c"),
      agentId: TeamAgentId.make("builder"),
    });
    expect(
      changeTeamDraft(reassigned, { type: "agent.remove", agentId: reviewer }).agents.map(
        (candidate) => candidate.id,
      ),
    ).toEqual(["builder"]);
  });

  it("gives an added agent an id from its label that no agent has", () => {
    const add = (label: string) =>
      ({
        type: "agent.add",
        label,
        role: "review",
        modelSelection: { instanceId: codex, model: "gpt-strong" },
        workspace: "worktree",
      }) as const;
    const once = changeTeamDraft(draft, add("  Reviewer "));
    const twice = changeTeamDraft(once, add("reviewer!"));
    const blank = changeTeamDraft(twice, add("???"));
    expect(blank.agents.slice(2)).toMatchObject([
      { id: "reviewer-2", label: "Reviewer", role: "review", workspace: "worktree" },
      { id: "reviewer-3", label: "reviewer!" },
      { id: "agent" },
    ]);
  });
});

describe("resolveTeamDraft", () => {
  const current = plan();
  const strongBuilder = {
    type: "agent.model",
    agentId: TeamAgentId.make("builder"),
    modelSelection: { instanceId: codex, model: "gpt-strong" },
  } as const;

  it("shows unsaved edits against the revision they were made on", () => {
    const edit = editTeamDraft(current, null, strongBuilder);
    expect(resolveTeamDraft(current, edit)).toMatchObject({
      revision: 1,
      dirty: true,
      overtaken: false,
      draft: { agents: [{ modelSelection: { model: "gpt-strong" } }, {}] },
    });
  });

  it("keeps a saved draft on screen until the thread delivers its revision", () => {
    const edit = editTeamDraft(current, null, strongBuilder);
    const saved = savedTeamDraftEdit(current, resolveTeamDraft(current, edit));
    expect(resolveTeamDraft(current, saved)).toMatchObject({
      revision: 2,
      dirty: false,
      draft: saved.draft,
    });
    const delivered = plan({ revision: 2, agents: saved.draft.agents });
    expect(resolveTeamDraft(delivered, saved)).toMatchObject({ revision: 2, dirty: false });
  });

  it("reports unsaved edits that a newer plan replaced", () => {
    const edit = editTeamDraft(current, null, strongBuilder);
    for (const newer of [
      plan({ revision: 2 }),
      plan({ id: TeamPlanId.make("plan-2") }),
      plan({ status: "running" }),
    ]) {
      expect(resolveTeamDraft(newer, edit)).toEqual({
        draft: teamDraftOf(newer),
        revision: newer.revision,
        dirty: false,
        overtaken: true,
      });
    }
    const undone = editTeamDraft(current, edit, {
      ...strongBuilder,
      modelSelection: { instanceId: codex, model: "gpt-fast" },
    });
    expect(resolveTeamDraft(plan({ revision: 2 }), undone).overtaken).toBe(false);
  });

  it("starts a new edit from the newer plan", () => {
    const stale = editTeamDraft(current, null, strongBuilder);
    const newer = plan({ revision: 2, tasks: [task("a", "builder")] });
    const edit = editTeamDraft(newer, stale, {
      type: "task.brief",
      taskId: TeamTaskId.make("a"),
      brief: "Do it well.",
    });
    expect(edit).toMatchObject({ revision: 2, base: teamDraftOf(newer) });
    expect(edit.draft.agents[0]?.modelSelection.model).toBe("gpt-fast");
  });
});

describe("teamApproveCommands", () => {
  it("approves the revision on screen when nothing changed", () => {
    const resolved = resolveTeamDraft(plan({ revision: 3 }), null);
    expect(teamApproveCommands({ threadId, resolved, newCommandId: commandIds() })).toEqual([
      { type: "team.approve", commandId: "command-1", threadId, expectedRevision: 3 },
    ]);
  });

  it("saves edits first and approves the revision the save creates", () => {
    const current = plan({ revision: 3 });
    const edit = editTeamDraft(current, null, {
      type: "task.brief",
      taskId: TeamTaskId.make("a"),
      brief: "  Do a, carefully.\n",
    });
    const commands = teamApproveCommands({
      threadId,
      resolved: resolveTeamDraft(current, edit),
      newCommandId: commandIds(),
    });
    expect(commands).toMatchObject([
      {
        type: "team.edit",
        commandId: "command-1",
        expectedRevision: 3,
        tasks: [{ id: "a", brief: "Do a, carefully." }, { id: "b" }, { id: "c" }],
      },
      { type: "team.approve", commandId: "command-2", expectedRevision: 4 },
    ]);
    expect(commands[0]).not.toHaveProperty("goal");
    expect(commands[0]).not.toHaveProperty("tasks.0.status");
  });
});

describe("teamDraftIssue", () => {
  const draft = teamDraftOf(plan());

  it("names the problem the server would reject", () => {
    const blank = changeTeamDraft(draft, {
      type: "task.brief",
      taskId: TeamTaskId.make("b"),
      brief: "  ",
    });
    expect(teamDraftIssue(blank)).toBe('Task "Task b" needs a brief.');
    const empty = ["a", "b", "c"].reduce(
      (next, id) => changeTeamDraft(next, { type: "task.remove", taskId: TeamTaskId.make(id) }),
      draft,
    );
    expect(teamDraftIssue(empty)).toBe("A team needs at least one agent and one task.");
    expect(teamDraftIssue(draft)).toBeNull();
  });
});

describe("canRetryTeamTask", () => {
  it.each([
    ["running", "failed", true],
    ["failed", "cancelled", true],
    ["running", "completed", false],
    ["cancelled", "failed", false],
    ["completed", "cancelled", false],
  ] as const)("plan %s, task %s: %s", (planStatus, taskStatus, retryable) => {
    expect(canRetryTeamTask({ status: planStatus }, { status: taskStatus })).toBe(retryable);
  });
});

it("retries on another agent only when one is named", () => {
  const failed = task("a", "builder");
  const retry = (agentId?: string) =>
    teamRetryCommand({
      threadId,
      task: failed,
      ...(agentId === undefined ? {} : { agentId: TeamAgentId.make(agentId) }),
      commandId: CommandId.make("retry"),
    });
  expect(retry()).not.toHaveProperty("agentId");
  expect(retry("builder")).not.toHaveProperty("agentId");
  expect(retry("reviewer")).toMatchObject({
    type: "team.task.retry",
    taskId: "a",
    agentId: "reviewer",
  });
});

describe("teamCommandFailure", () => {
  const rejected = (message: string) =>
    new OrchestrationV2DispatchCommandError({
      commandId: CommandId.make("command-1"),
      commandType: "team.approve",
      message,
      detail: message,
    });

  it("tells a stale revision from other rejections", () => {
    expect(
      teamCommandFailure(
        rejected("team_revision_conflict: The team is at revision 2, not 1. Read it again."),
      ),
    ).toEqual({ conflict: true, message: "The team is at revision 2, not 1. Read it again." });
    expect(
      teamCommandFailure(rejected("team_plan_not_proposed: Only a proposed team can be approved.")),
    ).toEqual({ conflict: false, message: "Only a proposed team can be approved." });
    expect(teamCommandFailure(new Error("Socket closed"))).toEqual({
      conflict: false,
      message: "Socket closed",
    });
  });
});
