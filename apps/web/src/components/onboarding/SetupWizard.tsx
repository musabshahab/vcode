import {
  type EnvironmentId,
  ProjectId,
  type ScopedProjectRef,
  type SubagentModelPresetsResult,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  getCloneDestinationPath,
  getCloneDirectoryPath,
  getNewProjectPathPreview,
} from "@t3tools/client-runtime/operations/projects";
import { inferProjectTitleFromPath } from "@t3tools/client-runtime/state/projects";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { resolvePastedPath } from "@t3tools/shared/path";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { CheckIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { isElectron } from "../../env";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { cn, newProjectId } from "../../lib/utils";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { readLocalApi } from "../../localApi";
import { completeOnboarding } from "../../onboarding/firstRun";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { sourceControlEnvironment } from "../../state/sourceControl";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScopeProvider } from "../settings/SettingsScopeContext";
import { SUBAGENT_MODEL_PRESETS, SubagentModelsSettings } from "../settings/SubagentModelsSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { AgentsSection, useWelcomeAgents } from "./WelcomePage";

const STEPS = [
  { id: "project", title: "Create project" },
  { id: "location", title: "Set location" },
  { id: "providers", title: "Connect providers" },
  { id: "team", title: "Assemble team" },
  { id: "github", title: "Connect GitHub" },
  { id: "review", title: "Review setup" },
  { id: "task", title: "First task" },
] as const;

const PROJECT_KINDS = [
  { kind: "new", title: "New project", detail: "Start an empty folder with a repository." },
  { kind: "existing", title: "Existing folder", detail: "Use code already on this computer." },
  { kind: "clone", title: "Clone a repository", detail: "Copy a repository from GitHub." },
] as const;

const SetupDraft = Schema.Struct({
  step: Schema.Number,
  kind: Schema.Literals(["new", "existing", "clone"]),
  name: Schema.String,
  repositoryUrl: Schema.String,
  /** The existing folder, or the folder new and cloned projects go in. */
  folder: Schema.String,
  /** Set once the project exists, so a reload does not create it twice. */
  projectId: Schema.NullOr(Schema.String),
  task: Schema.String,
});
type SetupDraft = typeof SetupDraft.Type;

const TEAM_ROLES = ["implementation", "research", "review", "design", "test"] as const;
const DEFAULT_PROJECTS_FOLDER = "~/Projects";

/** Where the project will be, or why it cannot be placed yet. */
function projectPlacement(draft: SetupDraft) {
  const folder = draft.folder.trim();
  if (draft.kind === "existing") {
    return folder === ""
      ? { error: "Choose the folder that holds your code." }
      : { path: folder, title: inferProjectTitleFromPath(folder) };
  }
  if (folder === "") return { error: "Choose a folder for your projects." };
  if (draft.kind === "new") {
    const name = draft.name.trim();
    return name === ""
      ? { error: "Give the project a name." }
      : { path: getNewProjectPathPreview(folder, name), title: name };
  }
  const url = draft.repositoryUrl.trim();
  const directory = url === "" ? "" : getCloneDirectoryPath(url, false);
  return directory === ""
    ? { error: "Paste the repository's address." }
    : { path: getCloneDestinationPath(folder, directory), title: directory };
}

