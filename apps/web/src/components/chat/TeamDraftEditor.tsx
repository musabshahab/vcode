import { teamAgentInUse, type TeamDraftChange } from "@codenine/client-runtime/team";
import {
  type ModelSelection,
  type TeamAgent,
  type TeamAgentId,
  type TeamAgentRole,
  type TeamDraft,
  type TeamTaskDraft,
  type TeamWorkspace,
} from "@codenine/contracts";
import { ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TeamModelPicker, type TeamModelCatalog } from "./TeamAgentModel";

export const TEAM_ROLE_LABELS: Record<TeamAgentRole, string> = {
  plan: "Plan",
  research: "Research",
  implement: "Implement",
  test: "Test",
  review: "Review",
  integrate: "Integrate",
  custom: "Custom",
};

const TEAM_WORKSPACE_LABELS: Record<TeamWorkspace, string> = {
  shared: "Shared checkout",
  worktree: "Own worktree",
};

const ROLES = Object.keys(TEAM_ROLE_LABELS) as ReadonlyArray<TeamAgentRole>;
const WORKSPACES = Object.keys(TEAM_WORKSPACE_LABELS) as ReadonlyArray<TeamWorkspace>;

/** A task's dependencies by title, for the line under it. */
function teamDependencyTitles(
  tasks: ReadonlyArray<Pick<TeamTaskDraft, "id" | "title">>,
  task: Pick<TeamTaskDraft, "dependsOn">,
): string {
  return task.dependsOn
    .map((id) => tasks.find((candidate) => candidate.id === id)?.title ?? id)
    .join(", ");
}

function TeamSectionHeading(props: { children: string }) {
  return <h4 className="font-medium text-muted-foreground">{props.children}</h4>;
}

/** The body of a proposed team: every field the user can change before approving. */
export function TeamDraftEditor(props: {
  draft: TeamDraft;
  catalog: TeamModelCatalog;
  /** The model a new agent starts on when the team has no agent to copy it from. */
  defaultModelSelection: ModelSelection | null;
  disabled: boolean;
  onChange: (change: TeamDraftChange) => void;
}) {
  const { draft, catalog, disabled, onChange } = props;
  const [adding, setAdding] = useState(false);
  const newAgentModel = draft.agents[0]?.modelSelection ?? props.defaultModelSelection;
  return (
    <div className="flex flex-col gap-3">
      <section aria-label="Agents" className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <TeamSectionHeading>Agents</TeamSectionHeading>
          {adding || newAgentModel === null ? null : (
            <Button size="xs" variant="ghost" disabled={disabled} onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden="true" />
              Add agent
            </Button>
          )}
        </div>
        <ul className="flex flex-col gap-1">
          {draft.agents.map((agent) => (
            <TeamAgentRow
              key={agent.id}
              agent={agent}
              catalog={catalog}
              inUse={teamAgentInUse(draft, agent.id)}
              disabled={disabled}
              onChange={onChange}
            />
          ))}
        </ul>
        {adding && newAgentModel !== null ? (
          <TeamAgentForm
            catalog={catalog}
            defaultModelSelection={newAgentModel}
            disabled={disabled}
            onAdd={(agent) => {
              onChange({ type: "agent.add", ...agent });
              setAdding(false);
            }}
            onClose={() => setAdding(false)}
          />
        ) : null}
      </section>
      <section aria-label="Tasks" className="flex flex-col gap-1.5">
        <TeamSectionHeading>Tasks</TeamSectionHeading>
        <ol className="flex flex-col gap-2">
          {draft.tasks.map((task) => (
            <TeamDraftTaskRow
              key={task.id}
              task={task}
              tasks={draft.tasks}
              agents={draft.agents}
              disabled={disabled}
              onChange={onChange}
            />
          ))}
        </ol>
      </section>
    </div>
  );
}

function TeamAgentRow(props: {
  agent: TeamAgent;
  catalog: TeamModelCatalog;
  inUse: boolean;
  disabled: boolean;
  onChange: (change: TeamDraftChange) => void;
}) {
  const { agent, onChange } = props;
  const remove = (
    <Button
      size="icon-xs"
      variant="ghost-destructive"
      aria-label={`Remove ${agent.label}`}
      disabled={props.disabled || props.inUse}
      onClick={() => onChange({ type: "agent.remove", agentId: agent.id })}
    >
      <XIcon aria-hidden="true" />
    </Button>
  );
  return (
    <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="min-w-0 truncate font-medium">{agent.label}</span>
      <Badge variant="outline" size="sm">
        {TEAM_ROLE_LABELS[agent.role]}
      </Badge>
      <Badge variant="secondary" size="sm">
        {TEAM_WORKSPACE_LABELS[agent.workspace]}
      </Badge>
      <div className="ms-auto flex min-w-0 items-center gap-1">
        <TeamModelPicker
          catalog={props.catalog}
          selection={agent.modelSelection}
          label={`Model for ${agent.label}`}
          disabled={props.disabled}
          onChange={(modelSelection) =>
            onChange({ type: "agent.model", agentId: agent.id, modelSelection })
          }
        />
        {props.inUse ? (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
              {remove}
            </TooltipTrigger>
            <TooltipPopup side="top">Reassign its tasks to remove it</TooltipPopup>
          </Tooltip>
        ) : (
          remove
        )}
      </div>
    </li>
  );
}

