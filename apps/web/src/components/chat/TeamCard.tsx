import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@codenine/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@codenine/client-runtime/state/runtime";
import {
  canCancelTeam,
  canRetryTeamTask,
  editTeamDraft,
  resolveTeamDraft,
  savedTeamDraftEdit,
  teamApproveCommands,
  teamCancelCommand,
  teamCommandFailure,
  teamDraftIssue,
  teamRetryCommand,
  teamSaveCommand,
  type TeamDraftChange,
  type TeamDraftEdit,
} from "@codenine/client-runtime/team";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  type OrchestrationV2Command,
  type ProjectId,
  type ScopedThreadRef,
  type TeamAgent,
  type TeamAgentId,
  type TeamPlan,
  type TeamPlanStatus,
  type TeamTask,
  type TeamTaskStatus,
} from "@codenine/contracts";
import { formatTokens } from "@codenine/shared/usageFormat";
import { Atom } from "effect/reactivity";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

import { ComposerHandleContext } from "../../composerHandleContext";
import { readLocalApi } from "../../localApi";
import { randomUUID } from "../../lib/utils";
import { useQuietThreadShell } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentScope } from "../../state/session";
import { environmentThreadDetails } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { ThreadContextChip } from "../ThreadContextChip";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Group } from "../ui/group";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { TeamModelLabel, useTeamModelCatalog, type TeamModelCatalog } from "./TeamAgentModel";
import { TeamDraftEditor, TeamSectionHeading, teamDependencyTitles } from "./TeamDraftEditor";

const EMPTY_TEAM_ATOM = Atom.make<TeamPlan | null>(null).pipe(
  Atom.withLabel("web-thread-team:empty"),
);

type BadgeVariant = "info" | "success" | "error" | "secondary" | "outline";

