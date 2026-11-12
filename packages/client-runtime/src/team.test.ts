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
  isTeamFinishedNotification,
  resolveTeamDraft,
  savedTeamDraftEdit,
  teamAgentHeader,
  teamApproveCommands,
  teamAssignment,
  teamCommandFailure,
  teamDraftIssue,
  teamDraftOf,
  teamHandoffs,
  teamResultHandoff,
  teamRetryCommand,
  teamStatusText,
  teamTaskOfThread,
  threadTeam,
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

describe("teamHandoffs", () => {
  const started = (base: TeamTask): TeamTask => ({ ...base, status: "running" });

  it("says whose results a task starts from, in the tense of whether it started", () => {
    const handoffs = teamHandoffs(
      plan({
        tasks: [
          { ...task("a", "builder"), status: "completed" },
          started(task("b", "tester", ["a"])),
          task("c", "reviewer", ["b", "a"]),
        ],
        agents: [agent("builder"), agent("tester"), agent("reviewer")],
      }),
    );
    expect([...handoffs]).toEqual([
      ["b", "Result passed to tester"],
      ["c", "Both results go to reviewer"],
    ]);
  });

  it("names the senders when they are not the tasks just above", () => {
    const agents = [agent("builder"), agent("designer"), agent("tester"), agent("reviewer")];
    const handoffs = teamHandoffs(
      plan({
        agents,
        tasks: [
          task("a", "builder"),
          task("b", "designer"),
          task("c", "tester"),
          task("d", "reviewer", ["a"]),
          task("e", "reviewer", ["a", "b", "c", "d"]),
          task("f", "reviewer", ["a", "c"]),
        ],
      }),
    );
    expect(handoffs.get(TeamTaskId.make("d"))).toBe("Result from builder goes to reviewer");
    expect(handoffs.get(TeamTaskId.make("e"))).toBe("All 4 results go to reviewer");
    expect(handoffs.get(TeamTaskId.make("f"))).toBe(
      "Results from builder and tester go to reviewer",
    );
    expect(handoffs.has(TeamTaskId.make("a"))).toBe(false);
  });
});

describe("teamStatusText", () => {
  const summary = (status: TeamPlan["status"], completed = 1, failed = 0) => ({
    status,
    total: 3,
    completed,
    failed,
  });

  it.each([
    [summary("proposed", 0), "Waiting for your approval", null],
    [summary("running"), "Running · 1 of 3 done", "1 of 3 done"],
    [summary("failed", 1, 1), "Failed · 1 of 3 done, 1 failed", "1 of 3 done, 1 failed"],
    [summary("completed", 3), "Done", "3 of 3 done"],
    [summary("cancelled"), "Cancelled", "1 of 3 done"],
  ] as const)("%j reads %s", (input, line, progress) => {
    expect(teamStatusText(input)).toMatchObject({ line, progress });
  });
});

describe("threadTeam", () => {
  const teamSummary = {
    planId: TeamPlanId.make("plan-1"),
    status: "running",
    revision: 2,
    total: 3,
    completed: 1,
    failed: 0,
    running: 1,
    cancelled: 0,
  } as const;
  const teamTask = {
    rootThreadId: threadId,
    planId: TeamPlanId.make("plan-1"),
    taskId: TeamTaskId.make("b"),
    attempt: 1,
  };

  it("reads a lead's own summary and an agent's from its lead, for the plan it ran", () => {
    expect(threadTeam({ id: threadId, teamSummary }, null)).toEqual({
      role: "lead",
      leadThreadId: threadId,
      planId: "plan-1",
      summary: teamSummary,
    });
    const agentThread = { id: ThreadId.make("thread:agent"), teamTask };
    expect(threadTeam(agentThread, { teamSummary })).toMatchObject({
      role: "agent",
      leadThreadId: threadId,
      summary: teamSummary,
    });
    const replaced = { ...teamSummary, planId: TeamPlanId.make("plan-2") };
    expect(threadTeam(agentThread, { teamSummary: replaced })?.summary).toBeNull();
    expect(threadTeam(agentThread, null)?.summary).toBeNull();
    expect(threadTeam({ id: threadId }, null)).toBeNull();
  });
});

it("finds an agent thread's task, and whether a retry replaced its attempt", () => {
  const current = plan({ tasks: [task("z", "builder"), { ...task("a", "reviewer"), attempt: 2 }] });
  const ref = { planId: current.id, taskId: TeamTaskId.make("a") };
  expect(teamTaskOfThread(current, { ...ref, attempt: 2 })).toMatchObject({
    agent: { id: "reviewer" },
    position: 2,
    total: 2,
    superseded: false,
  });
  expect(teamTaskOfThread(current, { ...ref, attempt: 1 })?.superseded).toBe(true);
  expect(
    teamTaskOfThread(current, { ...ref, planId: TeamPlanId.make("plan-2"), attempt: 2 }),
  ).toBeNull();
});

