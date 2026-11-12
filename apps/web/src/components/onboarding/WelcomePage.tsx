import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ServerConfig,
  ServerProvider,
} from "@codenine/contracts";
import { scopeProjectRef, scopeThreadRef } from "@codenine/client-runtime/environment";
import { resolveProviderInstanceDisplayName as agentName } from "@codenine/client-runtime/state/provider-instance-display";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@codenine/client-runtime/state/runtime";
import { AuthProvidersManageScope, AuthTerminalOperateScope, ThreadId } from "@codenine/contracts";
import { Link, useBlocker } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { CheckIcon, ChevronDownIcon, PlusIcon, TerminalIcon } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { openCommandPalette } from "../../commandPaletteBus";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useScratchProject } from "../../hooks/useScratchProject";
import { usePersistEnvironmentProviderInstanceMutation } from "../../hooks/useSettings";
import { workspaceAreaProps } from "../../lib/workspaceFocus";
import { completeOnboarding } from "../../onboarding/firstRun";
import {
  resolveOnboardingProviderInstallCommand,
  resolveOnboardingProviderLoginCommand,
} from "../../onboarding/providerReadiness.logic";
import {
  cliTerminalStep,
  codexCardProvider,
  codexNeedsSetup,
  groupWelcomeAgents,
  isBrokenVersion,
  turnedOnInstance,
  type WelcomeProjectSource,
  type WelcomeStep,
  welcomeAgentState,
} from "../../onboarding/welcomePage.logic";
import { randomUUID } from "../../lib/utils";
import { useEnvironments, usePrimaryEnvironmentId } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { terminalEnvironment } from "../../state/terminal";
import { useAtomCommand } from "../../state/use-atom-command";
import { getProviderSummary } from "../settings/providerStatus";
import { useDesktopCliCommand } from "../settings/CliCommandSettingsRow";
import { CodexSetupSection } from "../settings/CodexSetupSection";
import { readCodexSetupMode } from "../settings/CodexSetupSection.logic";
import { TerminalViewport } from "../ThreadTerminalDrawer";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { cn } from "../../lib/utils";
import { WelcomeProjectStep, WelcomeSteps } from "./WelcomeProjectStep";

const AGENT_ONBOARDING_THREAD_ID = ThreadId.make("onboarding-agent-setup");

/** Opens the page setup ends on. False sends the user to the app's home instead. */
export type WelcomeLanding = () => Promise<boolean>;

/**
 * First-run page for one computer: its agents, then a project. Every part is optional except one
 * ready agent to start chatting.
 */
