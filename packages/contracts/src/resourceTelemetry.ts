import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { HostPowerSnapshot } from "./background.ts";
import { DesktopUpdateChannelSchema, DesktopUpdateStateSchema } from "./ipc.ts";

export const HostResourcesSnapshot = Schema.Struct({
  sampledAt: NonNegativeInt,
  cpuUtilization: Schema.NullOr(Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 1 }))),
  cpuCount: NonNegativeInt,
  availableMemoryBytes: NonNegativeInt,
  totalMemoryBytes: NonNegativeInt,
});
export type HostResourcesSnapshot = typeof HostResourcesSnapshot.Type;

export const ResourceTelemetrySourceStatus = Schema.Literals([
  "starting",
  "healthy",
  "degraded",
  "unavailable",
  "stopped",
]);
export type ResourceTelemetrySourceStatus = typeof ResourceTelemetrySourceStatus.Type;

const DesktopHostPowerSnapshot = Schema.Struct({
  ...HostPowerSnapshot.fields,
  updatedAt: Schema.DateTimeUtcFromString,
});

export const DesktopHostTelemetrySnapshot = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("desktopTelemetry"),
  sequence: NonNegativeInt,
  sampledAtUnixMs: NonNegativeInt,
  electronPid: PositiveInt,
  power: DesktopHostPowerSnapshot,
});
export type DesktopHostTelemetrySnapshot = typeof DesktopHostTelemetrySnapshot.Type;

export const DesktopHostTelemetryHello = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("desktopTelemetryHello"),
  electronPid: PositiveInt,
});
export type DesktopHostTelemetryHello = typeof DesktopHostTelemetryHello.Type;

export const DesktopUpdateRemoteOutcome = Schema.Literals([
  "ready-to-install",
  "up-to-date",
  "failed",
]);
export type DesktopUpdateRemoteOutcome = typeof DesktopUpdateRemoteOutcome.Type;

export const DesktopUpdateStatusReport = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("desktopUpdateStatus"),
  requestId: Schema.optionalKey(TrimmedNonEmptyString),
  outcome: Schema.optionalKey(DesktopUpdateRemoteOutcome),
  reason: Schema.optionalKey(TrimmedNonEmptyString),
  state: DesktopUpdateStateSchema,
});
export type DesktopUpdateStatusReport = typeof DesktopUpdateStatusReport.Type;

export const ShellEnvironmentPatch = Schema.Struct({
  PATH: Schema.optionalKey(Schema.NullOr(Schema.String)),
  DBUS_SESSION_BUS_ADDRESS: Schema.optionalKey(Schema.NullOr(Schema.String)),
  DISPLAY: Schema.optionalKey(Schema.NullOr(Schema.String)),
  LANG: Schema.optionalKey(Schema.NullOr(Schema.String)),
  LC_ALL: Schema.optionalKey(Schema.NullOr(Schema.String)),
  LC_CTYPE: Schema.optionalKey(Schema.NullOr(Schema.String)),
  SSH_AUTH_SOCK: Schema.optionalKey(Schema.NullOr(Schema.String)),
  HOMEBREW_PREFIX: Schema.optionalKey(Schema.NullOr(Schema.String)),
  HOMEBREW_CELLAR: Schema.optionalKey(Schema.NullOr(Schema.String)),
  HOMEBREW_REPOSITORY: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_CONFIG_HOME: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_CURRENT_DESKTOP: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_DATA_HOME: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_RUNTIME_DIR: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_SESSION_DESKTOP: Schema.optionalKey(Schema.NullOr(Schema.String)),
  XDG_SESSION_TYPE: Schema.optionalKey(Schema.NullOr(Schema.String)),
  WAYLAND_DISPLAY: Schema.optionalKey(Schema.NullOr(Schema.String)),
  SSL_CERT_FILE: Schema.optionalKey(Schema.NullOr(Schema.String)),
  SSL_CERT_DIR: Schema.optionalKey(Schema.NullOr(Schema.String)),
  NODE_EXTRA_CA_CERTS: Schema.optionalKey(Schema.NullOr(Schema.String)),
  CODENINE_TELEMETRY_ENABLED: Schema.optionalKey(Schema.NullOr(Schema.String)),
  CODENINE_GITHUB_APP_CLIENT_ID: Schema.optionalKey(Schema.NullOr(Schema.String)),
  __MISE_DIFF: Schema.optionalKey(Schema.NullOr(Schema.String)),
  JAVA_HOME: Schema.optionalKey(Schema.NullOr(Schema.String)),
  FNM_DIR: Schema.optionalKey(Schema.NullOr(Schema.String)),
  FNM_MULTISHELL_PATH: Schema.optionalKey(Schema.NullOr(Schema.String)),
});
export type ShellEnvironmentPatch = typeof ShellEnvironmentPatch.Type;

export const DesktopShellEnvironmentSnapshot = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("shellEnvironment"),
  discovered: Schema.Boolean,
  platform: Schema.String,
  environment: ShellEnvironmentPatch,
});
export type DesktopShellEnvironmentSnapshot = typeof DesktopShellEnvironmentSnapshot.Type;

export const DesktopHostTelemetryMessage = Schema.Union([
  DesktopHostTelemetryHello,
  DesktopShellEnvironmentSnapshot,
  DesktopHostTelemetrySnapshot,
  DesktopUpdateStatusReport,
]);
export type DesktopHostTelemetryMessage = typeof DesktopHostTelemetryMessage.Type;

export const DesktopTelemetrySetHostPowerIntervals = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("setHostPowerIntervals"),
  activeIntervalMs: PositiveInt,
  idleIntervalMs: PositiveInt,
});
export type DesktopTelemetrySetHostPowerIntervals =
  typeof DesktopTelemetrySetHostPowerIntervals.Type;

/** Runs check/download/quit-and-install without local confirmation; the remote RPC click supplies consent. */
export const DesktopTelemetryRequestDesktopUpdate = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("requestDesktopUpdate"),
  requestId: TrimmedNonEmptyString,
  /** A track switch: move to this channel first, and install only `targetVersion`. */
  channel: Schema.optionalKey(DesktopUpdateChannelSchema),
  targetVersion: Schema.optionalKey(TrimmedNonEmptyString),
});
export type DesktopTelemetryRequestDesktopUpdate = typeof DesktopTelemetryRequestDesktopUpdate.Type;

export const DesktopTelemetryCommitDesktopUpdate = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("commitDesktopUpdate"),
  requestId: TrimmedNonEmptyString,
});
export type DesktopTelemetryCommitDesktopUpdate = typeof DesktopTelemetryCommitDesktopUpdate.Type;

export const DesktopTelemetryCancelDesktopUpdate = Schema.Struct({
  version: Schema.Literal(1),
  type: Schema.Literal("cancelDesktopUpdate"),
  requestId: TrimmedNonEmptyString,
});
export type DesktopTelemetryCancelDesktopUpdate = typeof DesktopTelemetryCancelDesktopUpdate.Type;

export const DesktopTelemetryControlMessage = Schema.Union([
  DesktopTelemetrySetHostPowerIntervals,
  DesktopTelemetryRequestDesktopUpdate,
  DesktopTelemetryCommitDesktopUpdate,
  DesktopTelemetryCancelDesktopUpdate,
]);
export type DesktopTelemetryControlMessage = typeof DesktopTelemetryControlMessage.Type;
