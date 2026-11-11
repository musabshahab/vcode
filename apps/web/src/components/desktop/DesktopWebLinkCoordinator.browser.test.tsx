import type { EnvironmentId } from "@codenine/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render, stubGlobal } from "../../../test/render";

const state = vi.hoisted(() => ({
  navigate: vi.fn(async (): Promise<void> => undefined),
  confirm: vi.fn(async (_message: string) => true),
  connectPairing: vi.fn(async (_input: { pairingUrl: string }) => ({ _tag: "Success" })),
  localEnvironmentDisabled: false,
}));

vi.mock(import("@tanstack/react-router"), async (original) => ({
  ...(await original()),
  useRouter: (() => ({ navigate: state.navigate })) as never,
}));
vi.mock(import("../../state/environments"), async (original) => ({
  ...(await original()),
  usePrimaryEnvironmentId: () => "local" as EnvironmentId,
  usePrimaryEnvironment: (() =>
    state.localEnvironmentDisabled
      ? null
      : {
          environmentId: "local",
          connection: { phase: "connected" },
          serverConfig: {},
        }) as never,
}));
vi.mock(import("../../localEnvironment"), () => ({
  isLocalEnvironmentDisabled: () => state.localEnvironmentDisabled,
}));
vi.mock(import("../../confirmDialog"), async (original) => ({
  ...(await original()),
  requestConfirmDialog: state.confirm,
}));
vi.mock(import("../../connection/onboarding"), async (original) => ({
  ...(await original()),
  connectPairing: "connectPairing" as never,
}));
vi.mock(import("../../state/use-atom-command"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useAtomCommand: ((command: unknown, options: never) =>
      command === "connectPairing"
        ? state.connectPairing
        : actual.useAtomCommand(command as never, options)) as never,
  };
});

import { AppAtomRegistryProvider } from "../../rpc/atomRegistry";
import { DesktopWebLinkCoordinator } from "./DesktopWebLinkCoordinator";

const pairingUrl = "https://vps.example.com/pair#token=ABC123";
const pairLink = `codenine://pair?pairingUrl=${encodeURIComponent(pairingUrl)}`;

function setup() {
  vi.clearAllMocks();
  state.confirm.mockResolvedValue(true);
  state.localEnvironmentDisabled = false;
}

/** Mounts the coordinator behind a desktop bridge that hands over `urls` once the renderer is ready. */
async function mount(...urls: string[]) {
  let deliver: ((url: string) => void) | undefined;
  await using stack = new AsyncDisposableStack();
  stack.use(
    stubGlobal("desktopBridge", {
      getClientSettings: async () => null,
      webLinks: {
        onOpen: (listener: (url: string) => void) => {
          deliver = listener;
          return () => undefined;
        },
        setReady: async (ready: boolean) => {
          if (ready) for (const url of urls.splice(0)) deliver?.(url);
        },
      },
    }),
  );
  stack.use(
    await render(
      <AppAtomRegistryProvider>
        <DesktopWebLinkCoordinator />
      </AppAtomRegistryProvider>,
    ),
  );
  return stack.move();
}

it("adds the backend from a pairing link after the user confirms its host", async () => {
  setup();
  await using _coordinator = await mount(pairLink);
  await vi.waitFor(() =>
    expect(state.connectPairing).toHaveBeenCalledExactlyOnceWith({ pairingUrl }),
  );
  expect(state.confirm).toHaveBeenCalledExactlyOnceWith(
    "Add the backend at https://vps.example.com?",
  );
  expect(state.navigate).not.toHaveBeenCalled();
});

it("does not spend the pairing token when the user declines", async () => {
  setup();
  const otherPairingUrl = "https://other.example.com/pair#token=XYZ789";
  state.confirm.mockResolvedValueOnce(false);
  await using _coordinator = await mount(
    pairLink,
    `codenine://pair?pairingUrl=${encodeURIComponent(otherPairingUrl)}`,
  );
  await vi.waitFor(() => expect(state.connectPairing).toHaveBeenCalled());
  expect(state.confirm).toHaveBeenCalledTimes(2);
  expect(state.connectPairing).toHaveBeenCalledExactlyOnceWith({ pairingUrl: otherPairingUrl });
});

it("skips a repeat of a pairing link that already paired", async () => {
  setup();
  const otherPairingUrl = "https://other.example.com/pair#token=XYZ789";
  await using _coordinator = await mount(
    pairLink,
    pairLink,
    `codenine://pair?pairingUrl=${encodeURIComponent(otherPairingUrl)}`,
  );
  await vi.waitFor(() =>
    expect(state.connectPairing).toHaveBeenLastCalledWith({ pairingUrl: otherPairingUrl }),
  );
  expect(state.confirm).toHaveBeenCalledTimes(2);
  expect(state.connectPairing.mock.calls).toEqual([
    [{ pairingUrl }],
    [{ pairingUrl: otherPairingUrl }],
  ]);
});

it("pairs with Local environment disabled, where there is no primary environment to wait for", async () => {
  setup();
  state.localEnvironmentDisabled = true;
  await using _coordinator = await mount(pairLink);
  await vi.waitFor(() =>
    expect(state.connectPairing).toHaveBeenCalledExactlyOnceWith({ pairingUrl }),
  );
});
