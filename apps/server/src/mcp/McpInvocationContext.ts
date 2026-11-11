import {
  type AuthMcpClientAccess,
  type EnvironmentId,
  McpCapabilityUnavailableError,
  OrchestratorMcpFailure,
  type ProviderInstanceId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type ThreadId,
} from "@codenine/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { formatThreadLink, hostedThreadLink } from "@codenine/shared/threadLinks";

const ALL_MCP_CAPABILITIES = ["orchestration", "worktree", "pull-requests"] as const;
export type McpCapability = (typeof ALL_MCP_CAPABILITIES)[number];

export interface McpThreadCaller {
  readonly threadId: ThreadId;
  readonly providerSessionId: string;
  readonly providerInstanceId: ProviderInstanceId;
  /** A delegated child task; its parent owns the work it hands back. */
  readonly subagent?: boolean;
}

export interface McpClientCaller {
  readonly sessionId: string;
  readonly label: string;
  readonly access: AuthMcpClientAccess;
  /**
   * Narrower modes the client asked for on this request (`Codenine-Mode-Limit`):
   * passing on the limits of the agent it calls for.
   */
  readonly narrowedTo?: ClientModes | undefined;
  /** An outside client's thread links go through this hosted app, as Copy thread's do. */
  readonly hostedAppUrl?: string | undefined;
}

/**
 * `Codenine-Mode-Limit: <runtimeMode>/<interactionMode>` lets an OAuth client cap
 * a request below what it was approved with, such as to pass on the limits of
 * the agent it calls for. It can only narrow (see
 * `clientModeCeiling`), so a client gains nothing by sending a broad one.
 */
export const MODE_LIMIT_HEADER = "codenine-mode-limit";

export interface ClientModes {
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode;
}

const runtimeModeRank: Record<RuntimeMode, number> = {
  "approval-required": 0,
  "auto-accept-edits": 1,
  auto: 2,
  "full-access": 3,
};
const interactionModeRank: Record<ProviderInteractionMode, number> = { plan: 0, default: 1 };

/**
 * The modes a client caller's writes are capped at: what it was approved
 * with, narrowed by what it asked for on this request. A read-only client
 * never reaches a write (`McpToolAccess` refuses it first), so it maps to the
 * lowest runtime mode rather than to nothing.
 */
export const clientModeCeiling = (client: McpClientCaller | undefined): ClientModes => {
  const approved: ClientModes = {
    runtimeMode:
      client === undefined || client.access === "read-only" ? "approval-required" : client.access,
    interactionMode: "default",
  };
  const asked = client?.narrowedTo;
  if (asked === undefined) return approved;
  return {
    runtimeMode:
      runtimeModeRank[asked.runtimeMode] < runtimeModeRank[approved.runtimeMode]
        ? asked.runtimeMode
        : approved.runtimeMode,
    interactionMode:
      interactionModeRank[asked.interactionMode] < interactionModeRank[approved.interactionMode]
        ? asked.interactionMode
        : approved.interactionMode,
  };
};

/** Thread callers default to their own thread; client callers need thread for tools that act as the caller. */
export interface McpInvocationScope {
  readonly environmentId: EnvironmentId;
  readonly capabilities: ReadonlySet<McpCapability>;
  readonly issuedAt: number;
  readonly requestNamespace: string;
  readonly thread: McpThreadCaller | undefined;
  readonly client: McpClientCaller | undefined;
}

/**
 * Codenine renders `codenine-thread://` links as thread chips. Other MCP clients cannot open them, so
 * they get the hosted link Copy thread copies, which opens the thread in either app or a browser.
 * A known `title` labels the chip for clients that cannot load this environment's threads.
 */
export const threadLinkFor = (
  scope: Pick<McpInvocationScope, "environmentId" | "client">,
  threadId: ThreadId,
  title?: string,
): string => {
  const hostedAppUrl = scope.client?.hostedAppUrl;
  const ref = { environmentId: scope.environmentId, threadId };
  return hostedAppUrl === undefined
    ? formatThreadLink(ref, title)
    : hostedThreadLink(ref, hostedAppUrl);
};

export class McpInvocationContext extends Context.Service<
  McpInvocationContext,
  McpInvocationScope
>()("codenine/mcp/McpInvocationContext") {}

/**
 * `McpSchema.EnabledWhen` for tools a delegated child must not see or call.
 * EnabledWhen only receives the MCP client profile, so read the Codenine caller from the request fiber.
 */
export const hiddenFromSubagents = (): boolean => {
  const fiber = Fiber.getCurrent();
  const scope = fiber && Context.getOrUndefined(fiber.context, McpInvocationContext);
  return scope?.thread?.subagent !== true;
};

const capabilityErrorFields = (invocation: McpInvocationScope) => ({
  environmentId: invocation.environmentId,
  ...(invocation.thread === undefined
    ? {}
    : {
        threadId: invocation.thread.threadId,
        providerSessionId: invocation.thread.providerSessionId,
        providerInstanceId: invocation.thread.providerInstanceId,
      }),
});

export const requireMcpCapability = (
  capability: McpCapability,
): Effect.Effect<McpInvocationScope, McpCapabilityUnavailableError, McpInvocationContext> =>
  McpInvocationContext.pipe(
    Effect.filterOrFail(
      (invocation) => invocation.capabilities.has(capability),
      (invocation) =>
        new McpCapabilityUnavailableError({ capability, ...capabilityErrorFields(invocation) }),
    ),
    Effect.withSpan("mcp.requireCapability"),
  );

const threadCallerRequired = (operation: string) =>
  new OrchestratorMcpFailure({
    code: "thread_credential_required",
    message: `${operation} acts as the calling Codenine thread, so it needs an agent running inside Codenine. This MCP client signed in from outside a thread.`,
  });

export type McpThreadInvocationScope = McpInvocationScope & { readonly thread: McpThreadCaller };

export const requireThreadScope = (scope: McpInvocationScope, operation: string) =>
  scope.thread === undefined
    ? Effect.fail(threadCallerRequired(operation))
    : Effect.succeed(scope as McpThreadInvocationScope);
