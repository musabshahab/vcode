import type { EnvironmentId, ProjectId } from "@codenine/contracts";
import { AuthOrchestrationOperateScope } from "@codenine/contracts";
import { CheckIcon, FolderOpenIcon, FolderPlusIcon, GitBranchIcon } from "lucide-react";
import type { ComponentType, ReactNode, SVGProps } from "react";

import {
  type WelcomeProjectSource,
  type WelcomeStep,
  welcomeExistingProjects,
  welcomeProjectSources,
  welcomeStepIndicator,
} from "../../onboarding/welcomePage.logic";
import { useProjects } from "../../state/entities";
import { useEnvironmentScope } from "../../state/session";
import { cn } from "../../lib/utils";
import { Button, InlineButton } from "../ui/button";

/** Where setup stands: agents, then a project, then the first task on the start screen. */
export function WelcomeSteps({ step }: { readonly step: WelcomeStep }) {
  return (
    <ol aria-label="Setup steps" className="mt-6 flex flex-wrap items-center gap-2">
      {welcomeStepIndicator(step).map((entry, index) => (
        <li
          key={entry.label}
          aria-current={entry.state === "current" ? "step" : undefined}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs",
            entry.state === "current"
              ? "border-primary/40 bg-primary/10 font-medium text-foreground"
              : "border-border/70 text-muted-foreground",
          )}
        >
          {entry.state === "done" ? (
            <CheckIcon aria-hidden="true" className="size-3.5 text-success" />
          ) : (
            <span aria-hidden="true" className="tabular-nums">
              {index + 1}
            </span>
          )}
          {entry.label}
          {entry.state === "done" ? <span className="sr-only">, done</span> : null}
        </li>
      ))}
    </ol>
  );
}

const SOURCE_CARDS: Record<
  WelcomeProjectSource,
  {
    readonly title: string;
    readonly icon: ComponentType<SVGProps<SVGSVGElement>>;
    readonly description: (label: string) => string;
  }
> = {
  new: {
    title: "New project",
    icon: FolderPlusIcon,
    description: () => "Codenine creates an empty folder with Git set up, ready for a first task.",
  },
  folder: {
    title: "Open a folder",
    icon: FolderOpenIcon,
    description: (label) => `Use code that is already on ${label}.`,
  },
  clone: {
    title: "Clone a repository",
    icon: GitBranchIcon,
    description: () => "Paste a GitHub or Git URL and Codenine downloads it into a new folder.",
  },
};

/** The second setup step: a project to work in, or none for now. */
export function WelcomeProjectStep(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly newProjectsRoot: string | null | undefined;
  readonly readyAgentNames: ReadonlyArray<string>;
  /** False when skipping has nowhere to chat without a project. */
  readonly canChatWithoutProject: boolean;
  readonly onChangeAgents: () => void;
  readonly onAddProject: (source: WelcomeProjectSource) => void;
  readonly onOpenProject: (projectId: ProjectId) => void;
  readonly onSkip: () => void;
}) {
  const canAddProject = useEnvironmentScope(props.environmentId, AuthOrchestrationOperateScope);
  const existingProjects = welcomeExistingProjects(useProjects(), props.environmentId);
  return (
    <>
      <section
        aria-label="Agents"
        className="mt-8 flex flex-wrap items-center justify-between gap-3 border-y border-border/60 py-3"
      >
        <p className="min-w-0 text-sm text-muted-foreground">
          {props.readyAgentNames.length > 0 ? (
            <>
              Agents ready:{" "}
              <span className="text-foreground">{props.readyAgentNames.join(", ")}</span>
            </>
          ) : (
            "No agent is ready yet."
          )}
        </p>
        <Button size="xs" variant="ghost-muted" onClick={props.onChangeAgents}>
          Change
        </Button>
      </section>
      <h2 className="mt-8 text-xl font-semibold tracking-tight text-foreground">Pick a project</h2>
      <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
        A project is a folder on {props.label}. Agents read and change the files in it, and every
        task and chat you start there stays with the project.
      </p>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {welcomeProjectSources(props.newProjectsRoot).map((source) => {
          const card = SOURCE_CARDS[source];
          const Icon = card.icon;
          return (
            <ProjectSourceCard
              key={source}
              icon={<Icon aria-hidden="true" className="size-5 text-primary" />}
              title={card.title}
              description={card.description(props.label)}
              disabled={!canAddProject}
              onClick={() => props.onAddProject(source)}
            />
          );
        })}
      </div>
      {canAddProject ? null : (
        <p className="mt-2 text-xs text-muted-foreground">This connection cannot add projects.</p>
      )}
      {existingProjects.length > 0 ? (
        <section aria-labelledby="welcome-existing-projects" className="mt-6">
          <h3 id="welcome-existing-projects" className="text-sm text-muted-foreground">
            Already on {props.label}
          </h3>
          <ul className="mt-2 flex flex-col gap-1">
            {existingProjects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className="flex min-h-10 w-full items-center justify-between gap-3 rounded-lg border border-border/60 px-3 text-start text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  onClick={() => props.onOpenProject(project.id)}
                >
                  <span className="shrink-0 text-foreground">{project.title}</span>
                  <span className="min-w-0 truncate text-end font-mono text-muted-foreground text-xs [direction:rtl]">
                    <bdi>{project.workspaceRoot}</bdi>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-5">
        <InlineButton onClick={props.onSkip}>
          {props.canChatWithoutProject ? "Skip for now and chat without a project" : "Skip for now"}
        </InlineButton>
        <span className="text-xs text-muted-foreground">
          You can add more projects any time from the sidebar.
        </span>
      </div>
    </>
  );
}

function ProjectSourceCard(props: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      className="flex min-h-32 cursor-pointer flex-col gap-2 rounded-xl border border-border/70 bg-card/60 p-4 text-start outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-64"
      onClick={props.onClick}
    >
      {props.icon}
      <span className="font-medium text-foreground text-sm">{props.title}</span>
      <span className="text-muted-foreground text-xs leading-relaxed">{props.description}</span>
    </button>
  );
}
