import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@codenine/client-runtime/environment";
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
  teamHandoffs,
  teamRetryCommand,
  teamSaveCommand,
  teamStatusText,
  teamTaskOfThread,
  teamTaskStatus,
  type TeamDraftChange,
  type TeamDraftEdit,
  type TeamTaskDisplayStatus,
} from "@codenine/client-runtime/team";
import {
  AuthOrchestrationOperateScope,
  CommandId,
  type OrchestrationV2Command,
  type ScopedThreadRef,
  type TeamAgent,
  type TeamAgentId,
  type TeamPlan,
  type TeamPlanStatus,
  type TeamTask,
  type TeamTaskRef,
} from "@codenine/contracts";
import { formatDuration } from "@codenine/shared/orchestrationTiming";
import { teamPlanSummary } from "@codenine/shared/team";
import { formatTokens } from "@codenine/shared/usageFormat";
import { Link } from "@tanstack/react-router";
import { ArrowDownIcon, ChevronDownIcon } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";

import { ComposerHandleContext } from "../../composerHandleContext";
import { readLocalApi } from "../../localApi";
import { cn, randomUUID } from "../../lib/utils";
import { useQuietThreadShell, useThreadStatus } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentScope } from "../../state/session";
import { environmentThreadDetails } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Group } from "../ui/group";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { TeamModelLabel, useTeamModelCatalog, type TeamModelCatalog } from "./TeamAgentModel";
import { TEAM_ROLE_LABELS, TeamDraftEditor } from "./TeamDraftEditor";
import { TeamResultText } from "./TeamResultText";

type BadgeVariant = "info" | "success" | "error" | "warning" | "secondary" | "outline";

const PLAN_BADGE: Record<TeamPlanStatus, BadgeVariant> = {
  proposed: "warning",
  running: "info",
  completed: "success",
  failed: "error",
  cancelled: "secondary",
};

const TASK_STATUS_BADGE: Record<TeamTaskDisplayStatus, BadgeVariant> = {
  pending: "outline",
  running: "info",
  completed: "success",
  failed: "error",
  cancelled: "secondary",
  not_started: "outline",
};

const CONFLICT_NOTICE =
  "The team changed before your changes reached it, so they were not applied. This is the new plan; review it and approve again.";
const OVERTAKEN_NOTICE =
  "The team changed while you were editing, so your unsaved changes were dropped. This is the new plan.";

type PendingAction = "save" | "approve" | "cancel" | `retry:${string}`;

/** The Task tab: the team a lead proposed or runs, or the team an agent's thread works for. */
export function TaskPanel(props: {
  threadRef: ScopedThreadRef;
  /** Opens the Changes tab; unset where the thread has no diff to show. */
  onViewChanges: (() => void) | undefined;
}) {
  const shell = useQuietThreadShell(props.threadRef);
  const teamTask = shell?.source.teamTask;
  return (
    // Its pickers hand focus back to their own triggers, not to the composer.
    <ComposerHandleContext value={null}>
      {teamTask === undefined ? (
        <LeadTaskPanel threadRef={props.threadRef} onViewChanges={props.onViewChanges} />
      ) : (
        <AgentTaskPanel
          threadRef={props.threadRef}
          teamTask={teamTask}
          onViewChanges={props.onViewChanges}
        />
      )}
    </ComposerHandleContext>
  );
}

function LeadTaskPanel(props: {
  threadRef: ScopedThreadRef;
  onViewChanges: (() => void) | undefined;
}) {
  const plan = useAtomValue(environmentThreadDetails.teamAtom(props.threadRef));
  const loading = useThreadStatus(props.threadRef) !== "live";
  if (plan === null) {
    return (
      <TaskPanelLayout footer={null}>
        <p className="text-muted-foreground">
          {loading ? "Loading the team…" : "This thread has no team. Ask the agent to propose one."}
        </p>
      </TaskPanelLayout>
    );
  }
  return (
    <TeamPlanView
      leadRef={props.threadRef}
      plan={plan}
      agentTask={null}
      intro={null}
      onViewChanges={props.onViewChanges}
    />
  );
}

