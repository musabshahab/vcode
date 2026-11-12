import {
  ProjectId,
  resolveProviderInstanceEnabled,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
} from "@codenine/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  cliTerminalStep,
  codexCardProvider,
  codexNeedsSetup,
  groupWelcomeAgents,
  turnedOnInstance,
  welcomeExistingProjects,
  welcomeProjectSources,
  welcomeStepIndicator,
} from "./welcomePage.logic";

function provider(name: string, overrides: Partial<ServerProvider> = {}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(name.toLowerCase()),
    driver: ProviderDriverKind.make(name.toLowerCase()),
    displayName: name,
    enabled: true,
    installed: true,
    version: "1.0.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-23T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
    ...overrides,
  };
}

const nameOf = (entry: ServerProvider) => entry.displayName ?? entry.driver;
const names = (entries: ReadonlyArray<ServerProvider>) => entries.map(nameOf);

describe("groupWelcomeAgents", () => {
  it("lists agents on the computer by state, then name, and everything else by name", () => {
    const groups = groupWelcomeAgents(
      [
        provider("Zeta", { auth: { status: "unauthenticated" }, status: "error" }),
        provider("Codex"),
        provider("Pi", { enabled: false, status: "disabled" }),
        provider("Grok", { installed: false, status: "error", auth: { status: "unknown" } }),
        provider("Claude"),
        provider("Cursor", { installed: false, status: "warning", auth: { status: "unknown" } }),
      ],
      undefined,
      nameOf,
    );

    expect(names(groups.found)).toEqual(["Claude", "Codex", "Zeta"]);
    // Cursor is still being checked; it stays listed instead of disappearing.
    expect(names(groups.available)).toEqual(["Cursor", "Grok", "Pi"]);
    expect(groups.checking).toBe(true);
    expect(groups.readyCount).toBe(2);
  });

  it("uses this computer's settings and keeps agents that failed to load with the found ones", () => {
    const settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides"> = {
      providerInstances: {
        [ProviderInstanceId.make("claude")]: {
          driver: ProviderDriverKind.make("claude"),
          enabled: false,
        },
      },
      projectSettingsOverrides: {
        [ProjectId.make("project-a")]: {
          providerInstances: { [ProviderInstanceId.make("claude")]: { enabled: true } },
        },
      },
    };
    const groups = groupWelcomeAgents(
      [
        // The server checks Claude because project A turns it on; new projects still cannot use it.
        provider("Claude"),
        provider("Broken", {
          enabled: false,
          installed: false,
          status: "error",
          availability: "unavailable",
          unavailableReason: "Invalid config for instance 'broken'.",
        }),
        // Signed in and healthy, but the server knows this CLI version is broken.
        provider("Codex", {
          compatibilityAdvisory: {
            status: "broken",
            message: "Update Codex to 0.170 or later.",
            recommendedVersion: "0.170.0",
            recommendedRange: null,
          },
        }),
      ],
      settings,
      nameOf,
    );

    expect(names(groups.found)).toEqual(["Broken", "Codex"]);
    expect(names(groups.available)).toEqual(["Claude"]);
    expect(groups.readyCount).toBe(0);
    expect(groups.checking).toBe(false);
  });

  it("reports checking before the computer has sent its providers", () => {
    expect(groupWelcomeAgents(undefined, undefined, nameOf)).toEqual({
      checking: true,
      readyCount: 0,
      found: [],
      available: [],
    });
  });
});

describe("cliTerminalStep", () => {
  it("waits for the CLI's own check, then opens its terminal unless Codex is ready", () => {
    const codex = (overrides: Partial<ServerProvider> = {}) => provider("Codex", overrides);
    const step = (overrides?: Partial<ServerProvider>) =>
      cliTerminalStep(codex(overrides), undefined);

    // Still the ChatGPT sign-in runtime, before the switch to the CLI lands.
    expect(
      step({
        setup: { canAuthenticate: true, canInstall: true },
        auth: { status: "unauthenticated" },
      }),
    ).toBe("wait");
    expect(step({ installed: false, status: "warning", auth: { status: "unknown" } })).toBe("wait");
    expect(step({ installed: false, status: "error", auth: { status: "unknown" } })).toBe("open");
    expect(step({ auth: { status: "unauthenticated" } })).toBe("open");
    // A check that timed out still gets the sign-in command.
    expect(step({ status: "error", auth: { status: "unknown" } })).toBe("open");
    // A broken version is updated from its row in Settings, signed in, signed out, or unchecked.
    const broken = {
      status: "broken",
      message: "Update Codex.",
      recommendedVersion: null,
      recommendedRange: null,
    } as const;
    expect(step({ compatibilityAdvisory: broken })).toBe("done");
    expect(step({ compatibilityAdvisory: broken, auth: { status: "unauthenticated" } })).toBe(
      "done",
    );
    expect(
      step({ compatibilityAdvisory: broken, status: "error", auth: { status: "unknown" } }),
    ).toBe("done");
    // Signed in but needing a look for another reason: a sign-in would not help.
    expect(step({ status: "warning" })).toBe("done");
    // Signed in from its home files with the binary gone: the installer.
    expect(step({ installed: false, status: "error" })).toBe("open");
    expect(step()).toBe("done");
  });
});

