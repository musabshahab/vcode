import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Types from "effect/Types";
import { McpProtocol, McpSchema, McpServer, Tool, Toolkit } from "effect/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { ProviderInteractionMode, RuntimeMode } from "@codenine/contracts";

import packageJson from "../../package.json" with { type: "json" };
import { parseBearerToken } from "../auth/EnvironmentAuth.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import { advertisedJsonSchema } from "./advertisedJsonSchema.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpToolAccess from "./McpToolAccess.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";
import { EnvironmentToolkit } from "./toolkits/environment/tools.ts";
import * as EnvironmentHandlers from "./toolkits/environment/handlers.ts";
import { ProjectToolkit } from "./toolkits/project/tools.ts";
import * as ProjectHandlers from "./toolkits/project/handlers.ts";
import { AttachmentToolkit } from "./toolkits/attachment/tools.ts";
import * as AttachmentHandlers from "./toolkits/attachment/handlers.ts";
import { ThreadToolkit } from "./toolkits/thread/tools.ts";
import * as ThreadHandlers from "./toolkits/thread/handlers.ts";
import * as ThreadMetadataMcpService from "./ThreadMetadataMcpService.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as OrchestratorHandlers from "./toolkits/orchestrator/handlers.ts";
import { OrchestratorToolkit } from "./toolkits/orchestrator/tools.ts";
import * as WorktreeHandlers from "./toolkits/worktree/handlers.ts";
import { WorktreeToolkit } from "./toolkits/worktree/tools.ts";
import * as WorktreeMcpService from "./WorktreeMcpService.ts";
import * as PullRequestsHandlers from "./toolkits/pullRequests/handlers.ts";
import { PullRequestsToolkit } from "./toolkits/pullRequests/tools.ts";
import { requestUrl } from "../requestUrl.ts";

const mcpResourceMetadataUrl = (request: HttpServerRequest.HttpServerRequest) =>
  requestUrl(request).pipe(
    Option.map((url) => `${url.origin}/.well-known/oauth-protected-resource/mcp`),
  );

/** Launched agents cannot open OAuth browsers; OAuth would mint credentials outliving their session. */
const unauthorized = (input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly presentedToken: boolean;
  readonly offerOAuth: boolean;
}) => {
  const metadataUrl = input.offerOAuth
    ? Option.getOrUndefined(mcpResourceMetadataUrl(input.request))
    : undefined;
  const challenge = [
    "Bearer",
    [
      ...(metadataUrl === undefined ? [] : [`resource_metadata="${metadataUrl}"`]),
      ...(input.presentedToken ? ['error="invalid_token"'] : []),
    ].join(", "),
  ]
    .filter((part) => part.length > 0)
    .join(" ");
  return HttpServerResponse.jsonUnsafe(
    {
      error: "invalid_mcp_credential",
      message: "A valid Codenine MCP credential is required.",
    },
    {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "www-authenticate": challenge,
      },
    },
  );
};

export class McpClientAuthenticator extends Context.Service<
  McpClientAuthenticator,
  {
    readonly authenticate: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<McpInvocationContext.McpInvocationScope | undefined>;
  }
>()("codenine/mcp/McpHttpServer/McpClientAuthenticator") {}

type AuthenticatedHttpEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  McpInvocationContext.McpInvocationContext
>;

type McpAuthMiddleware = (
  httpEffect: AuthenticatedHttpEffect,
) => Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  HttpServerRequest.HttpServerRequest
>;

const normalizeMcpHttpResponse = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse => {
  const bodyIsEmpty =
    response.body._tag === "Empty" ||
    (response.body._tag === "Uint8Array" && response.body.contentLength === 0) ||
    (response.body._tag === "Raw" && response.body.contentLength === 0);
  return response.status === 200 && bodyIsEmpty
    ? HttpServerResponse.setStatus(response, 202)
    : response;
};

// Session tokens are `<payload>.<signature>`; registry tokens are a bare base64url secret.
const looksLikeProviderToken = (token: string) => token.length > 0 && !token.includes(".");

const decodeModeLimit = Schema.decodeUnknownOption(
  Schema.Struct({ runtimeMode: RuntimeMode, interactionMode: ProviderInteractionMode }),
);
const parseModeLimit = (value: string) => {
  const [runtimeMode, interactionMode, ...rest] = value.trim().split("/");
  return rest.length === 0 ? decodeModeLimit({ runtimeMode, interactionMode }) : Option.none();
};

const invalidModeLimit = HttpServerResponse.jsonUnsafe(
  {
    error: "invalid_mode_limit",
    message: "Codenine-Mode-Limit must be <runtimeMode>/<interactionMode>, e.g. auto/default.",
  },
  { status: 400, headers: { "cache-control": "no-store" } },
);