/** An agent's thread shows its lead's plan, which it reads from the lead's own thread. */
function AgentTaskPanel(props: {
  threadRef: ScopedThreadRef;
  teamTask: TeamTaskRef;
  onViewChanges: (() => void) | undefined;
}) {
  const { teamTask } = props;
  const leadRef = scopeThreadRef(props.threadRef.environmentId, teamTask.rootThreadId);
  const lead = useQuietThreadShell(leadRef);
  const plan = useAtomValue(environmentThreadDetails.teamAtom(leadRef));
  const loading = useThreadStatus(leadRef) !== "live";
  const agentTask = plan === null ? null : teamTaskOfThread(plan, teamTask);
  const intro = (
    <Link
      to="/$environmentId/$threadId"
      params={{ environmentId: leadRef.environmentId, threadId: leadRef.threadId }}
      className="-m-2 flex flex-col gap-0.5 rounded-lg p-2 hover:bg-accent/60"
    >
      <span className="text-muted-foreground text-xs">Part of the task</span>
      <span className="font-medium">{lead?.title ?? "Lead thread"}</span>
      {plan !== null && agentTask !== null ? (
        <span className="text-muted-foreground text-xs">
          {teamStatusText(teamPlanSummary(plan)).line}
        </span>
      ) : null}
    </Link>
  );
  if (plan === null || agentTask === null) {
    return (
      <TaskPanelLayout footer={null}>
        {intro}
        <p className="text-muted-foreground">
          {plan === null && loading
            ? "Loading the team…"
            : "The lead has a different team now, so this agent's task is no longer on it."}
        </p>
      </TaskPanelLayout>
    );
  }
  return (
    <TeamPlanView
      leadRef={leadRef}
      plan={plan}
      agentTask={{ ...agentTask, threadRef: props.threadRef, attempt: teamTask.attempt }}
      intro={intro}
      onViewChanges={props.onViewChanges}
    />
  );
}

interface AgentTask {
  readonly task: TeamTask;
  readonly superseded: boolean;
  readonly attempt: number;
  readonly threadRef: ScopedThreadRef;
}

function TaskPanelLayout(props: { footer: ReactNode; children: ReactNode }) {
  return (
    <section aria-label="Task" className="flex min-h-0 flex-1 flex-col text-sm">
      <ScrollArea scrollFade className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 p-4">{props.children}</div>
      </ScrollArea>
      {props.footer}
    </section>
  );
}

