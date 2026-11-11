import type { DesktopBridge } from "@codenine/contracts";
import { exposeClerkBridge } from "@clerk/electron/preload";
import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";

import * as IpcChannels from "./ipc/channels.ts";
import { mergeLegacyLocalStorage } from "./legacyLocalStorageMerge.ts";

exposeClerkBridge({ passkeys: true });

// Runs before any app script reads localStorage. See DesktopLegacyLocalStorage.
try {
  const legacyItems: unknown = ipcRenderer.sendSync(IpcChannels.TAKE_LEGACY_LOCAL_STORAGE_CHANNEL);
  if (typeof legacyItems === "object" && legacyItems !== null) {
    if (mergeLegacyLocalStorage(window.localStorage, legacyItems as Record<string, string>)) {
      void ipcRenderer.invoke(IpcChannels.COMPLETE_LEGACY_LOCAL_STORAGE_CHANNEL);
    }
  }
} catch {}

// oxlint-disable-next-line codenine/no-global-process-runtime -- Electron exposes the client platform in its sandboxed preload process.
const clientPlatform = process.platform;

if (clientPlatform === "darwin") {
  // Native buttons ignore Chromium zoom; reserve native points even after reload.
  const syncWindowControlInset = () => {
    document.documentElement.style.setProperty(
      "--desktop-window-controls-inset",
      `${90 / webFrame.getZoomFactor()}px`,
    );
  };
  window.addEventListener("DOMContentLoaded", syncWindowControlInset, { once: true });
  window.addEventListener("resize", syncWindowControlInset);
}

function unwrapEnsureSshEnvironmentResult(result: unknown) {
  if (
    typeof result === "object" &&
    result !== null &&
    "type" in result &&
    result.type === IpcChannels.SSH_PASSWORD_PROMPT_CANCELLED_RESULT
  ) {
    const message =
      "message" in result && typeof result.message === "string"
        ? result.message
        : "SSH authentication cancelled.";
    throw new Error(message);
  }
  return result as Awaited<ReturnType<DesktopBridge["ensureSshEnvironment"]>>;
}