/** Applies a client's requested mode limit; undefined when the header is malformed. */
const withModeLimit = (
  invocation: McpInvocationContext.McpInvocationScope,
  request: HttpServerRequest.HttpServerRequest,
): McpInvocationContext.McpInvocationScope | undefined => {
  const header = request.headers[McpInvocationContext.MODE_LIMIT_HEADER];
  if (header === undefined || invocation.client === undefined) return invocation;
  const limit = parseModeLimit(header);
  return Option.isNone(limit)
    ? undefined
    : { ...invocation, client: { ...invocation.client, narrowedTo: limit.value } };
};

const makeMcpAuthMiddleware = Effect.gen(function* () {
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const clients = yield* Effect.serviceOption(McpClientAuthenticator);
  const authenticateRequest = Effect.fn("McpHttpServer.authenticateRequest")(function* (
    request: HttpServerRequest.HttpServerRequest,
  ) {
    const authorization = request.headers.authorization;
    const token = parseBearerToken(request) ?? "";
    const invocation =
      (yield* registry.resolve(token)) ??
      (Option.isSome(clients) && token.length > 0
        ? yield* clients.value.authenticate(request)
        : undefined);
    if (!invocation) {
      yield* Effect.logWarning("rejected MCP request with an unusable credential", {
        reason:
          authorization === undefined
            ? "missing_authorization_header"
            : authorization.split(" ", 1)[0]?.toLowerCase() !== "bearer"
              ? "unsupported_scheme"
              : token.length === 0
                ? "missing_bearer_token"
                : "unknown_or_expired_token",
      });
      return unauthorized({
        request,
        presentedToken: token.length > 0,
        offerOAuth: Option.isSome(clients) && !looksLikeProviderToken(token),
      });
    }
    return withModeLimit(invocation, request) ?? invalidModeLimit;
  });
  // Untraced: a span here would wrap the tool call; the HTTP server span already covers it.
  return Effect.fnUntraced(function* (httpEffect) {
    const admitted = yield* authenticateRequest(yield* HttpServerRequest.HttpServerRequest);
    if (HttpServerResponse.isHttpServerResponse(admitted)) return admitted;
    return yield* httpEffect.pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, admitted),
      Effect.map(normalizeMcpHttpResponse),
    );
  }) satisfies McpAuthMiddleware;
}).pipe(Effect.withSpan("McpHttpServer.makeAuthMiddleware"));

const layerMcpAuthMiddleware = HttpRouter.middleware<{
  provides: McpInvocationContext.McpInvocationContext;
}>()(makeMcpAuthMiddleware).layer;

/** Decode with the advertised JSON codec, which permits null for optional fields that the raw schema rejects. */
const decodeAsAdvertised = <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
): Toolkit.Toolkit<Tools> =>
  Toolkit.make(
    ...Object.values(toolkit.tools).map((tool) =>
      tool.setParameters(Schema.toCodecJson(tool.parametersSchema)),
    ),
  ) as unknown as Toolkit.Toolkit<Tools>;

/** Each tool call gets a span named for its tool; arguments stay out, as they carry prompts and IDs. */
const withToolSpans = Effect.fn("McpHttpServer.withToolSpans")(function* <A, E, R>(
  registration: Effect.Effect<A, E, R>,
) {
  const server = yield* McpServer.McpServer;
  const tracingServer = McpServer.McpServer.of({
    ...server,
    addTool: Effect.fn("McpServer.addTool")(function (options) {
      const name = options.tool.name;
      return server.addTool({
        ...options,
        // Never the current span: Toolkit.handle annotates that one with the raw arguments.
        handle: (payload) =>
          Effect.useSpan(
            `mcp.tool.${name}`,
            {
              attributes: {
                "rpc.system": "mcp",
                "rpc.method": "tools/call",
                "mcp.tool.name": name,
              },
            },
            () => options.handle(payload),
          ),
      });
    }),
  });
  return yield* registration.pipe(Effect.provideService(McpServer.McpServer, tracingServer));
});

/** `McpServer.registerToolkit` advertises the full codec schema; agents get the compact one. */
const withAdvertisedSchemas = Effect.fn("McpHttpServer.withAdvertisedSchemas")(function* <
  Tools extends Record<string, Tool.Any>,
  A,
  E,
  R,
>(toolkit: Toolkit.Toolkit<Tools>, registration: Effect.Effect<A, E, R>) {
  const server = yield* McpServer.McpServer;
  const tools: Record<string, Tool.Any> = toolkit.tools;
  const advertisingServer = McpServer.McpServer.of({
    ...server,
    addTool: Effect.fn("McpServer.addTool")(function (options) {
      const tool = tools[options.tool.name];
      return server.addTool(
        tool === undefined
          ? options
          : {
              ...options,
              tool: new McpSchema.Tool({
                ...options.tool,
                inputSchema: advertisedJsonSchema(tool),
              }),
            },
      );
    }),
  });
  return yield* registration.pipe(Effect.provideService(McpServer.McpServer, advertisingServer));
});