function TeamPlanView(props: {
  leadRef: ScopedThreadRef;
  plan: TeamPlan;
  /** On an agent's thread: the task it runs, which the list highlights. */
  agentTask: AgentTask | null;
  intro: ReactNode;
  onViewChanges: (() => void) | undefined;
}) {
  const { leadRef, plan, agentTask } = props;
  const { environmentId, threadId } = leadRef;
  const lead = useQuietThreadShell(leadRef);
  const catalog = useTeamModelCatalog(environmentId, lead?.projectId ?? null);
  const hasOperateScope = useEnvironmentScope(environmentId, AuthOrchestrationOperateScope);
  const permitted = useAtomValue(
    orchestrationEnvironment.v2.dispatchCommand.permissionAtom(environmentId),
  );
  const dispatch = useAtomCommand(orchestrationEnvironment.v2.dispatchCommand, {
    reportFailure: false,
  });
  const [edit, setEdit] = useState<TeamDraftEdit | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);

  const canOperate = hasOperateScope && permitted;
  const proposed = plan.status === "proposed";
  const resolved = resolveTeamDraft(plan, edit);
  const issue = proposed ? teamDraftIssue(resolved.draft) : null;
  // While this client approves or cancels, the plan leaves `proposed` before its edits are cleared.
  const shownNotice = notice ?? (resolved.overtaken && pending === null ? OVERTAKEN_NOTICE : null);
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

  const busy = pending !== null || !canOperate;
  const cancelButton = canCancelTeam(plan) ? (
    <Button size="xs" variant="ghost-destructive" disabled={busy} onClick={() => void cancel()}>
      {pending === "cancel" ? "Cancelling…" : "Cancel team"}
    </Button>
  ) : null;
  const footer = (
    <footer className="flex flex-col gap-2 border-t px-4 py-3 text-xs">
      {shownNotice !== null ? (
        <div role="status" className="flex items-start gap-2 text-warning-foreground">
          <p className="min-w-0 flex-1">{shownNotice}</p>
          <Button size="xs" variant="ghost" onClick={dismissNotice}>
            Dismiss
          </Button>
        </div>
      ) : null}
      {error !== null ? (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      ) : null}
      {proposed ? (
        <>
          {issue !== null ? (
            <p role="alert" className="text-destructive">
              {issue}
            </p>
          ) : (
            <p className="text-muted-foreground">
              {!canOperate
                ? "This connection cannot change or approve the team."
                : resolved.dirty
                  ? "Unsaved changes"
                  : "Nothing runs until you approve."}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {cancelButton}
            <div className="ms-auto flex flex-wrap items-center gap-2">
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
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={busy || issue !== null}
                    onClick={save}
                  >
                    Save
                  </Button>
                </>
              ) : null}
              <Button size="xs" disabled={busy || issue !== null} onClick={approve}>
                {pending === "approve" ? "Approving…" : "Approve and start"}
              </Button>
            </div>
          </div>
        </>
      ) : props.onViewChanges !== undefined || cancelButton !== null ? (
        <div className="flex flex-wrap items-center gap-2">
          {props.onViewChanges !== undefined ? (
            <Button size="xs" variant="outline" onClick={props.onViewChanges}>
              View changes
            </Button>
          ) : null}
          <div className="ms-auto">{cancelButton}</div>
        </div>
      ) : null}
    </footer>
  );

  return (
    <TaskPanelLayout footer={footer}>
      {props.intro}
      <TeamPlanHeader plan={plan} />
      {proposed ? (
        <TeamDraftEditor
          draft={resolved.draft}
          catalog={catalog}
          defaultModelSelection={lead?.modelSelection ?? null}
          disabled={busy}
          onChange={change}
        />
      ) : (
        <TeamTaskList
          plan={plan}
          catalog={catalog}
          agentTask={agentTask}
          environmentId={environmentId}
          pendingAction={pending}
          disabled={busy}
          onRetry={retry}
        />
      )}
      {agentTask !== null ? <AgentUsage agentTask={agentTask} /> : null}
    </TaskPanelLayout>
  );
}

function TeamPlanHeader({ plan }: { plan: TeamPlan }) {
  const summary = teamPlanSummary(plan);
  const status = teamStatusText(summary);
  const done = summary.total === 0 ? 0 : Math.round((summary.completed / summary.total) * 100);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">
          {status.progress ?? "Proposed team"}
        </span>
        <Badge variant={PLAN_BADGE[plan.status]} size="sm">
          {status.label}
        </Badge>
      </div>
      {plan.status === "proposed" ? null : (
        <div aria-hidden className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              "h-full rounded-full",
              plan.status === "completed" ? "bg-success" : "bg-muted-foreground/50",
            )}
            style={{ width: `${done}%` }}
          />
        </div>
      )}
      <p className="whitespace-pre-wrap break-words text-muted-foreground">{plan.goal}</p>
    </div>
  );
}

function TeamTaskList(props: {
  plan: TeamPlan;
  catalog: TeamModelCatalog;
  agentTask: AgentTask | null;
  environmentId: ScopedThreadRef["environmentId"];
  pendingAction: PendingAction | null;
  disabled: boolean;
  onRetry: (task: TeamTask, agentId?: TeamAgentId) => void;
}) {
  const { plan } = props;
  const handoffs = teamHandoffs(plan);
  return (
    <ol aria-label="Agents" className="flex flex-col">
      {plan.tasks.map((task, index) => {
        const handoff = handoffs.get(task.id);
        return (
          <Fragment key={task.id}>
            {handoff === undefined ? null : (
              <li
                aria-label="Handoff"
                className="flex items-center gap-2 px-3 py-1.5 text-muted-foreground text-xs"
              >
                <ArrowDownIcon aria-hidden className="size-3.5 shrink-0" />
                {handoff}
              </li>
            )}
            <TeamTaskRow
              number={index + 1}
              task={task}
              plan={plan}
              agent={plan.agents.find((agent) => agent.id === task.agentId) ?? null}
              catalog={props.catalog}
              environmentId={props.environmentId}
              thisThread={props.agentTask?.task.id === task.id ? props.agentTask : null}
              retrying={props.pendingAction === `retry:${task.id}`}
              disabled={props.disabled}
              onRetry={props.onRetry}
            />
          </Fragment>
        );
      })}
    </ol>
  );
}