describe("turnedOnInstance", () => {
  it("turns an agent on even when older settings keep it off inside its config", () => {
    const pi = ProviderDriverKind.make("pi");
    expect(resolveProviderInstanceEnabled(turnedOnInstance({ driver: pi }))).toBe(true);
    const migrated = turnedOnInstance({ driver: pi, config: { enabled: false, binaryPath: "pi" } });
    expect(resolveProviderInstanceEnabled(migrated)).toBe(true);
    expect(migrated.config).toEqual({ enabled: true, binaryPath: "pi" });
  });
});

describe("codexNeedsSetup", () => {
  it("opens the setup card only while Codex is not signed in", () => {
    const setup = (overrides: Partial<ServerProvider>) =>
      codexNeedsSetup(provider("Codex", overrides), undefined);

    expect(setup({ installed: false, status: "error", auth: { status: "unknown" } })).toBe(true);
    expect(setup({ auth: { status: "unauthenticated" } })).toBe(true);
    // A check that timed out can still sign in with ChatGPT.
    expect(setup({ status: "error", auth: { status: "unknown" } })).toBe(true);
    // Signed in from its home files but the binary is gone: Install, not the card.
    expect(setup({ installed: false, status: "error" })).toBe(false);
    // A broken version gets Update on its row.
    expect(
      setup({
        auth: { status: "unauthenticated" },
        compatibilityAdvisory: {
          status: "broken",
          message: null,
          recommendedVersion: null,
          recommendedRange: null,
        },
      }),
    ).toBe(false);
    expect(setup({})).toBe(false);
    const claude = provider("Claude", { auth: { status: "unauthenticated" } });
    expect(codexNeedsSetup(claude, undefined)).toBe(false);
  });
});

describe("codexCardProvider", () => {
  it("keeps the card on Codex's last status while a rebuild drops it, and closes once signed in", () => {
    const signedOut = provider("Codex", { auth: { status: "unauthenticated" } });
    const card = (providers: ReadonlyArray<ServerProvider>, last: ServerProvider | null = null) =>
      codexCardProvider({ providers, instanceId: signedOut.instanceId, last, settings: undefined });

    expect(card([signedOut])).toBe(signedOut);
    // The instance is missing for one update while it is rebuilt.
    expect(card([], signedOut)).toBe(signedOut);
    expect(card([], provider("Other"))).toBeNull();
    expect(card([provider("Codex")])).toBeNull();
    expect(
      codexCardProvider({
        providers: [signedOut],
        instanceId: null,
        last: null,
        settings: undefined,
      }),
    ).toBeNull();
  });
});

describe("project step", () => {
  it("marks agents done once the project step is current", () => {
    expect(welcomeStepIndicator("agents").map((step) => step.state)).toEqual([
      "current",
      "upcoming",
      "upcoming",
    ]);
    expect(welcomeStepIndicator("project").map((step) => step.state)).toEqual([
      "done",
      "current",
      "upcoming",
    ]);
  });

  it("offers a new project only where the computer has a folder for new projects", () => {
    expect(welcomeProjectSources("/home/user/codenine-projects")).toEqual([
      "new",
      "folder",
      "clone",
    ]);
    expect(welcomeProjectSources(null)).toEqual(["folder", "clone"]);
  });

  it("lists this computer's three latest projects, without archived ones or the no-project home", () => {
    const project = (id: string, updatedAt: string, extra: object = {}) => ({
      id,
      environmentId: "local",
      updatedAt,
      archivedAt: null,
      ...extra,
    });
    const listed = welcomeExistingProjects(
      [
        project("old", "2026-01-01T00:00:00.000Z"),
        project("new", "2026-04-01T00:00:00.000Z"),
        project("scratch", "2026-05-01T00:00:00.000Z", { isScratch: true }),
        project("archived", "2026-05-01T00:00:00.000Z", { archivedAt: "2026-05-02T00:00:00.000Z" }),
        project("remote", "2026-05-01T00:00:00.000Z", { environmentId: "remote" }),
        project("mid", "2026-03-01T00:00:00.000Z"),
        project("older", "2026-02-01T00:00:00.000Z"),
      ],
      "local",
    );
    expect(listed.map((entry) => entry.id)).toEqual(["new", "mid", "older"]);
  });
});