/** Hands each call the services its registration was built with; the request's own still win. */
const provideRegistrationServices = <Services>() =>
  McpServer.middleware<{ provides: Services }>()(
    Effect.map(
      Effect.context<Services>(),
      (services) => (effect) =>
        Effect.updateContext(effect, (request: Context.Context<never>) =>
          Context.merge(services, request),
        ),
    ),
  );

/**
 * Tools declare their handler services as request-level dependencies. Those
 * built with the server are provided here; `McpInvocationContext` is left to
 * the transport, whose auth middleware resolves it per request.
 */
export const toolkitRegistration = <Tools extends Record<string, Tool.Any>, EX, RX>(
  toolkit: Toolkit.Toolkit<Tools>,
  handlers: McpToolAccess.HandlersLayer<Tools, EX, RX>,
) =>
  Layer.effectDiscard(
    withToolSpans(
      withAdvertisedSchemas(toolkit, McpServer.registerToolkit(decodeAsAdvertised(toolkit))),
    ),
  ).pipe(
    Layer.provide(
      provideRegistrationServices<
        Exclude<Tool.Requirements<Tools[keyof Tools]>, McpInvocationContext.McpInvocationContext>
      >().layer,
    ),
    Layer.provide(McpServer.McpServer.layer),
    Layer.provide(McpToolAccess.HandlersLayer.layer(handlers)),
  );

export const layerOrchestratorToolkit = toolkitRegistration(
  OrchestratorToolkit,
  OrchestratorHandlers.layer,
).pipe(Layer.provide(OrchestratorMcpService.layer), Layer.provide(ThreadMetadataMcpService.layer));

export const layerThreadToolkit = toolkitRegistration(ThreadToolkit, ThreadHandlers.layer);

const layerWorktreeToolkitRegistration = toolkitRegistration(
  WorktreeToolkit,
  WorktreeHandlers.layer,
).pipe(Layer.provide(WorktreeMcpService.layer));

const layerEnvironmentToolkit = toolkitRegistration(
  EnvironmentToolkit,
  EnvironmentHandlers.layer,
).pipe(Layer.provide(ThreadCommandExecutor.layer));

const layerProjectRegistration = toolkitRegistration(ProjectToolkit, ProjectHandlers.layer);

export const layerAttachmentToolkit = toolkitRegistration(
  AttachmentToolkit,
  AttachmentHandlers.layer,
);

export const layerPullRequestsToolkit = toolkitRegistration(
  PullRequestsToolkit,
  PullRequestsHandlers.layer,
);

/**
 * `McpServer` for in-process calls, which provide `McpInvocationContext`
 * around `callTool` as the auth middleware does for each /mcp request.
 */
export const layerInProcessMcpServer = McpServer.middleware<{
  provides: McpInvocationContext.McpInvocationContext;
}>()(
  (effect) =>
    Effect.flatMap(
      Effect.serviceOption(McpInvocationContext.McpInvocationContext),
      Option.match({
        onNone: () => Effect.die("Provide McpInvocationContext around the in-process MCP call."),
        onSome: (scope) =>
          Effect.provideService(effect, McpInvocationContext.McpInvocationContext, scope),
      }),
    ),
  { global: true },
).pipe(Layer.provideMerge(McpServer.McpServer.layer));

export const layerMcpTransport = <RA, RE, RR>(registrations: Layer.Layer<RA, RE, RR>) =>
  McpServer.layerHttp({
    name: "Codenine",
    version: packageJson.version,
    path: "/mcp",
    protocols: [McpProtocol.v2025_06_18],
    allowSessionTermination: true,
    registrations,
  }).pipe(Layer.provide(layerMcpAuthMiddleware));

/** Every tool the Codenine MCP server advertises. AgentContextBudget.test.ts measures this set. */
export const layerTools = Layer.mergeAll(
  layerOrchestratorToolkit,
  layerThreadToolkit,
  layerAttachmentToolkit,
  layerProjectRegistration,
  layerEnvironmentToolkit,
  layerWorktreeToolkitRegistration,
  layerPullRequestsToolkit,
);

export const layer = layerMcpTransport(layerTools);