export function WelcomePage({
  environmentId,
  onDone,
}: {
  readonly environmentId: EnvironmentId;
  readonly onDone: (landing: WelcomeLanding) => void | Promise<void>;
}) {
  const { environments } = useEnvironments();
  const environment = environments.find((entry) => entry.environmentId === environmentId);
  const label = environment?.label ?? "this computer";
  const welcomeAgents = useWelcomeAgents(environmentId);
  const agentReady = welcomeAgents.readyCount > 0;
  const [step, setStep] = useState<WelcomeStep>("agents");
  const handleNewThread = useNewThreadHandler();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const scratchTargetEnvironmentId = scratchEnvironmentId(environmentId);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  // `codenine` on PATH belongs to the primary computer, so only it offers that.
  const isPrimary = primaryEnvironmentId === environmentId;
  // True while setup is saved before a landing; leaving earlier would drop the landing.
  const holdPageRef = useRef(false);
  useBlocker({
    shouldBlockFn: () => {
      if (!holdPageRef.current) return false;
      toastManager.add({
        id: "welcome-finishing",
        type: "info",
        title: "Finishing setup",
        description: "One moment.",
      });
      return true;
    },
    // Electron cancels a quit silently when unload is blocked.
    enableBeforeUnload: false,
  });
  const finishingPromiseRef = useRef<Promise<boolean> | null>(null);
  const completionErrorToastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);
  // Without a landing, setup is saved and the page stays, for a flow that navigates on its own.
  const finish = (landing: WelcomeLanding | null) => {
    if (finishingPromiseRef.current !== null) return finishingPromiseRef.current;
    if (completionErrorToastIdRef.current !== null) {
      toastManager.close(completionErrorToastIdRef.current);
      completionErrorToastIdRef.current = null;
    }

    holdPageRef.current = true;
    const completion = completeOnboarding(primaryEnvironmentId)
      .then(async () => {
        if (completionErrorToastIdRef.current !== null) {
          toastManager.close(completionErrorToastIdRef.current);
          completionErrorToastIdRef.current = null;
        }
        // Release before onDone so its own navigation is not blocked.
        holdPageRef.current = false;
        if (landing !== null) await onDone(landing);
        return true;
      })
      .catch(() => {
        holdPageRef.current = false;
        const errorToast = {
          type: "error",
          title: "Could not finish setup",
          description: "Your settings could not be saved. Try again.",
        } as const;
        if (completionErrorToastIdRef.current === null) {
          completionErrorToastIdRef.current = toastManager.add(errorToast);
        } else {
          toastManager.update(completionErrorToastIdRef.current, errorToast);
        }
        return false;
      })
      .finally(() => {
        if (finishingPromiseRef.current === completion) {
          finishingPromiseRef.current = null;
        }
      });
    finishingPromiseRef.current = completion;
    return completion;
  };
  const openProjectDraft = async (project: {
    readonly environmentId: EnvironmentId;
    readonly id: ProjectId;
  }) =>
    (await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
      replace: true,
    })) !== null;
  // The palette's add-project flows open the new project's start screen themselves.
  const addProject = (source: WelcomeProjectSource) => {
    void finish(null).then((saved) => {
      if (saved)
        openCommandPalette({ open: "add-project", addProjectSource: { environmentId, source } });
    });
  };
  const skip = () => {
    void finish(async () => {
      if (scratchTargetEnvironmentId === null) return false;
      const project = await openScratchProject(scratchTargetEnvironmentId);
      return project !== null && (await openProjectDraft(project));
    });
  };

  return (
    <SidebarInset
      {...workspaceAreaProps("home", 1, "Welcome")}
      role="main"
      className="h-dvh min-h-0 overflow-hidden overscroll-y-none"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
        {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
        {isElectron ? <WorkspacePageHeader electron /> : null}
        {/* Keyed by step, so each step opens at its top. */}
        <div key={step} className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-both">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-6 pt-12 pb-8 sm:pt-20">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Welcome to Codenine
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Setting up <span className="text-foreground">{label}</span>.
            </p>
            <WelcomeSteps step={step} />
            {step === "agents" ? (
              <>
                <div className="mt-8 border-t border-border/60">
                  <AgentsSection
                    environmentId={environmentId}
                    label={label}
                    isPrimary={isPrimary}
                  />
                </div>
                <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                  {agentReady ? (
                    <span />
                  ) : (
                    <Button variant="ghost-muted" onClick={() => setStep("project")}>
                      Continue without an agent
                    </Button>
                  )}
                  <div className="flex items-center gap-3">
                    {agentReady ? null : (
                      <span className="text-xs text-muted-foreground">
                        Set up one agent to continue.
                      </span>
                    )}
                    <Button disabled={!agentReady} onClick={() => setStep("project")}>
                      Continue
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <WelcomeProjectStep
                environmentId={environmentId}
                label={label}
                newProjectsRoot={environment?.serverConfig?.newProjectsRoot}
                readyAgentNames={welcomeAgents.found
                  .filter(
                    (provider) =>
                      welcomeAgentState(provider, welcomeAgents.serverConfig?.settings) === "ready",
                  )
                  .map(agentName)}
                canChatWithoutProject={scratchTargetEnvironmentId !== null}
                onChangeAgents={() => setStep("agents")}
                onAddProject={addProject}
                onOpenProject={(projectId) =>
                  void finish(() => openProjectDraft({ environmentId, id: projectId }))
                }
                onSkip={skip}
              />
            )}
          </div>
        </div>
      </div>
    </SidebarInset>
  );
}