export function SetupWizard({
  environmentId,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly onDone: (projectRef?: ScopedProjectRef, prompt?: string) => void | Promise<void>;
}) {
  const { environments } = useEnvironments();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const label = environment?.label ?? "this computer";
  const settings = environment?.serverConfig?.settings;
  const isPrimary = usePrimaryEnvironmentId() === environmentId;
  const agents = useWelcomeAgents(environmentId);
  const [draft, setDraft] = useLocalStorage<SetupDraft, typeof SetupDraft.Encoded>(
    `ensemble:setup:${environmentId}`,
    {
      step: 0,
      kind: "new",
      name: "",
      repositoryUrl: "",
      folder: settings?.addProjectBaseDirectory || DEFAULT_PROJECTS_FOLDER,
      projectId: null,
      task: "",
    },
    SetupDraft,
  );
  const [busy, setBusy] = useState(false);
  const [recommendations, setRecommendations] = useState<SubagentModelPresetsResult | null>(null);
  const update = (patch: Partial<SetupDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const step = STEPS[Math.min(Math.max(draft.step, 0), STEPS.length - 1)] ?? STEPS[0];
  const stepIndex = STEPS.indexOf(step);
  const placement = projectPlacement(draft);

  const createNew = useAtomCommand(projectEnvironment.createNew, { reportFailure: false });
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const startProjectClone = useAtomCommand(sourceControlEnvironment.startProjectClone, {
    reportFailure: false,
  });
  const saveSettings = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const getPresets = useAtomCommand(serverEnvironment.getSubagentModelPresets, {
    reportFailure: false,
  });
  // Built from the providers that are ready, so they are fetched on the way into the team step.
  const loadRecommendations = async () => {
    const result = await getPresets({ environmentId, input: {} });
    setRecommendations(result._tag === "Success" ? result.value : { presets: [] });
  };
  const discovery = useEnvironmentQuery(
    sourceControlEnvironment.discovery({ environmentId, input: {} }),
  );
  const github = discovery.data?.sourceControlProviders.find((item) => item.kind === "github");
  const githubConnected = github?.auth.status === "authenticated";

  const fail = (title: string, description: string) =>
    toastManager.add({ type: "error", title, description });

  /** Makes the project the earlier steps described. Returns its id, or null after reporting why not. */
  const createTheProject = async () => {
    if (draft.projectId !== null) return draft.projectId;
    if ("error" in placement) {
      fail("The project is not ready", placement.error);
      return null;
    }
    const projectId = newProjectId();
    // New and cloned projects share one folder, which later "new project" uses too.
    if (draft.kind !== "existing" && draft.folder.trim() !== settings?.addProjectBaseDirectory) {
      await saveSettings({
        environmentId,
        input: { patch: { addProjectBaseDirectory: draft.folder.trim() } },
      });
    }
    const result =
      draft.kind === "new"
        ? await createNew({ environmentId, input: { name: draft.name.trim() } })
        : draft.kind === "existing"
          ? await createProject({
              environmentId,
              input: {
                projectId,
                title: placement.title,
                workspaceRoot: placement.path,
                createWorkspaceRootIfMissing: true,
                defaultModelSelection: null,
              },
            })
          : await startProjectClone({
              environmentId,
              input: {
                projectId,
                title: placement.title,
                createdAt: new Date().toISOString(),
                remoteUrl: draft.repositoryUrl.trim(),
                destinationPath: placement.path,
              },
            });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        fail(
          "Could not set up the project",
          error instanceof Error ? error.message : "Check the folder and try again.",
        );
      }
      return null;
    }
    const created =
      draft.kind === "new" && "projectId" in result.value ? result.value.projectId : projectId;
    update({ projectId: created });
    return created;
  };

  const finish = async (projectId: string | null, prompt?: string) => {
    setBusy(true);
    const saved = await completeOnboarding().then(
      () => true,
      () => false,
    );
    if (!saved) {
      fail("Could not finish setup", "Your settings could not be saved. Try again.");
      setBusy(false);
      return;
    }
    // Setup can be opened again from Settings, and should then start clean.
    setDraft((current) => ({
      ...current,
      step: 0,
      name: "",
      repositoryUrl: "",
      projectId: null,
      task: "",
    }));
    await onDone(
      projectId === null ? undefined : scopeProjectRef(environmentId, ProjectId.make(projectId)),
      prompt,
    );
    setBusy(false);
  };

  const next = async () => {
    // The first step asks only for the name or address; the folder is checked on its own step.
    const pending =
      step.id === "project" ? placementName(draft) : step.id === "location" ? placement : {};
    if ("error" in pending) {
      fail("One more thing", pending.error);
      return;
    }
    if (step.id === "providers" && agents.readyCount === 0) {
      fail(
        "Connect a provider",
        "The team needs at least one agent that is installed and signed in.",
      );
      return;
    }
    if (step.id === "review") {
      setBusy(true);
      const projectId = await createTheProject();
      setBusy(false);
      if (projectId === null) return;
    }
    if (step.id === "task") {
      const task = draft.task.trim();
      await finish(draft.projectId, task === "" ? undefined : `/team ${task}`);
      return;
    }
    if (step.id === "providers") void loadRecommendations();
    update({ step: stepIndex + 1 });
  };

  const pickFolder = async () => {
    const picked = await readLocalApi()?.dialogs.pickFolder({});
    if (picked) update({ folder: picked });
  };

  const body = ((): ReactNode => {
    switch (step.id) {
      case "project":
        return (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              {PROJECT_KINDS.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  aria-pressed={draft.kind === option.kind}
                  onClick={() =>
                    update({
                      kind: option.kind,
                      // An existing folder has no default; the others share the projects folder.
                      folder:
                        option.kind === "existing"
                          ? ""
                          : settings?.addProjectBaseDirectory || DEFAULT_PROJECTS_FOLDER,
                    })
                  }
                  className={cn(
                    "rounded-lg border px-3 py-2.5 text-left transition-colors",
                    draft.kind === option.kind
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-muted/50",
                  )}
                >
                  <span className="block text-sm font-medium text-foreground">{option.title}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {option.detail}
                  </span>
                </button>
              ))}
            </div>
            {draft.kind === "new" ? (
              <Field label="Project name">
                <Input
                  autoFocus
                  value={draft.name}
                  placeholder="orders-api"
                  onChange={(event) => update({ name: event.target.value })}
                />
              </Field>
            ) : null}
            {draft.kind === "clone" ? (
              <Field
                label="Repository address"
                hint="A private repository asks you to connect GitHub before it is copied."
              >
                <Input
                  autoFocus
                  value={draft.repositoryUrl}
                  placeholder="https://github.com/acme/app"
                  spellCheck={false}
                  onChange={(event) => update({ repositoryUrl: event.target.value })}
                />
              </Field>
            ) : null}
          </>
        );
      case "location":
        return (
          <>
            <Field
              label={draft.kind === "existing" ? "Folder with your code" : "Projects folder"}
              hint={
                draft.kind === "existing"
                  ? `A path on ${label}.`
                  : "New projects and clones go here from now on. You can change it in Settings."
              }
            >
              <div className="flex gap-2">
                <Input
                  autoFocus
                  value={draft.folder}
                  placeholder={draft.kind === "existing" ? "~/code/app" : DEFAULT_PROJECTS_FOLDER}
                  spellCheck={false}
                  onChange={(event) =>
                    update({ folder: resolvePastedPath(draft.folder, event.target.value) })
                  }
                />
                {isElectron && isPrimary ? (
                  <Button variant="outline" onClick={() => void pickFolder()}>
                    Choose…
                  </Button>
                ) : null}
              </div>
            </Field>
            <p className="text-sm text-muted-foreground">
              {"error" in placement ? (
                placement.error
              ) : (
                <>
                  The project will be at{" "}
                  <span className="font-mono text-xs text-foreground">{placement.path}</span>
                </>
              )}
            </p>
          </>
        );
      case "providers":
        return (
          <div className="border-t border-border/60">
            <AgentsSection
              environmentId={environmentId}
              label={label}
              isPrimary={isPrimary}
              onImportSourceEnabled={() => {}}
            />
          </div>
        );
      case "team":
        return (
          <>
            <TeamRecommendations
              recommendations={recommendations}
              current={settings?.teamRoleModelSelections}
              onLoad={() => void loadRecommendations()}
              onUse={(selections) =>
                void saveSettings({
                  environmentId,
                  input: { patch: { teamRoleModelSelections: selections } },
                })
              }
            />
            <SubagentModelsSettings />
          </>
        );
      case "github":
        return (
          <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
            <p className="text-sm font-medium text-foreground">
              {github === undefined
                ? discovery.isPending
                  ? "Checking GitHub…"
                  : "GitHub could not be checked"
                : githubConnected
                  ? `Connected${Option.match(github.auth.account, {
                      onNone: () => "",
                      onSome: (account) => ` as ${account}`,
                    })}`
                  : github.status === "available"
                    ? "Not connected"
                    : "The GitHub command-line tool is not installed"}
            </p>
            <p className="text-sm text-muted-foreground">
              {githubConnected
                ? "The team can clone private repositories and open pull requests."
                : github !== undefined && github.status !== "available"
                  ? github.installHint
                  : "Connecting lets the team clone private repositories and open pull requests. You can skip this and connect later in Settings."}
            </p>
            {githubConnected ? null : (
              <>
                <p className="text-sm text-muted-foreground">
                  In a terminal on {label}, run{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
                    gh auth login
                  </code>{" "}
                  and follow its steps. Then check again.
                </p>
                <div>
                  <Button
                    variant="outline"
                    disabled={discovery.isPending}
                    onClick={() => discovery.refresh()}
                  >
                    Check again
                  </Button>
                </div>
              </>
            )}
          </div>
        );
      case "review":
        return (
          <dl className="divide-y divide-border/60 rounded-lg border border-border">
            <ReviewRow label="Project">
              {"error" in placement ? placement.error : `${placement.title} · ${placement.path}`}
            </ReviewRow>
            <ReviewRow label="Providers">
              {agents.readyCount === 0 ? "None ready yet" : `${agents.readyCount} ready to use`}
            </ReviewRow>
            <ReviewRow label="Team">
              {TEAM_ROLES.map((role) => {
                const model = settings?.teamRoleModelSelections?.[role]?.model;
                return (
                  <span key={role} className="block">
                    <span className="capitalize">{role}</span>: {model ?? "the thread's model"}
                  </span>
                );
              })}
            </ReviewRow>
            <ReviewRow label="GitHub">
              {githubConnected ? "Connected" : "Not connected. Pull requests need it later."}
            </ReviewRow>
          </dl>
        );
      case "task":
        return (
          <Field
            label="What should the team do first?"
            hint="This opens a thread with the task after /team, ready to send. The lead plans it and hands each part to the model you chose for that role. Leave it empty to start with a blank thread."
          >
            <Textarea
              autoFocus
              rows={4}
              value={draft.task}
              placeholder="Add rate limiting to the public API routes, with tests"
              onChange={(event) => update({ task: event.target.value })}
            />
          </Field>
        );
    }
  })();

  return (
    <SidebarInset
      {...workspaceAreaProps("home", 1, "Setup")}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
          <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-8 px-6 pt-10 pb-8 sm:flex-row sm:pt-16">
            <nav aria-label="Setup steps" className="shrink-0 sm:w-48">
              <p className="text-xs text-muted-foreground sm:hidden">
                Step {stepIndex + 1} of {STEPS.length}
              </p>
              <ol className="hidden flex-col gap-1 sm:flex">
                {STEPS.map((entry, index) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      // Later steps open only by going through the ones before them.
                      disabled={index > stepIndex || busy}
                      aria-current={index === stepIndex ? "step" : undefined}
                      onClick={() => update({ step: index })}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm",
                        index === stepIndex
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground enabled:hover:text-foreground",
                      )}
                    >
                      <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-2xs">
                        {index < stepIndex ? <CheckIcon className="size-3" /> : index + 1}
                      </span>
                      {entry.title}
                    </button>
                  </li>
                ))}
              </ol>
            </nav>
            <div className="flex min-w-0 flex-1 flex-col">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                {step.title}
              </h1>
              <p className="mt-1.5 text-sm text-muted-foreground">
                Setting up Ensemble on <span className="text-foreground">{label}</span>.
              </p>
              <div className="mt-8 flex flex-col gap-5">
                <SettingsScopeProvider search={{}} onChange={() => {}} singleEnvironment>
                  {body}
                </SettingsScopeProvider>
              </div>
              <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                <Button variant="ghost-muted" disabled={busy} onClick={() => void finish(null)}>
                  Skip setup
                </Button>
                <div className="flex items-center gap-2">
                  {stepIndex > 0 && draft.projectId === null ? (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => update({ step: stepIndex - 1 })}
                    >
                      Back
                    </Button>
                  ) : null}
                  <Button disabled={busy} onClick={() => void next()}>
                    {step.id === "review"
                      ? "Finish setup"
                      : step.id === "task"
                        ? "Start"
                        : "Continue"}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