const PLAN_STATUS: Record<TeamPlanStatus, { label: string; variant: BadgeVariant }> = {
  proposed: { label: "Proposed", variant: "info" },
  running: { label: "Running", variant: "info" },
  completed: { label: "Completed", variant: "success" },
  failed: { label: "Failed", variant: "error" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

const TASK_STATUS: Record<TeamTaskStatus, { label: string; variant: BadgeVariant }> = {
  pending: { label: "Waiting", variant: "outline" },
  running: { label: "Running", variant: "info" },
  completed: { label: "Done", variant: "success" },
  failed: { label: "Failed", variant: "error" },
  cancelled: { label: "Cancelled", variant: "secondary" },
};

const NOT_STARTED = { label: "Not started", variant: "outline" } as const;

const CONFLICT_NOTICE =
  "The team changed before your changes reached it, so they were not applied. This is the new plan; review it and approve again.";
const OVERTAKEN_NOTICE =
  "The team changed while you were editing, so your unsaved changes were dropped. This is the new plan.";

type PendingAction = "save" | "approve" | "cancel" | `retry:${string}`;

/** The team a lead thread proposed or runs. Renders nothing on a thread without one. */
export function TeamCard({ threadRef }: { threadRef: ScopedThreadRef | null }) {
  const plan = useAtomValue(
    threadRef === null ? EMPTY_TEAM_ATOM : environmentThreadDetails.teamAtom(threadRef),
  );
  if (threadRef === null || plan === null) return null;
  return (
    // Its pickers hand focus back to their own triggers, not to the composer below.
    <ComposerHandleContext value={null}>
      <TeamPlanCard key={scopedThreadKey(threadRef)} threadRef={threadRef} plan={plan} />
    </ComposerHandleContext>
  );
}

function TeamPlanCard({ threadRef, plan }: { threadRef: ScopedThreadRef; plan: TeamPlan }) {
  const { environmentId, threadId } = threadRef;
  const shell = useQuietThreadShell(threadRef);
  const catalog = useTeamModelCatalog(environmentId, shell?.projectId ?? null);
  const hasOperateScope = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const permitted = useAtomValue(
    orchestrationEnvironment.v2.dispatchCommand.permissionAtom(environmentId),
  );
  const dispatch = useAtomCommand(orchestrationEnvironment.v2.dispatchCommand, {
    reportFailure: false,
  });
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const [edit, setEdit] = useState<TeamDraftEdit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const canOperate = hasOperateScope && permitted;
  const resolved = resolveTeamDraft(plan, edit);
  const issue = plan.status === "proposed" ? teamDraftIssue(resolved.draft) : null;
  // While this client approves or cancels, the plan leaves `proposed` before its edits are cleared.
  const shownNotice = notice ?? (resolved.overtaken && pending === null ? OVERTAKEN_NOTICE : null);
  const open = expanded ?? (plan.status === "proposed" || plan.status === "running");
  const completed = plan.tasks.filter((task) => task.status === "completed").length;
  const failed = plan.tasks.filter((task) => task.status === "failed").length;
  const newCommandId = () => CommandId.make(randomUUID());

  /** Sends the commands in order and stops at the first one the server rejects. */
  const run = async (action: PendingAction, commands: ReadonlyArray<OrchestrationV2Command>) => {
    if (!canOperate || pending !== null) return;
    setPending(action);
    setError(null);
    setNotice(null);
    for (const command of commands) {
      const result = await dispatch({ environmentId, input: command });
      if (result._tag === "Failure") {
        setPending(null);
        if (isAtomCommandInterrupted(result)) return;
        const failure = teamCommandFailure(squashAtomCommandFailure(result));
        if (failure.conflict) {
          setEdit(null);
          setNotice(CONFLICT_NOTICE);
        } else {
          setError(failure.message);
        }
        return;
      }
      if (command.type === "team.edit") setEdit(savedTeamDraftEdit(plan, resolved));
    }
    if (action === "approve" || action === "cancel") setEdit(null);
    setPending(null);
  };

  const change = (next: TeamDraftChange) => {
    setNotice(null);
    setError(null);
    setEdit(editTeamDraft(plan, edit, next));
  };
  const save = () =>
    void run("save", [teamSaveCommand({ threadId, resolved, commandId: newCommandId() })]);
  const approve = () =>
    void run("approve", teamApproveCommands({ threadId, resolved, newCommandId }));
  const cancel = async () => {
    const api = readLocalApi();
    if (plan.status === "running" && api !== undefined) {
      const confirmed = await settlePromise(() =>
        api.dialogs.confirm(
          "Cancel the team?\nRunning agents stop, and tasks that have not started will not start.",
          { variant: "destructive" },
        ),
      );
      if (confirmed._tag === "Failure" || !confirmed.value) return;
    }
    await run("cancel", [teamCancelCommand({ threadId, commandId: newCommandId() })]);
  };
  const retry = (task: TeamTask, agentId?: TeamAgentId) =>
    void run(`retry:${task.id}`, [
      teamRetryCommand({
        threadId,
        task,
        ...(agentId === undefined ? {} : { agentId }),
        commandId: newCommandId(),
      }),
    ]);
  const dismissNotice = () => {
    setNotice(null);
    if (resolved.overtaken) setEdit(null);
  };

  const status = PLAN_STATUS[plan.status];
  const busy = pending !== null || !canOperate;
  return (
    <section
      aria-label="Team"
      className="mb-2 rounded-lg border border-border bg-background text-xs"
    >
      <Collapsible open={open} onOpenChange={setExpanded}>
        <div className="flex items-center gap-2 px-3 py-2">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 text-left">
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3.5 shrink-0 group-data-panel-open:rotate-90"
            />
            <span className="font-medium">Team</span>
            <Badge variant={status.variant} size="sm">
              {status.label}
            </Badge>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{plan.goal}</span>
          </CollapsibleTrigger>
          {plan.status === "proposed" ? null : (
            <span className="shrink-0 text-muted-foreground">
              {completed} of {plan.tasks.length} done{failed > 0 ? `, ${failed} failed` : ""}
            </span>
          )}
          {canCancelTeam(plan) ? (
            <Button
              size="xs"
              variant="ghost-destructive"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Cancel team
            </Button>
          ) : null}
        </div>
        <CollapsiblePanel animate={false}>
          <div className="flex max-h-[38dvh] flex-col gap-3 overflow-y-auto border-t px-3 py-2">
            <p className="whitespace-pre-wrap break-words">{plan.goal}</p>
            {plan.status === "proposed" ? (
              <TeamDraftEditor
                draft={resolved.draft}
                catalog={catalog}
                defaultModelSelection={shell?.modelSelection ?? null}
                disabled={busy}
                onChange={change}
              />
            ) : (
              <TeamTaskList
                plan={plan}
                catalog={catalog}
                projectId={shell?.projectId ?? null}
                environmentId={environmentId}
                pendingAction={pending}
                disabled={busy}
                onRetry={retry}
              />
            )}
          </div>
        </CollapsiblePanel>
      </Collapsible>
      {shownNotice !== null ? (
        <div
          role="status"
          className="flex items-start gap-2 border-t px-3 py-2 text-warning-foreground"
        >
          <p className="min-w-0 flex-1">{shownNotice}</p>
          <Button size="xs" variant="ghost" onClick={dismissNotice}>
            Dismiss
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <p role="alert" className="border-t px-3 py-2 text-destructive">
          {error}
        </p>
      ) : null}
      {plan.status === "proposed" && open ? (
        <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
          {issue !== null ? (
            <p role="alert" className="min-w-0 flex-1 text-destructive">
              {issue}
            </p>
          ) : (
            <p className="min-w-0 flex-1 text-muted-foreground">
              {!canOperate
                ? "This connection cannot change or approve the team."
                : resolved.dirty
                  ? "Unsaved changes"
                  : "Review the team, then approve it to start."}
            </p>
          )}
          {resolved.dirty ? (
            <>
              <Button
                size="xs"
                variant="ghost"
                disabled={pending !== null}
                onClick={() => setEdit(null)}
              >
                Discard changes
              </Button>
              <Button size="xs" variant="outline" disabled={busy || issue !== null} onClick={save}>
                Save
              </Button>
            </>
          ) : null}
          <Button size="xs" disabled={busy || issue !== null} onClick={approve}>
            {pending === "approve" ? "Approving…" : "Approve"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function TeamTaskList(props: {
  plan: TeamPlan;
  catalog: TeamModelCatalog;
  projectId: ProjectId | null;
  environmentId: ScopedThreadRef["environmentId"];
  pendingAction: PendingAction | null;
  disabled: boolean;
  onRetry: (task: TeamTask, agentId?: TeamAgentId) => void;
}) {
  const { plan } = props;
  return (
    <section aria-label="Tasks" className="flex flex-col gap-1.5">
      <TeamSectionHeading>Tasks</TeamSectionHeading>
      <ol className="flex flex-col divide-y">
        {plan.tasks.map((task) => (
          <TeamTaskRow
            key={task.id}
            task={task}
            plan={plan}
            agent={plan.agents.find((agent) => agent.id === task.agentId) ?? null}
            catalog={props.catalog}
            projectId={props.projectId}
            environmentId={props.environmentId}
            retrying={props.pendingAction === `retry:${task.id}`}
            disabled={props.disabled}
            onRetry={props.onRetry}
          />
        ))}
      </ol>
    </section>
  );
}

function TeamTaskRow(props: {
  task: TeamTask;
  plan: TeamPlan;
  agent: TeamAgent | null;
  catalog: TeamModelCatalog;
  projectId: ProjectId | null;
  environmentId: ScopedThreadRef["environmentId"];
  retrying: boolean;
  disabled: boolean;
  onRetry: (task: TeamTask, agentId?: TeamAgentId) => void;
}) {
  const { task, plan, agent } = props;
  // A plan that stopped leaves its pending tasks unstarted, not waiting.
  const status =
    task.status === "pending" && plan.status !== "running" ? NOT_STARTED : TASK_STATUS[task.status];
  const after = task.status === "pending" ? teamDependencyTitles(plan.tasks, task) : "";
  return (
    <li className="flex flex-col gap-1 py-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={status.variant} size="sm">
          {status.label}
        </Badge>
        <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
        {task.threadId !== null ? (
          <ThreadContextChip
            record={{
              environmentId: props.environmentId,
              threadId: task.threadId,
              title: task.title,
            }}
            projectId={props.projectId}
          />
        ) : null}
        {canRetryTeamTask(plan, task) ? (
          <TeamTaskRetry
            task={task}
            agents={plan.agents}
            catalog={props.catalog}
            retrying={props.retrying}
            disabled={props.disabled}
            onRetry={props.onRetry}
          />
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground">
        <span className="truncate">{agent?.label ?? task.agentId}</span>
        {agent !== null ? (
          <TeamModelLabel catalog={props.catalog} selection={agent.modelSelection} />
        ) : null}
        {task.attempt > 1 ? <span>Attempt {task.attempt}</span> : null}
        {task.usage !== undefined ? (
          <span>
            {formatTokens(task.usage.inputTokens)} in, {formatTokens(task.usage.outputTokens)} out
          </span>
        ) : null}
        {after ? <span className="truncate">After {after}</span> : null}
      </div>
      {task.result !== null ? (
        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground hover:text-foreground">
            <ChevronRightIcon
              aria-hidden="true"
              className="size-3.5 group-data-panel-open:rotate-90"
            />
            Result
          </CollapsibleTrigger>
          <CollapsiblePanel animate={false}>
            <p className="whitespace-pre-wrap break-words pt-1">{task.result}</p>
          </CollapsiblePanel>
        </Collapsible>
      ) : null}
    </li>
  );
}

/** Retry on the task's agent, or pick another agent from the plan, such as a stronger model. */
function TeamTaskRetry(props: {
  task: TeamTask;
  agents: ReadonlyArray<TeamAgent>;
  catalog: TeamModelCatalog;
  retrying: boolean;
  disabled: boolean;
  onRetry: (task: TeamTask, agentId?: TeamAgentId) => void;
}) {
  const { task } = props;
  const others = props.agents.filter((agent) => agent.id !== task.agentId);
  return (
    <Group aria-label={`Retry ${task.title}`}>
      <Button
        size="xs"
        variant="outline"
        disabled={props.disabled}
        onClick={() => props.onRetry(task)}
      >
        {props.retrying ? "Retrying…" : "Retry"}
      </Button>
      {others.length > 0 ? (
        <Menu>
          <MenuTrigger
            disabled={props.disabled}
            render={<Button size="icon-xs" variant="outline" aria-label="Retry on another agent" />}
          >
            <ChevronDownIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuGroup>
              <MenuGroupLabel>Retry on</MenuGroupLabel>
              {others.map((agent) => (
                <MenuItem key={agent.id} onClick={() => props.onRetry(task, agent.id)}>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{agent.label}</span>
                    <span className="text-muted-foreground text-xs">
                      <TeamModelLabel catalog={props.catalog} selection={agent.modelSelection} />
                    </span>
                  </span>
                </MenuItem>
              ))}
            </MenuGroup>
          </MenuPopup>
        </Menu>
      ) : null}
    </Group>
  );
}