function TeamTaskRow(props: {
  number: number;
  task: TeamTask;
  plan: TeamPlan;
  agent: TeamAgent | null;
  catalog: TeamModelCatalog;
  environmentId: ScopedThreadRef["environmentId"];
  /** Set on the row of the task whose thread is open. */
  thisThread: AgentTask | null;
  retrying: boolean;
  disabled: boolean;
  onRetry: (task: TeamTask, agentId?: TeamAgentId) => void;
}) {
  const { task, plan, agent, thisThread } = props;
  const shown = teamTaskStatus(plan, task);
  const usage = task.usage;
  const openThreadId =
    task.threadId !== null && (thisThread === null || thisThread.superseded) ? task.threadId : null;
  return (
    <li
      aria-current={thisThread !== null ? "true" : undefined}
      className={cn(
        "flex flex-col gap-1.5 rounded-lg border p-3",
        thisThread !== null ? "border-info/40 bg-info/8" : "bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate font-medium">
          {props.number} · {agent?.label ?? task.agentId}
          {thisThread !== null ? (
            <span className="font-normal text-muted-foreground"> (this thread)</span>
          ) : null}
        </span>
        {agent !== null ? (
          <Badge variant="outline" size="sm">
            {TEAM_ROLE_LABELS[agent.role]}
          </Badge>
        ) : null}
        <Badge variant={TASK_STATUS_BADGE[shown.status]} size="sm" className="ms-auto">
          {shown.label}
        </Badge>
      </div>
      <p className="break-words">{task.title}</p>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-muted-foreground text-xs">
        {agent !== null ? (
          <TeamModelLabel catalog={props.catalog} selection={agent.modelSelection} />
        ) : null}
        {usage !== undefined ? (
          <span>{formatTokens(usage.inputTokens + usage.outputTokens)} tokens</span>
        ) : null}
        {task.attempt > 1 ? <span>Attempt {task.attempt}</span> : null}
      </div>
      {task.result !== null ? <TeamResultText text={task.result} /> : null}
      {openThreadId !== null || canRetryTeamTask(plan, task) ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {openThreadId !== null ? (
            <InlineButton
              tone="muted"
              render={
                <Link
                  to="/$environmentId/$threadId"
                  params={{ environmentId: props.environmentId, threadId: openThreadId }}
                />
              }
            >
              {thisThread !== null ? "Open the latest attempt" : "Open thread"}
            </InlineButton>
          ) : null}
          {canRetryTeamTask(plan, task) ? (
            <span className="ms-auto">
              <TeamTaskRetry
                task={task}
                agents={plan.agents}
                catalog={props.catalog}
                retrying={props.retrying}
                disabled={props.disabled}
                onRetry={props.onRetry}
              />
            </span>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function AgentUsage({ agentTask }: { agentTask: AgentTask }) {
  const { task, superseded } = agentTask;
  if (superseded) {
    return (
      <p className="text-muted-foreground text-xs">
        This thread ran attempt {agentTask.attempt}. The task was retried in a new thread, which
        holds its latest result.
      </p>
    );
  }
  const usage = task.usage;
  const took =
    task.startedAt !== null && task.completedAt !== null
      ? formatDuration(Date.parse(task.completedAt) - Date.parse(task.startedAt))
      : null;
  if (usage === undefined && took === null) return null;
  return (
    <section aria-label="This agent's usage" className="flex flex-col gap-1 rounded-lg border p-3">
      <h4 className="text-muted-foreground text-xs">This agent's usage</h4>
      <p>
        {[
          usage === undefined
            ? null
            : `${formatTokens(usage.inputTokens)} in, ${formatTokens(usage.outputTokens)} out`,
          took === null ? null : `took ${took}`,
        ]
          .filter((part) => part !== null)
          .join(" · ")}
      </p>
    </section>
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
