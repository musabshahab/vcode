# Team tasks

A lead thread holds a team plan in `thread.team`: agents, tasks, and each task's state. The
decisions below span the orchestrator, the effect worker, thread launch, and the MCP tools. The
transitions themselves are in
[`TeamPlan.ts`](../../apps/server/src/orchestration-v2/TeamPlan.ts) and
[`@codenine/shared/team`](../../packages/shared/src/team.ts).

## A team task is a launched thread, not a delegated task

`delegated_task.request` needs a live parent run, and its result returns into that run. A lead ends
its turn after it proposes a team, and the user may approve hours later. So
[`TeamTaskService`](../../apps/server/src/orchestration-v2/TeamTaskService.ts) starts each task as
an ordinary top-level thread through `ThreadLaunchService`, marked with `thread.teamTask`. The lead
is not its parent in `lineage`, and none of the delegated-task machinery (completion delivery,
`task_status`, `task_cancel`) applies to it.

A retry launches a new thread for the next attempt. Never send a retry into the earlier thread:
moving it to another model would switch a provider session mid-conversation, which is the cost the
team exists to avoid.

Task threads are working threads, not where the user reads the outcome; the lead's final message
is. So when a plan completes or is cancelled, the server settles (the UI says "marks done") the
thread of every attempt of every task (attempt ids are derived from the plan, task and attempt). A
failed plan keeps its threads active, because the user reads and retries them there. The lead is never settled, and a
thread the user explicitly unsettled keeps that choice.

## The plan lives in the thread payload

Plan changes are `thread.metadata-updated` events, so the thread stream delivers them with no new
event type or table. Two things follow:

- Every thread event on the lead carries the whole plan, including `thread.visited`. The limits in
  [`team.ts`](../../packages/contracts/src/team.ts) bound that payload. Keep per-task output in the
  task's own thread, not in the plan.
- A plan this build cannot decode reads as `null` instead of failing the thread, so a client older
  than its server keeps the thread and loses only the plan.

Thread lists read shells, and every client receives every shell change, so a lead's shell carries
`teamSummary` (the plan's status and task counts), never the plan. Lists, Needs you and the Team
strip read only `teamSummary`. An agent thread's header and the Task tab read the plan from the
lead's thread detail, so viewing an agent thread keeps the lead's thread stream open too. Anything
shown for many threads at once stays on the summary.

Only the server may set `teamTask`: a thread with it reports its result into the lead's plan, so a
client's `thread.create` has the field removed, and `team.task.settle` is an internal command.
Forks and delegated children reset both fields.

## The client finds two messages by structure

The web client marks two messages by where they sit in the thread, not by their text, so the server
must keep that shape:

- The **Task result** card is the lead's final message in a run that a completed system
  notification started. The team wake for a completed plan is the only such notification (a restart
  continuation is `updated`), so a new sender of completed system notifications would turn its
  reply into a Task result too. See `isTeamFinishedNotification` in
  [`client-runtime/team.ts`](../../packages/client-runtime/src/team.ts).
- An agent's **Assignment from the lead** is the first user message of a `teamTask` thread when
  its `createdBy` is `"system"`. The composed brief must stay that thread's first user message.

## The composer's Team toggle

A message sent with Team on carries a `team-request` context record that no text links.
`projectComposerContextForProvider` in
[`composerContextReferences.ts`](../../packages/shared/src/composerContextReferences.ts) appends one
instruction for it, so Codex and Claude get the same text on turn start and on steer, and no adapter
adds its own. A server older than the record cannot decode it (an unknown record needs a
`payload`), drops it, and sends the message without the instruction.

## Effects run on the lead's lane

`team-task.launch`, `team-task.stop`, `team.lead-wake`, and `team.task-threads.settle` are queued
under the lead thread's id, whichever task they act on. The outbox runs one thread's effects in
order, which is what keeps a cancel's stop behind the launch of the same task, and its settle
behind the stops. Each effect rereads the plan and does nothing when the task or plan has moved
on, so replaying one after a restart is safe.

[`TeamTaskReactor`](../../apps/server/src/orchestration-v2/TeamTaskReactor.ts) settles a task when
its thread's work has ended, by the same rule that decides a delegated task has a result
(`delegatedTaskProgress`). Like the other reactors it listens only after server activation, while
restart recovery and the effect worker end runs before that. So once it listens, it sweeps the
plans still `running` and settles each task whose work has ended. Reactor and sweep settle a task
with the same command id, so whichever comes second is a no-op. A task waiting on a restart
continuation is settled once that continuation is decided, since a declined one writes no event.

`runtimeLayer.layer` leaves `TeamTaskService` unprovided, because it does not include thread launch.
`layerProduction` provides it; a test built on `layer` supplies its own.