// Each part of the page is one band: its label on the left, its rows on the right.
function WelcomeSection({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="grid gap-x-10 border-b border-border/60 py-4 sm:grid-cols-[6rem_minmax(0,1fr)]">
      <h2 className="text-sm leading-10 text-muted-foreground">{title}</h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

// Rows share one icon column, so names, checkboxes, and steps line up down the page.
function RowIcon({ children }: { readonly children: ReactNode }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
      {children}
    </span>
  );
}

const INSTALLABLE_DRIVERS = ["codex", "claudeAgent"] as const;
type OnboardingAgentDriver = (typeof INSTALLABLE_DRIVERS)[number];
const isInstallableDriver = (driver: string): driver is OnboardingAgentDriver =>
  (INSTALLABLE_DRIVERS as ReadonlyArray<string>).includes(driver);

interface AgentTerminalSession {
  readonly environmentId: EnvironmentId;
  readonly driver: OnboardingAgentDriver;
  readonly providerInstanceId: ServerProvider["instanceId"];
  readonly cwd: string;
  readonly command: string;
  readonly keybindings: ServerConfig["keybindings"];
}

// Shared by the page (to enable Start) and the agents section, so both agree on what is ready.
function useWelcomeAgents(environmentId: EnvironmentId) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  return {
    providers,
    serverConfig,
    ...groupWelcomeAgents(providers, serverConfig?.settings, agentName),
  };
}

// The setup card opens below a long list, so bring it into view once.
const revealOnMount = (node: HTMLElement | null) => node?.scrollIntoView({ block: "nearest" });