describe("teamAgentHeader", () => {
  const ref = { planId: TeamPlanId.make("plan-1"), taskId: TeamTaskId.make("b"), attempt: 1 };

  it.each([
    ["running", "pending", 1, "Waiting"],
    ["failed", "pending", 1, "Not started"],
    ["running", "completed", 1, "Done"],
    ["running", "pending", 2, "Retried"],
  ] as const)(
    "in a %s plan, a %s task on attempt %i reads %s",
    (planStatus, status, attempt, label) => {
      const current = plan({
        status: planStatus,
        tasks: [task("a", "builder"), { ...task("b", "reviewer", ["a"]), status, attempt }],
      });
      expect(teamAgentHeader(current, ref)).toEqual({
        label: "reviewer",
        position: "Agent 2 of 2",
        modelSelection: { instanceId: codex, model: "gpt-strong" },
        status: label,
      });
    },
  );

  it("falls back to the task's title for an agent the plan does not have", () => {
    const current = plan({ tasks: [task("a", "builder"), task("b", "ghost")] });
    expect(teamAgentHeader(current, ref)).toMatchObject({
      label: "Task b",
      modelSelection: null,
    });
  });
});

describe("teamAssignment", () => {
  const teamTask = { planId: TeamPlanId.make("plan-1"), taskId: TeamTaskId.make("c"), attempt: 1 };
  const brief = { id: "message-1", text: "Act as reviewer.", createdBy: "system" } as const;
  const current = plan({
    tasks: [
      { ...task("a", "builder"), status: "completed", result: "Built it.", threadId },
      { ...task("b", "ghost"), status: "completed", result: "Tested it." },
      task("c", "reviewer", ["b", "a"]),
    ],
  });

  it("shows the task's brief and the results it started from, in its order", () => {
    expect(teamAssignment({ teamTask, firstUserMessage: brief, plan: current })).toEqual({
      messageId: "message-1",
      brief: "Do c.",
      received: [
        { taskId: "b", from: "Task b", result: "Tested it.", threadId: null },
        { taskId: "a", from: "builder", result: "Built it.", threadId },
      ],
      fullText: "Act as reviewer.",
    });
  });

  it("falls back to the message the agent received while the plan is unknown", () => {
    const other = plan({ id: TeamPlanId.make("plan-2") });
    for (const unknown of [null, other]) {
      expect(teamAssignment({ teamTask, firstUserMessage: brief, plan: unknown })).toEqual({
        messageId: "message-1",
        brief: null,
        received: [],
        fullText: "Act as reviewer.",
      });
    }
  });

  it("finds nothing when the first user message is not the system's brief", () => {
    // History windowing can leave out the brief, so a later message comes first.
    const user = { id: "message-3", text: "Also check docs.", createdBy: "user" } as const;
    expect(teamAssignment({ teamTask, firstUserMessage: user, plan: current })).toBeNull();
    expect(teamAssignment({ teamTask, firstUserMessage: undefined, plan: current })).toBeNull();
    expect(
      teamAssignment({ teamTask: undefined, firstUserMessage: brief, plan: current }),
    ).toBeNull();
  });
});

describe("teamResultHandoff", () => {
  const ref = { planId: TeamPlanId.make("plan-1"), taskId: TeamTaskId.make("a"), attempt: 1 };
  const agents = [agent("builder"), agent("tester"), agent("reviewer")];
  const done = { ...task("a", "builder"), status: "completed" } as const;

  it.each([
    [
      "running",
      [done, { ...task("b", "tester", ["a"]), status: "running" }, task("c", "reviewer", ["a"])],
      "This result was passed to tester and goes to reviewer",
    ],
    [
      "completed",
      [
        done,
        { ...task("b", "reviewer", ["a"]), status: "completed" },
        { ...task("c", "reviewer", ["a"]), status: "completed" },
      ],
      "This result was passed to reviewer",
    ],
    ["running", [done, task("b", "tester", ["a"])], "This result goes to tester"],
    ["failed", [done, task("b", "tester", ["a"])], null],
    ["running", [done, task("b", "tester")], null],
    ["running", [task("a", "builder"), task("b", "tester", ["a"])], null],
  ] as const)("in a %s plan reads %s", (status, tasks, line) => {
    expect(teamResultHandoff(plan({ status, agents, tasks }), ref)).toBe(line);
  });

  it("says nothing on an attempt a retry replaced", () => {
    const tasks: ReadonlyArray<TeamTask> = [
      { ...done, attempt: 2 },
      { ...task("b", "tester", ["a"]), status: "running" },
    ];
    expect(teamResultHandoff(plan({ status: "running", agents, tasks }), ref)).toBeNull();
  });
});

it("tells the team-finished wake from other system notifications", () => {
  expect(isTeamFinishedNotification({ source: { kind: "system" }, outcome: "completed" })).toBe(
    true,
  );
  expect(isTeamFinishedNotification({ source: { kind: "system" }, outcome: "failed" })).toBe(false);
  expect(isTeamFinishedNotification({ source: { kind: "system" }, outcome: "updated" })).toBe(
    false,
  );
  expect(
    isTeamFinishedNotification({ source: { kind: "background_task" }, outcome: "completed" }),
  ).toBe(false);
});