function TeamAgentForm(props: {
  catalog: TeamModelCatalog;
  defaultModelSelection: ModelSelection;
  disabled: boolean;
  onAdd: (agent: {
    label: string;
    role: TeamAgentRole;
    modelSelection: ModelSelection;
    workspace: TeamWorkspace;
  }) => void;
  onClose: () => void;
}) {
  const [label, setLabel] = useState("");
  const [role, setRole] = useState<TeamAgentRole>("implement");
  const [workspace, setWorkspace] = useState<TeamWorkspace>("shared");
  const [modelSelection, setModelSelection] = useState(props.defaultModelSelection);
  const canAdd = !props.disabled && label.trim() !== "";
  return (
    <form
      aria-label="New agent"
      className="flex flex-col gap-2 rounded-md border border-dashed p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (canAdd) props.onAdd({ label, role, modelSelection, workspace });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40 flex-1">
          <Input
            size="sm"
            aria-label="Agent name"
            placeholder="Name, such as Reviewer"
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <TeamModelPicker
          catalog={props.catalog}
          selection={modelSelection}
          label="Model for the new agent"
          disabled={props.disabled}
          onChange={setModelSelection}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-32">
          <Select
            value={role}
            onValueChange={(value) => {
              if (value !== null) setRole(value);
            }}
          >
            <SelectTrigger size="xs" aria-label="Role">
              <SelectValue>{(value: TeamAgentRole) => TEAM_ROLE_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {ROLES.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {TEAM_ROLE_LABELS[candidate]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="w-40">
          <Select
            value={workspace}
            onValueChange={(value) => {
              if (value !== null) setWorkspace(value);
            }}
          >
            <SelectTrigger size="xs" aria-label="Workspace">
              <SelectValue>{(value: TeamWorkspace) => TEAM_WORKSPACE_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {WORKSPACES.map((candidate) => (
                <SelectItem key={candidate} value={candidate}>
                  {TEAM_WORKSPACE_LABELS[candidate]}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <div className="ms-auto flex items-center gap-1">
          <Button size="xs" variant="ghost" onClick={props.onClose}>
            Cancel
          </Button>
          <Button size="xs" variant="outline" type="submit" disabled={!canAdd}>
            Add
          </Button>
        </div>
      </div>
    </form>
  );
}

function TeamDraftTaskRow(props: {
  task: TeamTaskDraft;
  tasks: ReadonlyArray<TeamTaskDraft>;
  agents: ReadonlyArray<TeamAgent>;
  disabled: boolean;
  onChange: (change: TeamDraftChange) => void;
}) {
  const { task, onChange } = props;
  const after = teamDependencyTitles(props.tasks, task);
  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{task.title}</span>
        <div className="w-40">
          <Select
            value={task.agentId}
            disabled={props.disabled}
            onValueChange={(agentId: TeamAgentId | null) => {
              if (agentId !== null) onChange({ type: "task.assign", taskId: task.id, agentId });
            }}
          >
            <SelectTrigger size="xs" aria-label={`Agent for ${task.title}`}>
              <SelectValue>
                {(agentId: TeamAgentId) =>
                  props.agents.find((agent) => agent.id === agentId)?.label ?? agentId
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {props.agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
        <Button
          size="icon-xs"
          variant="ghost-destructive"
          aria-label={`Remove ${task.title}`}
          disabled={props.disabled}
          onClick={() => onChange({ type: "task.remove", taskId: task.id })}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      {after ? <p className="text-muted-foreground">After {after}</p> : null}
      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 text-muted-foreground hover:text-foreground">
          <ChevronRightIcon
            aria-hidden="true"
            className="size-3.5 group-data-panel-open:rotate-90"
          />
          Brief
        </CollapsibleTrigger>
        <CollapsiblePanel animate={false}>
          <div className="pt-1">
            <Textarea
              size="sm"
              aria-label={`Brief for ${task.title}`}
              value={task.brief}
              readOnly={props.disabled}
              onChange={(event) =>
                onChange({ type: "task.brief", taskId: task.id, brief: event.target.value })
              }
            />
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}