function AgentsSection({
  environmentId,
  label,
  isPrimary,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPrimary: boolean;
  // The project scan only reads agents that are on, so turning one on can find more history.
}) {
  const { providers, serverConfig, checking, found, available } = useWelcomeAgents(environmentId);
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const persistProviderInstance = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const [terminalSession, setTerminalSession] = useState<AgentTerminalSession | null>(null);
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null);
  const [codexSetupId, setCodexSetupId] = useState<ProviderInstanceId | null>(null);
  const [cliTerminalFor, setCliTerminalFor] = useState<ProviderInstanceId | null>(null);

  // oxlint-disable-next-line codenine/no-unreasoned-state-sync -- asks the environment to refresh its provider list when the environment changes
  useEffect(() => {
    void refreshProviders({ environmentId, input: {} });
  }, [environmentId, refreshProviders]);

  // Opened once the finished checks find nothing, since adding an agent is then the task. A first
  // status can be wrong, so this waits for the checks, and a later check never closes it.
  if (moreOpen === null && !checking && found.length === 0) setMoreOpen(true);
  const showMore = moreOpen ?? false;
  const stateOf = (provider: ServerProvider) => welcomeAgentState(provider, serverConfig?.settings);
  const needsInstallOrSignIn = (provider: ServerProvider) => {
    const state = stateOf(provider);
    return (
      isInstallableDriver(provider.driver) &&
      !isBrokenVersion(provider) &&
      (state === "install" || state === "signIn")
    );
  };
  // Codex's card also offers ChatGPT sign-in, which still works when the CLI check failed.
  // Codex setup stays mounted by instance while its status changes, so a sign-in that starts
  // after an install is not lost when the agent moves between groups or briefly leaves the list.
  const [lastCodex, setLastCodex] = useState<ServerProvider | null>(null);
  const listedCodex =
    codexSetupId === null
      ? undefined
      : providers?.find((provider) => provider.instanceId === codexSetupId);
  if (listedCodex !== undefined && listedCodex !== lastCodex) setLastCodex(listedCodex);
  const codexSetupProvider = codexCardProvider({
    providers,
    instanceId: codexSetupId,
    last: lastCodex,
    settings: serverConfig?.settings,
  });
  // Once the card closes, a later status change does not reopen it and move the page.
  if (listedCodex !== undefined && codexSetupProvider === null) setCodexSetupId(null);

  const openTerminal = (provider: ServerProvider) => {
    if (
      !isInstallableDriver(provider.driver) ||
      serverConfig === null ||
      !readEnvironmentScope(environmentId, AuthTerminalOperateScope)
    )
      return;
    setTerminalSession({
      environmentId,
      driver: provider.driver,
      providerInstanceId: provider.instanceId,
      cwd: serverConfig.cwd,
      command: provider.installed
        ? resolveOnboardingProviderLoginCommand(
            provider,
            serverConfig.settings,
            serverConfig.environment.platform.os,
          )
        : resolveOnboardingProviderInstallCommand(
            provider.driver,
            serverConfig.environment.platform.os,
          ),
      keybindings: serverConfig.keybindings,
    });
  };

  // "Use existing CLI" opens the CLI's terminal once Codex has checked the CLI.
  const cliProvider =
    cliTerminalFor === null
      ? undefined
      : providers?.find((provider) => provider.instanceId === cliTerminalFor);
  const cliStep =
    cliProvider === undefined ? "done" : cliTerminalStep(cliProvider, serverConfig?.settings);
  if (cliProvider !== undefined && cliStep !== "wait") {
    setCliTerminalFor(null);
    if (cliStep === "open") openTerminal(cliProvider);
  }

  const turnOn = async (provider: ServerProvider) => {
    if (serverConfig === null) return;
    const instance = serverConfig.settings.providerInstances[provider.instanceId] ?? {
      driver: provider.driver,
    };
    const result = await persistProviderInstance({
      operation: "upsert",
      instanceId: provider.instanceId,
      instance: turnedOnInstance(instance),
    });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const cause = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: `Could not turn on ${agentName(provider)}`,
          ...(cause instanceof Error ? { description: cause.message } : {}),
        });
      }
      return;
    }
    void refreshProviders({ environmentId, input: { instanceId: provider.instanceId } });
  };

  // One action per agent, the same in the list and in the grid.
  const actionFor = (provider: ServerProvider) => {
    const state = stateOf(provider);
    const name = agentName(provider);
    const settingsAction = (actionLabel: string) => (
      <Button
        size="xs"
        variant="outline"
        aria-label={`${actionLabel}: ${name}`}
        render={
          <Link
            to="/settings/providers"
            search={{ environmentId, instanceId: provider.instanceId }}
          />
        }
      >
        {actionLabel}
      </Button>
    );
    if (state === "disabled") {
      return (
        <Button
          size="xs"
          variant="outline"
          aria-label={`Turn on: ${name}`}
          disabled={!canManageProviders || serverConfig === null}
          onClick={() => void turnOn(provider)}
        >
          Turn on
        </Button>
      );
    }
    // Settings updates a broken CLI the way it was installed, including a custom binary path.
    if (isBrokenVersion(provider)) return settingsAction("Update");
    if (serverConfig !== null && codexNeedsSetup(provider, serverConfig.settings)) {
      const open = codexSetupId === provider.instanceId;
      return (
        <Button
          size="xs"
          variant="outline"
          aria-label={`Set up: ${name}`}
          aria-expanded={open}
          onClick={() => setCodexSetupId(open ? null : provider.instanceId)}
        >
          Set up
        </Button>
      );
    }
    if (needsInstallOrSignIn(provider)) {
      return (
        <TerminalAction
          name={name}
          signIn={state === "signIn"}
          disabled={
            terminalSession?.providerInstanceId === provider.instanceId ||
            serverConfig === null ||
            !canOperateTerminal
          }
          onClick={() => openTerminal(provider)}
        />
      );
    }
    return settingsAction(
      state === "signIn" ? "Sign in" : state === "attention" ? "Details" : "Set up",
    );
  };

  const notes = [
    !canOperateTerminal &&
    [...found, ...available].some(
      (provider) =>
        needsInstallOrSignIn(provider) || codexNeedsSetup(provider, serverConfig?.settings),
    )
      ? "This connection cannot control terminals."
      : null,
    !canManageProviders &&
    [...found, ...available].some(
      (provider) =>
        stateOf(provider) === "disabled" || codexNeedsSetup(provider, serverConfig?.settings),
    )
      ? "This connection cannot manage agents."
      : null,
  ].filter((note) => note !== null);

  return (
    <WelcomeSection title="Agents">
      {found.map((provider) => (
        <AgentRow
          key={provider.instanceId}
          provider={provider}
          state={stateOf(provider)}
          action={actionFor(provider)}
        />
      ))}
      {checking && found.length === 0 ? (
        <p className="text-sm leading-10 text-muted-foreground">Checking {label}…</p>
      ) : null}
      {notes.map((note) => (
        <p key={note} className="pl-8 text-xs text-muted-foreground">
          {note}
        </p>
      ))}
      <Collapsible open={showMore} onOpenChange={setMoreOpen}>
        <CollapsibleTrigger className="group flex min-h-10 w-full items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          <RowIcon>
            <PlusIcon className="size-4" />
          </RowIcon>
          <span
            className={cn(
              "text-sm group-hover:text-foreground",
              found.length > 0 ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {found.length > 0 ? "Add more agents" : "Set up an agent"}
          </span>
          {showMore ? null : <AgentLogoStack providers={available} />}
          <ChevronDownIcon className="ml-auto size-4 text-muted-foreground group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            {available.map((provider) => (
              <AgentRow
                key={provider.instanceId}
                provider={provider}
                state={stateOf(provider)}
                compact
                action={actionFor(provider)}
              />
            ))}
          </div>
        </CollapsiblePanel>
      </Collapsible>
      {codexSetupProvider !== null && serverConfig !== null ? (
        <div key={codexSetupProvider.instanceId} ref={revealOnMount} className="mt-2">
          <OnboardingCodexSetup
            environmentId={environmentId}
            provider={codexSetupProvider}
            serverConfig={serverConfig}
            onUseCliChange={(useCli) =>
              setCliTerminalFor(useCli ? codexSetupProvider.instanceId : null)
            }
          />
        </div>
      ) : null}
      {isPrimary ? <CliPathSetup /> : null}
      {terminalSession !== null ? (
        <AgentInstallTerminal
          key={`${terminalSession.environmentId}:${terminalSession.providerInstanceId}:${terminalSession.driver}`}
          session={terminalSession}
          onClose={() => {
            setTerminalSession(null);
            void refreshProviders({ environmentId, input: {} });
          }}
        />
      ) : null}
    </WelcomeSection>
  );
}