/** The first step asks only for the name or address; the folder comes on the next step. */
function placementName(draft: SetupDraft) {
  if (draft.kind === "new" && draft.name.trim() === "")
    return { error: "Give the project a name." };
  if (draft.kind === "clone" && draft.repositoryUrl.trim() === "")
    return { error: "Paste the repository's address." };
  return {};
}

type TeamSelections = SubagentModelPresetsResult["presets"][number]["selections"];

/** The three recommended teams, each built from the models this computer's providers offer. */
function TeamRecommendations({
  recommendations,
  current,
  onLoad,
  onUse,
}: {
  readonly recommendations: SubagentModelPresetsResult | null;
  readonly current: TeamSelections | undefined;
  readonly onLoad: () => void;
  readonly onUse: (selections: TeamSelections) => void;
}) {
  if (recommendations === null) {
    return (
      <div>
        <Button variant="outline" onClick={onLoad}>
          Show recommended teams
        </Button>
      </div>
    );
  }
  if (recommendations.presets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        A recommendation needs two models with a known price to choose between. Connect another
        provider, or pick a model for each role below.
      </p>
    );
  }
  const chosen = JSON.stringify(current ?? {});
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-3">
        {SUBAGENT_MODEL_PRESETS.map(({ id, label, detail }) => {
          const preset = recommendations.presets.find((candidate) => candidate.id === id);
          if (preset === undefined) return null;
          const active = JSON.stringify(preset.selections) === chosen;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => onUse(preset.selections)}
              className={cn(
                "rounded-lg border px-3 py-2.5 text-left transition-colors",
                active ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50",
              )}
            >
              <span className="block text-sm font-medium text-foreground">{label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
              {preset.estimatedCostUsd === undefined ? null : (
                <span className="mt-1.5 block text-xs text-foreground">
                  About ${preset.estimatedCostUsd.toFixed(2)} a task
                </span>
              )}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Costs are a rough guide for the subagents of a typical task at API prices
        {recommendations.strongestCostUsd === undefined
          ? "."
          : `. With the strongest model in every role, about $${recommendations.strongestCostUsd.toFixed(2)}.`}{" "}
        On a subscription the same split spends less of your strongest model&apos;s limits.
      </p>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint?: string;
  readonly children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-foreground">{label}</span>
      {children}
      {hint === undefined ? null : <span className="text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}

function ReviewRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex gap-4 px-3 py-2.5 text-sm">
      <dt className="w-24 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-foreground">{children}</dd>
    </div>
  );
}