contextBridge.exposeInMainWorld("desktopBridge", {
  getAppBranding: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_APP_BRANDING_CHANNEL);
    if (typeof result !== "object" || result === null) {
      return null;
    }
    return result as ReturnType<DesktopBridge["getAppBranding"]>;
  },
  getRelayTelemetryEnabled: () =>
    ipcRenderer.sendSync(IpcChannels.GET_RELAY_TELEMETRY_ENABLED_CHANNEL) === true,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  getClientPlatform: () => clientPlatform,
  setNotificationBadge: (badge) =>
    ipcRenderer.invoke(IpcChannels.SET_NOTIFICATION_BADGE_CHANNEL, badge),
  onNotificationBadgeClear: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IpcChannels.SET_NOTIFICATION_BADGE_CHANNEL, handler);
    return () => ipcRenderer.removeListener(IpcChannels.SET_NOTIFICATION_BADGE_CHANNEL, handler);
  },
  onTrackpadScrollBegin: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IpcChannels.TRACKPAD_SCROLL_BEGIN_CHANNEL, handler);
    return () => ipcRenderer.removeListener(IpcChannels.TRACKPAD_SCROLL_BEGIN_CHANNEL, handler);
  },
  onTrackpadScrollEnd: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IpcChannels.TRACKPAD_SCROLL_END_CHANNEL, handler);
    return () => ipcRenderer.removeListener(IpcChannels.TRACKPAD_SCROLL_END_CHANNEL, handler);
  },
  revealWindow: () => ipcRenderer.invoke(IpcChannels.REVEAL_WINDOW_CHANNEL),
  getSystemLocale: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_SYSTEM_LOCALE_CHANNEL);
    return typeof result === "string" ? result : null;
  },
  getPreferredSystemLanguages: () => {
    const result: unknown = ipcRenderer.sendSync(
      IpcChannels.GET_PREFERRED_SYSTEM_LANGUAGES_CHANNEL,
    );
    return Array.isArray(result) ? result.filter((tag) => typeof tag === "string") : [];
  },
  getLocalEnvironmentBootstraps: () => {
    const result = ipcRenderer.sendSync(IpcChannels.GET_LOCAL_ENVIRONMENT_BOOTSTRAPS_CHANNEL);
    if (!Array.isArray(result)) {
      return [];
    }
    return result as ReturnType<DesktopBridge["getLocalEnvironmentBootstraps"]>;
  },
  getLocalEnvironmentBearerToken: () =>
    ipcRenderer.invoke(IpcChannels.GET_LOCAL_ENVIRONMENT_BEARER_TOKEN_CHANNEL),
  getLocalEnvironmentEnabled: () =>
    ipcRenderer.sendSync(IpcChannels.GET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL) !== false,
  setLocalEnvironmentEnabled: (enabled) =>
    ipcRenderer.invoke(IpcChannels.SET_LOCAL_ENVIRONMENT_ENABLED_CHANNEL, enabled),
  getHostEnvironmentId: () => ipcRenderer.invoke(IpcChannels.GET_HOST_ENVIRONMENT_ID_CHANNEL),
  getClientSettings: () => ipcRenderer.invoke(IpcChannels.GET_CLIENT_SETTINGS_CHANNEL),
  setClientSettings: (settings) =>
    ipcRenderer.invoke(IpcChannels.SET_CLIENT_SETTINGS_CHANNEL, settings),
  getConnectionCatalog: () => ipcRenderer.invoke(IpcChannels.GET_CONNECTION_CATALOG_CHANNEL),
  setConnectionCatalog: (catalog) =>
    ipcRenderer.invoke(IpcChannels.SET_CONNECTION_CATALOG_CHANNEL, catalog),
  discoverSshHosts: () => ipcRenderer.invoke(IpcChannels.DISCOVER_SSH_HOSTS_CHANNEL),
  resolveSshHost: (alias) => ipcRenderer.invoke(IpcChannels.RESOLVE_SSH_HOST_CHANNEL, alias),
  ensureSshEnvironment: async (target, options) =>
    unwrapEnsureSshEnvironmentResult(
      await ipcRenderer.invoke(IpcChannels.ENSURE_SSH_ENVIRONMENT_CHANNEL, {
        target,
        ...(options === undefined ? {} : { options }),
      }),
    ),
  disconnectSshEnvironment: (target) =>
    ipcRenderer.invoke(IpcChannels.DISCONNECT_SSH_ENVIRONMENT_CHANNEL, target),
  fetchSshEnvironmentDescriptor: (httpBaseUrl) =>
    ipcRenderer.invoke(IpcChannels.FETCH_SSH_ENVIRONMENT_DESCRIPTOR_CHANNEL, { httpBaseUrl }),
  bootstrapSshBearerSession: (httpBaseUrl, credential) =>
    ipcRenderer.invoke(IpcChannels.BOOTSTRAP_SSH_BEARER_SESSION_CHANNEL, {
      httpBaseUrl,
      credential,
    }),
  fetchSshSessionState: (httpBaseUrl, bearerToken) =>
    ipcRenderer.invoke(IpcChannels.FETCH_SSH_SESSION_STATE_CHANNEL, { httpBaseUrl, bearerToken }),
  onSshPasswordPrompt: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, request: unknown) => {
      if (typeof request !== "object" || request === null) return;
      listener(request as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.SSH_PASSWORD_PROMPT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.SSH_PASSWORD_PROMPT_CHANNEL, wrappedListener);
    };
  },
  resolveSshPasswordPrompt: (requestId, password) =>
    ipcRenderer.invoke(IpcChannels.RESOLVE_SSH_PASSWORD_PROMPT_CHANNEL, { requestId, password }),
  getServerExposureState: () => ipcRenderer.invoke(IpcChannels.GET_SERVER_EXPOSURE_STATE_CHANNEL),
  setServerExposureMode: (mode) =>
    ipcRenderer.invoke(IpcChannels.SET_SERVER_EXPOSURE_MODE_CHANNEL, mode),
  setTailscaleServeEnabled: (input) =>
    ipcRenderer.invoke(IpcChannels.SET_TAILSCALE_SERVE_ENABLED_CHANNEL, input),
  getAdvertisedEndpoints: () => ipcRenderer.invoke(IpcChannels.GET_ADVERTISED_ENDPOINTS_CHANNEL),
  getWslState: () => ipcRenderer.invoke(IpcChannels.GET_WSL_STATE_CHANNEL),
  setWslBackendEnabled: (enabled) =>
    ipcRenderer.invoke(IpcChannels.SET_WSL_BACKEND_ENABLED_CHANNEL, enabled),
  setWslDistro: (distro) => ipcRenderer.invoke(IpcChannels.SET_WSL_DISTRO_CHANNEL, distro),
  setWslOnly: (enabled) => ipcRenderer.invoke(IpcChannels.SET_WSL_ONLY_CHANNEL, enabled),
  pickFolder: (options) => ipcRenderer.invoke(IpcChannels.PICK_FOLDER_CHANNEL, options),
  pickProjectFavicon: (initialPath) =>
    ipcRenderer.invoke(IpcChannels.PICK_PROJECT_FAVICON_CHANNEL, initialPath),
  pickThemeFiles: () => ipcRenderer.invoke(IpcChannels.PICK_THEME_FILES_CHANNEL, undefined),
  setTheme: (theme) => ipcRenderer.invoke(IpcChannels.SET_THEME_CHANNEL, theme),
  showContextMenu: (items, position) =>
    ipcRenderer.invoke(IpcChannels.CONTEXT_MENU_CHANNEL, {
      items,
      ...(position === undefined ? {} : { position }),
    }),
  receiveProviderAuthCallback: (url: string) =>
    ipcRenderer.invoke(IpcChannels.RECEIVE_PROVIDER_AUTH_CALLBACK_CHANNEL, url),
  cancelProviderAuthCallback: (url: string) =>
    ipcRenderer.invoke(IpcChannels.CANCEL_PROVIDER_AUTH_CALLBACK_CHANNEL, url),
  openExternal: (url: string) => ipcRenderer.invoke(IpcChannels.OPEN_EXTERNAL_CHANNEL, url),
  readMedia: (url: string) => ipcRenderer.invoke(IpcChannels.READ_MEDIA_CHANNEL, url),
  probeRemoteEditors: () => ipcRenderer.invoke(IpcChannels.PROBE_REMOTE_EDITORS_CHANNEL, undefined),
  pasteAsText: () => ipcRenderer.invoke(IpcChannels.PASTE_AS_TEXT_CHANNEL, undefined),
  onMenuAction: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, action: unknown) => {
      if (typeof action !== "string") return;
      listener(action);
    };

    ipcRenderer.on(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.MENU_ACTION_CHANNEL, wrappedListener);
    };
  },
  onQuitShortcut: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, hint: unknown) => {
      if (typeof hint !== "object" || hint === null || !("state" in hint)) return;
      if (hint.state === "up") {
        listener({ state: "up" });
        return;
      }
      if (
        hint.state === "down" &&
        "mode" in hint &&
        (hint.mode === "hold" || hint.mode === "double-click")
      ) {
        listener({ state: "down", mode: hint.mode });
      }
    };

    ipcRenderer.on(IpcChannels.QUIT_SHORTCUT_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.QUIT_SHORTCUT_CHANNEL, wrappedListener);
    };
  },
  getWindowFullscreenState: () =>
    ipcRenderer.sendSync(IpcChannels.GET_WINDOW_FULLSCREEN_STATE_CHANNEL) === true,
  getWindowZoomFactor: () => webFrame.getZoomFactor(),
  onWindowFullscreenStateChange: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, fullscreen: unknown) => {
      if (typeof fullscreen !== "boolean") return;
      listener(fullscreen);
    };

    ipcRenderer.on(IpcChannels.WINDOW_FULLSCREEN_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.WINDOW_FULLSCREEN_STATE_CHANNEL, wrappedListener);
    };
  },
  getUpdateState: () => ipcRenderer.invoke(IpcChannels.UPDATE_GET_STATE_CHANNEL),
  setUpdateChannel: (channel, minimumVersion) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_SET_CHANNEL_CHANNEL, { channel, minimumVersion }),
  checkForUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_CHECK_CHANNEL),
  downloadUpdate: () => ipcRenderer.invoke(IpcChannels.UPDATE_DOWNLOAD_CHANNEL),
  installUpdate: (expectedVersion) =>
    ipcRenderer.invoke(IpcChannels.UPDATE_INSTALL_CHANNEL, expectedVersion),
  cliCommand: {
    getState: () => ipcRenderer.invoke(IpcChannels.CLI_COMMAND_GET_STATE_CHANNEL),
    install: () => ipcRenderer.invoke(IpcChannels.CLI_COMMAND_INSTALL_CHANNEL),
    uninstall: () => ipcRenderer.invoke(IpcChannels.CLI_COMMAND_UNINSTALL_CHANNEL),
    addToPath: () => ipcRenderer.invoke(IpcChannels.CLI_COMMAND_ADD_TO_PATH_CHANNEL),
  },
  onUpdateState: (listener) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      if (typeof state !== "object" || state === null) return;
      listener(state as Parameters<typeof listener>[0]);
    };

    ipcRenderer.on(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    return () => {
      ipcRenderer.removeListener(IpcChannels.UPDATE_STATE_CHANNEL, wrappedListener);
    };
  },
  webLinks: {
    setReady: (ready) => ipcRenderer.invoke(IpcChannels.WEB_LINK_READY_CHANNEL, ready),
    onOpen: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, url: unknown) => {
        if (typeof url === "string") listener(url);
      };
      ipcRenderer.on(IpcChannels.WEB_LINK_OPEN_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(IpcChannels.WEB_LINK_OPEN_CHANNEL, wrappedListener);
      };
    },
  },
  appActivation: {
    setReady: (ready) =>
      ipcRenderer.invoke(IpcChannels.DESKTOP_APP_ACTIVATION_READY_CHANNEL, ready),
    complete: (response) =>
      ipcRenderer.invoke(IpcChannels.DESKTOP_APP_ACTIVATION_COMPLETE_CHANNEL, response),
    onRequest: (listener) => {
      const wrappedListener = (_event: Electron.IpcRendererEvent, request: unknown) => {
        if (typeof request !== "object" || request === null) return;
        listener(request as Parameters<typeof listener>[0]);
      };
      ipcRenderer.on(IpcChannels.DESKTOP_APP_ACTIVATION_REQUEST_CHANNEL, wrappedListener);
      return () => {
        ipcRenderer.removeListener(
          IpcChannels.DESKTOP_APP_ACTIVATION_REQUEST_CHANNEL,
          wrappedListener,
        );
      };
    },
  },
} satisfies DesktopBridge);