// A quiet preview of what the fold holds; the names are inside it.
function AgentLogoStack({ providers }: { readonly providers: ReadonlyArray<ServerProvider> }) {
  if (providers.length === 0) return null;
  return (
    <span className="flex items-center gap-2 opacity-60 grayscale" aria-hidden>
      {providers.slice(0, 6).map((provider) => (
        <ProviderInstanceIcon
          key={provider.instanceId}
          driverKind={provider.driver}
          displayName={agentName(provider)}
          iconClassName="size-3.5"
        />
      ))}
    </span>
  );
}

// The ChatGPT card and the CLI card stay one card, so either choice can be undone here.
function OnboardingCodexSetup({
  environmentId,
  provider,
  serverConfig,
  onUseCliChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider;
  readonly serverConfig: ServerConfig;
  // True asks for the CLI's install or sign-in terminal once Codex has checked the CLI.
  readonly onUseCliChange: (useCli: boolean) => void;
}) {
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const persistProviderInstance = usePersistEnvironmentProviderInstanceMutation(environmentId);
  const instanceId = provider.instanceId;
  const instance = serverConfig.settings.providerInstances[instanceId] ?? {
    driver: provider.driver,
    config: {},
  };
  const config =
    instance.config !== null && typeof instance.config === "object" ? instance.config : {};
  const mode = readCodexSetupMode(config);
  const changeMode = (setupMode: "managed" | "existing") => {
    // "Use existing CLI" also opens a terminal to install or sign in to the CLI.
    onUseCliChange(setupMode === "existing");
    const unchanged = mode === setupMode && provider.enabled;
    if (unchanged || !readEnvironmentScope(environmentId, AuthProvidersManageScope)) return;
    // One-instance upsert keeps a provider another client added in the meantime.
    void persistProviderInstance({
      operation: "upsert",
      instanceId,
      instance: { ...instance, enabled: true, config: { ...config, enabled: true, setupMode } },
    }).then((result) => {
      if (result._tag === "Failure") {
        onUseCliChange(false);
        if (!isAtomCommandInterrupted(result)) {
          const cause = squashAtomCommandFailure(result);
          toastManager.add({
            type: "error",
            title: "Could not save Codex setup",
            ...(cause instanceof Error ? { description: cause.message } : {}),
          });
        }
      }
    });
  };
  return (
    <CodexSetupSection
      presentation="onboarding"
      environmentId={environmentId}
      instanceId={instanceId}
      provider={provider}
      mode={mode}
      enabled={provider.enabled}
      readOnly={!canManageProviders}
      existingCliDisabled={!canOperateTerminal}
      displayName={agentName(provider)}
      onModeChange={changeMode}
    />
  );
}

function TerminalAction({
  name,
  signIn,
  disabled,
  onClick,
}: {
  readonly name: string;
  readonly signIn: boolean;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  const label = signIn ? "Sign in" : "Install";
  return (
    <Button
      size="xs"
      variant="outline"
      aria-label={`${label}: ${name}`}
      disabled={disabled}
      onClick={onClick}
    >
      <TerminalIcon className="size-3.5" />
      {label}
    </Button>
  );
}

function AgentRow({
  provider,
  state,
  action,
  compact = false,
}: {
  readonly provider: ServerProvider;
  readonly state: ReturnType<typeof welcomeAgentState>;
  readonly action?: ReactNode;
  // A row in the "Add more agents" grid: the button carries the state, so no detail line.
  readonly compact?: boolean;
}) {
  const name = agentName(provider);
  // Claude Code and Codex tiles show Install or Set up; other agents that are on say why not.
  const brokenMessage = isBrokenVersion(provider)
    ? (provider.compatibilityAdvisory?.message ?? null)
    : null;
  const detail =
    state === "install"
      ? isInstallableDriver(provider.driver)
        ? null
        : "Not installed"
      : compact || state === "ready" || state === "checking"
        ? null
        : state === "attention"
          ? (provider.unavailableReason ??
            brokenMessage ??
            provider.message ??
            getProviderSummary(provider).headline)
          : (brokenMessage ?? getProviderSummary(provider).headline);
  return (
    <div className={cn("flex items-center gap-3", compact ? "min-h-9" : "min-h-10 py-1")}>
      <RowIcon>
        <ProviderInstanceIcon
          driverKind={provider.driver}
          displayName={name}
          iconClassName={compact ? "size-4" : "size-[18px]"}
        />
      </RowIcon>
      <div className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm text-foreground", !compact && "font-medium")}>
          {name}
        </span>
        {detail ? (
          <p className="line-clamp-2 text-xs leading-relaxed break-words text-muted-foreground">
            {detail}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">
        {state === "ready" ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-foreground">
            <CheckIcon className="size-3.5" />
            Ready
          </span>
        ) : state === "checking" ? (
          <span className="text-xs text-muted-foreground">Checking…</span>
        ) : (
          action
        )}
      </div>
    </div>
  );
}

function AgentInstallTerminal({
  session,
  onClose,
}: {
  readonly session: AgentTerminalSession;
  readonly onClose: () => void;
}) {
  const { command, cwd, driver, environmentId, keybindings, providerInstanceId } = session;
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const writeTerminal = useAtomCommand(terminalEnvironment.write, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const setupQueueRef = useRef(Promise.resolve());
  const setupGenerationRef = useRef(0);
  const activeSetupGenerationRef = useRef<number | null>(null);
  const [terminalId] = useState(() => `onboarding-${driver}-${randomUUID()}`);
  const threadRef = scopeThreadRef(environmentId, AGENT_ONBOARDING_THREAD_ID);
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [setupState, setSetupState] = useState<
    "preparing" | "ready" | "openFailed" | "writeFailed"
  >("preparing");
  const terminalReady = setupState === "ready" || setupState === "writeFailed";

  // StrictMode can finish a cancelled open after replacement setup; it must not close or pre-type into that
  // session.
  // oxlint-disable-next-line codenine/no-unreasoned-state-sync -- opens the setup PTY, types the command into it, and closes it on cleanup
  useEffect(() => {
    const generation = setupGenerationRef.current + 1;
    setupGenerationRef.current = generation;
    activeSetupGenerationRef.current = generation;
    // oxlint-disable-next-line react/set-state-in-effect -- A retry or a new command reopens the terminal, which shows as preparing until the open settles.
    setSetupState("preparing");

    setupQueueRef.current = setupQueueRef.current.then(async () => {
      if (activeSetupGenerationRef.current !== generation) return;
      if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        setSetupState("openFailed");
        return;
      }
      const opened = await openTerminal({
        environmentId,
        input: {
          threadId: AGENT_ONBOARDING_THREAD_ID,
          terminalId,
          cwd,
          providerInstanceId,
        },
      });
      if (opened._tag !== "Success") {
        if (activeSetupGenerationRef.current === generation) setSetupState("openFailed");
        return;
      }

      if (activeSetupGenerationRef.current !== generation) return;
      if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        setSetupState("writeFailed");
        return;
      }

      const wrote = await writeTerminal({
        environmentId,
        input: { threadId: AGENT_ONBOARDING_THREAD_ID, terminalId, data: command },
      });
      if (activeSetupGenerationRef.current !== generation) return;
      setSetupState(wrote._tag === "Success" ? "ready" : "writeFailed");
    });

    // Revocation leaves the PTY running; close only while terminal access remains.
    return () => {
      if (activeSetupGenerationRef.current === generation) {
        activeSetupGenerationRef.current = null;
      }
      setupQueueRef.current = setupQueueRef.current.then(async () => {
        if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) return;
        await closeTerminal({
          environmentId,
          input: { threadId: AGENT_ONBOARDING_THREAD_ID, terminalId, deleteHistory: true },
        });
      });
    };
  }, [
    closeTerminal,
    command,
    cwd,
    environmentId,
    openTerminal,
    providerInstanceId,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Retry bumps setupAttempt to open the terminal again.
    setupAttempt,
    terminalId,
    writeTerminal,
  ]);

  return (
    <div
      data-thread-terminal-drawer
      className="mt-4 overflow-hidden rounded-lg border border-border/70 bg-background text-foreground"
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-background/60 px-3 py-1.5">
        <span className="text-2xs font-medium text-muted-foreground">
          {!canOperateTerminal ? (
            "This connection cannot control terminals."
          ) : setupState === "writeFailed" ? (
            <>
              Run <code className="rounded bg-muted px-1 font-mono">{command}</code> in this
              terminal.
            </>
          ) : setupState === "ready" ? (
            "Review the command, then press Enter to run it."
          ) : setupState === "openFailed" ? (
            "Could not open the setup terminal."
          ) : (
            "Preparing command..."
          )}
        </span>
        <div className="flex items-center gap-1">
          {setupState === "openFailed" ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={!canOperateTerminal}
              onClick={() => {
                if (readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
                  setSetupAttempt((value) => value + 1);
                }
              }}
            >
              Retry
            </Button>
          ) : null}
          <Button size="xs" variant="ghost-muted" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div className="h-64">
        {terminalReady ? (
          <TerminalViewport
            threadRef={threadRef}
            threadId={AGENT_ONBOARDING_THREAD_ID}
            terminalId={terminalId}
            terminalLabel={`Install ${driver}`}
            cwd={cwd}
            providerInstanceId={providerInstanceId}
            advancedTypography={advancedTypography}
            onSessionExited={onClose}
            autoFocus
            visible
            keybindings={keybindings}
          />
        ) : null}
      </div>
    </div>
  );
}

/** The desktop app links `codenine` on a fresh install; this puts its folder on PATH when it is not. */
function CliPathSetup() {
  const { state, busy, run } = useDesktopCliCommand();
  const setup = state?.pathSetup;
  if (!setup) return null;
  return (
    <div className="flex min-h-10 items-center gap-3">
      <RowIcon>
        <TerminalIcon className="size-4" />
      </RowIcon>
      <p className="min-w-0 flex-1 text-sm text-muted-foreground">
        {setup.added ? (
          <>
            Added to {setup.file}. Open a new terminal to use{" "}
            <code className="font-mono">codenine</code>.
          </>
        ) : (
          <>
            Use <code className="font-mono">codenine</code> from any terminal. Adds one line to{" "}
            {setup.file}.
          </>
        )}
      </p>
      {setup.added ? null : (
        <Button size="xs" variant="outline" disabled={busy} onClick={() => run("addToPath")}>
          Add to PATH
        </Button>
      )}
    </div>
  );
}
