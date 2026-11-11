import { isSshRemoteUrl } from "@codenine/shared/sourceControl";
import * as Cache from "effect/Cache";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import {
  PullRequestOperationError,
  PullRequestUnavailableError,
  type OrchestrationProjectShell,
  type ProjectId,
  type PullRequestActivity,
  type PullRequestDetail,
  type PullRequestDiffStat,
  type PullRequestInvalidateInput,
  type PullRequestReportStateInput,
  type PullRequestListInput,
  type PullRequestRef,
  type PullRequestRoutingResult,
  type PullRequestRoutingIdentityInput,
  type PullRequestRoutingIdentityResult,
  type PullRequestState,
  PullRequestStack,
  PullRequestSummary,
  type PullRequestThreadCommentsInput,
  type PullRequestThreadCommentsResult,
  type SourceControlProviderInfo,
  SourceControlProviderKind,
  type ThreadPullRequestKey,
} from "@codenine/contracts";
import { sourceControlDefinitions } from "../sourceControl/sourceControlDefinitions.ts";

import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import type { SourceControlProviderContext } from "@codenine/source-control-core/server/SourceControlProvider";
import * as SourceControlRateLimit from "@codenine/source-control-core/server/SourceControlRateLimit";
import {
  type ProviderChangeRequestDetail,
  type ProviderChangeRequestSummary,
  type ProviderChangeRequestWatchFingerprint,
  type PullRequestProviderApi,
  PullRequestProviderError,
} from "@codenine/source-control-core/server/PullRequestProvider";
import * as PullRequestReadCache from "./PullRequestReadCache.ts";
import * as PullRequestProviderRegistry from "./PullRequestProviderRegistry.ts";

type PullRequestReading = Pick<
  PullRequestSummary,
  "state" | "isDraft" | "updatedAt" | "observedAt"
>;

function supersedesReading(current: PullRequestReading | undefined, next: PullRequestReading) {
  if (current === undefined) return true;
  if (current.state === "merged" && next.state !== "merged") return false;
  if (next.updatedAt !== current.updatedAt) return next.updatedAt > current.updatedAt;
  return (next.observedAt ?? -Infinity) >= (current.observedAt ?? -Infinity);
}

const REPOSITORY_CONCURRENCY = 12;

const DETAIL_CACHE_TTL = Duration.seconds(60);
const MERGED_DETAIL_CACHE_TTL = Duration.minutes(10);
const detailTimeToLive = (state: PullRequestState | undefined) =>
  state === "merged" ? MERGED_DETAIL_CACHE_TTL : DETAIL_CACHE_TTL;
const CHECKS_CACHE_TTL = Duration.seconds(15);
const REPORTED_STATE_DEDUPE_MS = 5 * 60 * 1_000;
const VIEWER_CACHE_TTL = Duration.minutes(10);
const STALE_DETAIL_WINDOW = Duration.minutes(10);
const isPullRequestProviderError = Schema.is(PullRequestProviderError);
const DETAIL_CACHE_CAPACITY = 128;
const VIEWER_CACHE_CAPACITY = 32;

export type PullRequestError = PullRequestUnavailableError | PullRequestOperationError;

const routingCredential = Context.Reference<{
  readonly credentialFingerprint: string;
  readonly viewer: string;
} | null>("codenine/PullRequestService/routingCredential", { defaultValue: () => null });
const credentialNamespace = Symbol("pullRequestCredentialNamespace");
type CredentialRef = PullRequestRef & { readonly [credentialNamespace]?: string };

export class PullRequestService extends Context.Service<
  PullRequestService,
  {
    readonly routing: (
      input: PullRequestRef,
    ) => Effect.Effect<PullRequestRoutingResult, PullRequestError>;
    readonly routingIdentity: (
      input: PullRequestRoutingIdentityInput,
    ) => Effect.Effect<PullRequestRoutingIdentityResult, PullRequestError>;
    readonly withRoutingCredential: <A, E, R>(
      input: PullRequestRef,
      operation: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E | PullRequestError, R>;
    readonly summary: (
      input: PullRequestRef,
      options?: { readonly recoverTransientFailure?: boolean },
    ) => Effect.Effect<PullRequestSummary, PullRequestError>;
    readonly stack: (
      input: PullRequestRef,
      options?: { readonly includeDetails?: boolean },
    ) => Effect.Effect<PullRequestStack | null, PullRequestError>;
    readonly subscribeStateChanges: Effect.Effect<
      Stream.Stream<ThreadPullRequestKey>,
      never,
      Scope.Scope
    >;
    readonly reportState: (
      input: PullRequestReportStateInput,
    ) => Effect.Effect<void, PullRequestError>;
    readonly subscribeRefreshes: Stream.Stream<number>;
    readonly refreshAfterTurn: (projectId: ProjectId) => Effect.Effect<void>;
    /** Project and remote lookups inside `effect` read once per filter, e.g. across one sync sweep. */
    readonly withSharedProjectReads: <A, E, R>(
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    readonly detail: (input: PullRequestRef) => Effect.Effect<PullRequestDetail, PullRequestError>;
    readonly watchFingerprint: (
      input: PullRequestRef,
    ) => Effect.Effect<ProviderChangeRequestWatchFingerprint | null, PullRequestError>;
    readonly activity: (
      input: PullRequestRef,
    ) => Effect.Effect<PullRequestActivity, PullRequestError>;
    readonly threadComments: (
      input: PullRequestThreadCommentsInput,
    ) => Effect.Effect<PullRequestThreadCommentsResult, PullRequestError>;
    readonly invalidate: (
      input: PullRequestInvalidateInput,
      options?: { readonly notifyReaders?: boolean },
    ) => Effect.Effect<void>;
  }
>()("codenine/pullRequest/PullRequestService") {}

export interface SupportedProject {
  readonly cursorKey: string;
  readonly project: OrchestrationProjectShell;
  readonly api: PullRequestProviderApi;
  readonly repository: string;
  readonly host: string;
  /** Unlike Azure repository names, remotes are unique across an organization. */
  readonly remote: string;
  readonly repositoryKey: string | null;
}

interface WorkspaceProjects {
  readonly supported: ReadonlyArray<SupportedProject>;
  readonly unimplemented: ReadonlyMap<
    string,
    { readonly kind: SourceControlProviderKind; readonly projectCount: number }
  >;
  readonly viewerRoots: ReadonlyMap<string, ReadonlyArray<string>>;
}

// Inherited by fibers forked inside the scope, so it is closed, not just dropped, when the scope ends.
const sharedProjectReads = Context.Reference<{
  open: boolean;
  readonly reads: Map<string, Effect.Effect<WorkspaceProjects, PullRequestError>>;
} | null>("codenine/PullRequestService/sharedProjectReads", { defaultValue: () => null });

function listCursorKey(host: string, repository: string): string {
  return `${host} ${repository.toLowerCase()}`;
}

function isProviderUnusable(error: PullRequestProviderError): boolean {
  return error.reason === "missing-tool" || error.reason === "unauthenticated";
}

type UnavailableRequirementOf = (
  kind: SourceControlProviderKind,
) => PullRequestProviderApi["unavailableRequirement"];

function unavailableRequirement(
  requirementOf: UnavailableRequirementOf,
  error: PullRequestProviderError,
): string | undefined {
  const requirement = requirementOf(error.provider);
  if (requirement === undefined) return undefined;
  return error.reason === "missing-tool" ? requirement.missing : requirement.unauthenticated;
}

function toPullRequestErrorWith(
  requirementOf: UnavailableRequirementOf,
): (operation: string) => (error: PullRequestProviderError) => PullRequestError {
  return (operation) => (error) => {
    if (isProviderUnusable(error)) {
      const requirement = unavailableRequirement(requirementOf, error);
      return new PullRequestUnavailableError({
        reason: error.reason === "missing-tool" ? "cli-missing" : "cli-unauthenticated",
        provider: error.provider,
        ...(requirement === undefined ? {} : { requirement }),
        cause: error,
      });
    }
    return new PullRequestOperationError({
      operation,
      detail: error.detail,
      ...(error.reason === "not-found" ? { reason: "not-found" as const } : {}),
      cause: error,
    });
  };
}

function withRateLimitBackoff(
  api: PullRequestProviderApi,
  host: string,
  limits: SourceControlRateLimit.SourceControlRateLimit["Service"],
  options?: { readonly viewerAllowsPause: boolean },
): PullRequestProviderApi {
  const key = { provider: api.kind, host };
  const protect = <A>(
    operation: string,
    effect: Effect.Effect<A, PullRequestProviderError>,
    allowPaused: boolean,
  ) =>
    limits.check(key, allowPaused ? { allowPaused: true } : undefined).pipe(
      Effect.mapError(
        (error) =>
          new PullRequestProviderError({
            provider: api.kind,
            operation,
            reason: "rate-limited",
            detail: error.detail,
            retryAt: error.retryAt,
            cause: error,
          }),
      ),
      Effect.flatMap((lease) =>
        effect.pipe(
          Effect.provideService(SourceControlRateLimit.Interactive, allowPaused),
          Effect.tap(() => limits.recordSuccess({ ...key, lease })),
          Effect.tapError((error) =>
            error.reason === "rate-limited"
              ? limits.recordRateLimit({
                  ...key,
                  lease,
                  ...(error.retryAt === undefined ? {} : { retryAt: error.retryAt }),
                })
              : Effect.void,
          ),
        ),
      ),
    );
  const wrap =
    <Args extends ReadonlyArray<unknown>, A>(
      operation: string,
      call: (...args: Args) => Effect.Effect<A, PullRequestProviderError>,
      allowPaused = false,
    ) =>
    (...args: Args) =>
      protect(operation, call(...args), allowPaused);
  const interactive = <Args extends ReadonlyArray<unknown>, A>(
    operation: string,
    call: (...args: Args) => Effect.Effect<A, PullRequestProviderError>,
  ) => wrap(operation, call, true);

  const wrapped = {
    kind: api.kind,
    capabilities: api.capabilities,
    ...(api.mergeMessageRewrite === undefined
      ? {}
      : { mergeMessageRewrite: api.mergeMessageRewrite }),
    ...(api.unavailableRequirement === undefined
      ? {}
      : { unavailableRequirement: api.unavailableRequirement }),
    ...(api.repositoryKey === undefined ? {} : { repositoryKey: api.repositoryKey }),
    ...(api.servesHost === undefined ? {} : { servesHost: api.servesHost }),
    ...(api.readsPublicHostWithoutCheckout === undefined
      ? {}
      : { readsPublicHostWithoutCheckout: api.readsPublicHostWithoutCheckout }),
    getViewer:
      options?.viewerAllowsPause === true
        ? interactive("getViewer", api.getViewer)
        : wrap("getViewer", api.getViewer),
    ...(api.getRoutingIdentity === undefined ? {} : { getRoutingIdentity: api.getRoutingIdentity }),
    ...(api.withVerifiedCredential === undefined
      ? {}
      : { withVerifiedCredential: api.withVerifiedCredential }),
    listChangeRequests: wrap("listChangeRequests", api.listChangeRequests),
    ...(api.listChangeRequestsAcross === undefined
      ? {}
      : {
          listChangeRequestsAcross: wrap("listChangeRequestsAcross", api.listChangeRequestsAcross),
        }),
    ...(api.listChangeRequestStats === undefined
      ? {}
      : {
          listChangeRequestStats: wrap("listChangeRequestStats", api.listChangeRequestStats),
        }),
    getChangeRequest: wrap("getChangeRequest", api.getChangeRequest),
    ...(api.forgetChangeRequestReads === undefined
      ? {}
      : { forgetChangeRequestReads: api.forgetChangeRequestReads }),
    ...(api.getChangeRequestPreview === undefined
      ? {}
      : { getChangeRequestPreview: wrap("getChangeRequestPreview", api.getChangeRequestPreview) }),
    ...(api.getChangeRequestChecks === undefined
      ? {}
      : { getChangeRequestChecks: wrap("getChangeRequestChecks", api.getChangeRequestChecks) }),
    ...(api.getChangeRequestSummary === undefined
      ? {}
      : {
          getChangeRequestSummary: wrap("getChangeRequestSummary", api.getChangeRequestSummary),
        }),
    ...(api.getChangeRequestStack === undefined
      ? {}
      : { getChangeRequestStack: wrap("getChangeRequestStack", api.getChangeRequestStack) }),
    ...(api.getChangeRequestWatchFingerprint === undefined
      ? {}
      : {
          getChangeRequestWatchFingerprint: wrap(
            "getChangeRequestWatchFingerprint",
            api.getChangeRequestWatchFingerprint,
          ),
        }),
    getChangeRequestActivity: wrap("getChangeRequestActivity", api.getChangeRequestActivity),
    ...(api.getReviewThreadComments === undefined
      ? {}
      : {
          getReviewThreadComments: wrap("getReviewThreadComments", api.getReviewThreadComments),
        }),
    getViewerPermissions: interactive("getViewerPermissions", api.getViewerPermissions),
    getDiff: wrap("getDiff", api.getDiff),
    ...(api.getDiffFilePaths === undefined
      ? {}
      : { getDiffFilePaths: wrap("getDiffFilePaths", api.getDiffFilePaths) }),
    ...(api.getDiffFileContents === undefined
      ? {}
      : { getDiffFileContents: wrap("getDiffFileContents", api.getDiffFileContents) }),
    ...(api.getFilesViewed === undefined
      ? {}
      : { getFilesViewed: wrap("getFilesViewed", api.getFilesViewed) }),
    ...(api.getFileStats === undefined
      ? {}
      : { getFileStats: wrap("getFileStats", api.getFileStats) }),
    ...(api.setFilesViewed === undefined
      ? {}
      : { setFilesViewed: interactive("setFilesViewed", api.setFilesViewed) }),
    ...(api.getFileRevisions === undefined
      ? {}
      : { getFileRevisions: wrap("getFileRevisions", api.getFileRevisions) }),
    runAction: interactive("runAction", api.runAction),
    ...(api.updateChangeRequest === undefined
      ? {}
      : {
          updateChangeRequest: interactive("updateChangeRequest", api.updateChangeRequest),
        }),
    comment: interactive("comment", api.comment),
    ...(api.updateComment === undefined
      ? {}
      : { updateComment: interactive("updateComment", api.updateComment) }),
    submitReview: interactive("submitReview", api.submitReview),
    listReviewerCandidates: interactive("listReviewerCandidates", api.listReviewerCandidates),
    setReviewerRequest: interactive("setReviewerRequest", api.setReviewerRequest),
    ...(api.listLabelCandidates === undefined
      ? {}
      : { listLabelCandidates: interactive("listLabelCandidates", api.listLabelCandidates) }),
    ...(api.setLabels === undefined ? {} : { setLabels: interactive("setLabels", api.setLabels) }),
    ...(api.listRepositoryLabels === undefined
      ? {}
      : { listRepositoryLabels: interactive("listRepositoryLabels", api.listRepositoryLabels) }),
    ...(api.searchRepositoryAuthors === undefined
      ? {}
      : {
          searchRepositoryAuthors: interactive(
            "searchRepositoryAuthors",
            api.searchRepositoryAuthors,
          ),
        }),
    ...(api.searchRepositoryReferences === undefined
      ? {}
      : {
          searchRepositoryReferences: interactive(
            "searchRepositoryReferences",
            api.searchRepositoryReferences,
          ),
        }),
    replyToThread: interactive("replyToThread", api.replyToThread),
    setReaction: interactive("setReaction", api.setReaction),
    setThreadResolution: interactive("setThreadResolution", api.setThreadResolution),
  };
  // Optional provider methods must be forwarded too; returning the interface alone permits omissions.
  return wrapped satisfies PullRequestProviderApi &
    Record<Exclude<keyof PullRequestProviderApi, keyof typeof wrapped>, never>;
}

const remoteHostKey = (recognized: SourceControlProviderInfo, remoteUrl: string) =>
  `${recognized.baseUrl}\n${isSshRemoteUrl(remoteUrl) ? "ssh" : "web"}`;

/** An HTTP remote names its server's web host, port included. */
function httpRemoteHost(remoteUrl: string): string | null {
  try {
    const remote = new URL(remoteUrl);
    return remote.protocol === "http:" || remote.protocol === "https:"
      ? remote.host.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

// Capture before the provider read so a slow response keeps its original freshness through caches.
const observeRead = Effect.fnUntraced(function* <A, E, R>(read: Effect.Effect<A, E, R>) {
  const observedAt = yield* Clock.currentTimeMillis;
  return { value: yield* read, observedAt };
});

export const make = Effect.gen(function* () {
  const stateChanges = yield* PubSub.sliding<ThreadPullRequestKey>(64);
  const pullRequestRefreshes = yield* SubscriptionRef.make(0);
  const registry = yield* PullRequestProviderRegistry.PullRequestProviderRegistry;
  const requirementOf: UnavailableRequirementOf = (kind) =>
    registry.get(kind)?.unavailableRequirement;
  const toPullRequestError = toPullRequestErrorWith(requirementOf);
  const projects = yield* ProjectService.ProjectService;
  const repositoryIdentities = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  const sourceControlProviders = yield* SourceControlProviderRegistry.SourceControlProviderRegistry;
  const rateLimits = yield* SourceControlRateLimit.SourceControlRateLimit;
  const readCache = yield* PullRequestReadCache.PullRequestReadCache;

  /**
   * Where each project's remote is served from, by the remote's recognised base URL: a remote no
   * definition placed is identified by the hosting CLIs, and a host whose remotes may not name
   * its web server says which one does. One project per base URL and transport answers for all
   * of them.
   */
  const resolveRemoteHosts = Effect.fn("PullRequestService.resolveRemoteHosts")(function* (
    projects: ReadonlyArray<OrchestrationProjectShell>,
    filter: Pick<PullRequestListInput, "projectId" | "host">,
  ) {
    type Candidate = {
      readonly project: OrchestrationProjectShell;
      readonly context: SourceControlProviderContext;
    };
    const candidatesByKey = new Map<string, Candidate[]>();
    for (const project of projects) {
      if (filter.projectId !== undefined && project.id !== filter.projectId) continue;
      const identity = project.repositoryIdentity;
      if (
        !identity ||
        identity.provider === undefined ||
        sourceControlDefinitions.repositorySelector(identity) === null
      )
        continue;
      if (identity.provider !== "unknown") {
        const provider = yield* sourceControlProviders
          .get(identity.provider)
          .pipe(Effect.orElseSucceed(() => null));
        if (provider?.resolveRemoteWebHost === undefined) continue;
      }
      const host = sourceControlDefinitions.changeRequestHost(identity, "unknown");
      if (
        filter.host !== undefined &&
        host !== "unknown" &&
        host !== filter.host.toLowerCase() &&
        httpRemoteHost(identity.locator.remoteUrl) !== filter.host.toLowerCase() &&
        !isSshRemoteUrl(identity.locator.remoteUrl)
      ) {
        continue;
      }
      const { remoteName, remoteUrl } = identity.locator;
      const recognized = sourceControlDefinitions.recognizeRemote(remoteUrl);
      if (recognized === null) continue;
      const candidate = {
        project,
        context: {
          provider:
            identity.provider === "unknown"
              ? recognized
              : { ...recognized, kind: identity.provider },
          remoteName,
          remoteUrl,
          ...(filter.host !== undefined && isSshRemoteUrl(remoteUrl)
            ? { requestedHost: filter.host }
            : {}),
        },
      };
      const key = remoteHostKey(recognized, remoteUrl);
      const candidates = candidatesByKey.get(key);
      if (candidates === undefined) candidatesByKey.set(key, [candidate]);
      else candidates.push(candidate);
    }

    const resolveContext = (input: {
      readonly cwd: string;
      readonly context: SourceControlProviderContext;
    }) => sourceControlProviders.resolveHandle(input).pipe(Effect.map((handle) => handle.context));
    type RemoteHost = { readonly kind: SourceControlProviderKind; readonly host: string | null };
    const resolveCandidate = ({ project, context }: Candidate) =>
      (context.provider.kind === "unknown"
        ? resolveContext({ cwd: project.workspaceRoot, context }).pipe(
            Effect.map((resolved) =>
              resolved === null || resolved.provider.kind === "unknown"
                ? null
                : { context: resolved, discovered: true },
            ),
          )
        : Effect.succeed({ context, discovered: false })
      ).pipe(
        Effect.flatMap((found) =>
          found === null
            ? Effect.succeed(null)
            : sourceControlProviders.get(found.context.provider.kind).pipe(
                Effect.flatMap(
                  (provider) =>
                    provider.resolveRemoteWebHost?.({
                      cwd: project.workspaceRoot,
                      context: found.context,
                      // A remote discovery just placed is not looked up a second time.
                      resolveContext: found.discovered
                        ? () => Effect.succeed(found.context)
                        : resolveContext,
                    }) ?? Effect.succeed(null),
                ),
                Effect.orElseSucceed(() => null),
                Effect.map((host): RemoteHost => ({ kind: found.context.provider.kind, host })),
              ),
        ),
        Effect.orElseSucceed(() => null),
      );

    // An SSH remote whose web host one checkout could not name may be named by the next; a
    // kind found without a host still stands if none can.
    const resolveKey = Effect.fn("PullRequestService.resolveRemoteHost")(function* (
      candidates: ReadonlyArray<Candidate>,
    ) {
      let fallback: RemoteHost | null = null;
      for (const candidate of candidates) {
        const resolved = yield* resolveCandidate(candidate);
        if (resolved === null) continue;
        if (resolved.host !== null || !isSshRemoteUrl(candidate.context.remoteUrl)) {
          return resolved;
        }
        fallback ??= resolved;
      }
      return fallback;
    });

    return yield* Effect.forEach(
      candidatesByKey,
      ([key, candidates]) =>
        resolveKey(candidates).pipe(Effect.map((resolved) => [key, resolved] as const)),
      { concurrency: REPOSITORY_CONCURRENCY },
    ).pipe(Effect.map((resolved) => new Map(resolved)));
  });

  const listWorkspaceProjects = (
    filter: Pick<PullRequestListInput, "projectId" | "projectIds" | "host">,
  ): Effect.Effect<WorkspaceProjects, PullRequestError> =>
    Effect.flatMap(sharedProjectReads, (shared) => {
      if (shared === null || !shared.open) return readWorkspaceProjects(filter);
      const key = JSON.stringify([filter.projectId, filter.projectIds, filter.host]);
      const existing = shared.reads.get(key);
      if (existing !== undefined) return existing;
      return Effect.cached(readWorkspaceProjects(filter)).pipe(
        Effect.tap((read) => Effect.sync(() => shared.reads.set(key, read))),
        Effect.flatten,
      );
    });

  const withSharedProjectReads = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      const shared = { open: true, reads: new Map() };
      return effect.pipe(
        Effect.provideService(sharedProjectReads, shared),
        Effect.ensuring(
          Effect.sync(() => {
            shared.open = false;
            shared.reads.clear();
          }),
        ),
      );
    });

  const readWorkspaceProjects = (
    filter: Pick<PullRequestListInput, "projectId" | "projectIds" | "host">,
  ): Effect.Effect<WorkspaceProjects, PullRequestError> =>
    (filter.projectId === undefined
      ? projects.listShells(
          filter.projectIds === undefined ? undefined : { projectIds: filter.projectIds },
        )
      : projects.getShell(filter.projectId).pipe(Effect.map(Option.toArray))
    ).pipe(
      Effect.mapError(
        (error) =>
          new PullRequestOperationError({
            operation: "listProjects",
            detail: "The project list could not be read.",
            cause: error,
          }),
      ),
      Effect.flatMap((projects) =>
        Effect.forEach(
          projects,
          (project) =>
            project.repositoryIdentity != null
              ? Effect.succeed(project)
              : repositoryIdentities
                  .resolve(project.workspaceRoot)
                  .pipe(Effect.map((repositoryIdentity) => ({ ...project, repositoryIdentity }))),
          { concurrency: REPOSITORY_CONCURRENCY },
        ),
      ),
      Effect.flatMap((projects) =>
        resolveRemoteHosts(projects, filter).pipe(
          Effect.map((remoteHosts) => ({ remoteHosts, projects })),
        ),
      ),
      Effect.map(({ remoteHosts, projects }) => {
        const supported: SupportedProject[] = [];
        const unimplemented = new Map<
          string,
          { kind: SourceControlProviderKind; projectCount: number }
        >();
        const viewerRoots = new Map<string, string[]>();
        const seen = new Set<string>();
        for (const project of projects) {
          if (filter.projectId !== undefined && project.id !== filter.projectId) continue;
          if (filter.projectIds !== undefined && !filter.projectIds.includes(project.id)) continue;
          const identity = project.repositoryIdentity;
          let kind = identity?.provider;
          const repository = sourceControlDefinitions.repositorySelector(
            project.repositoryIdentity,
          );
          if (!identity || kind === undefined || repository === null) continue;
          const recognized = sourceControlDefinitions.recognizeRemote(identity.locator.remoteUrl);
          const remote =
            recognized === null
              ? undefined
              : remoteHosts.get(remoteHostKey(recognized, identity.locator.remoteUrl));
          kind = remote?.kind ?? kind;
          const host = remote?.host ?? sourceControlDefinitions.changeRequestHost(identity, kind);
          if (filter.host !== undefined && host !== filter.host.toLowerCase()) {
            continue;
          }
          const registered = registry.get(kind);
          const api = registered?.servesHost?.(host) === false ? null : registered;
          if (api !== null) {
            const roots = viewerRoots.get(host);
            if (roots === undefined) viewerRoots.set(host, [project.workspaceRoot]);
            else if (!roots.includes(project.workspaceRoot)) roots.push(project.workspaceRoot);
          }
          const repositoryKey =
            api?.repositoryKey?.({ canonicalKey: identity.canonicalKey }) ?? null;
          const key = listCursorKey(host, repositoryKey ?? repository);
          if (seen.has(key)) continue;
          seen.add(key);
          if (api === null) {
            const counted = unimplemented.get(host);
            if (counted === undefined) unimplemented.set(host, { kind, projectCount: 1 });
            else counted.projectCount += 1;
            continue;
          }
          supported.push({
            cursorKey: key,
            project,
            api: withRateLimitBackoff(api, host, rateLimits),
            repository,
            host,
            remote:
              repositoryKey ??
              sourceControlDefinitions.repositoryKeyFromRemote(`https://${host}/${repository}`),
            repositoryKey:
              repositoryKey === null
                ? null
                : sourceControlDefinitions.canonicalRepositoryKey(repositoryKey.toLowerCase()),
          });
        }
        return { supported, unimplemented, viewerRoots };
      }),
    );

  // Azure derives organization from the checkout; require the matching repository.
  const requireProject = (ref: PullRequestRef): Effect.Effect<SupportedProject, PullRequestError> =>
    listWorkspaceProjects({ projectId: ref.projectId }).pipe(
      Effect.flatMap(({ supported }): Effect.Effect<SupportedProject, PullRequestError> => {
        const own = supported[0];
        const repository = ref.repository.trim();
        const host = ref.host?.trim().toLowerCase();
        if (own !== undefined && own.repository.toLowerCase() === repository.toLowerCase()) {
          if (host === undefined || host === own.host) return Effect.succeed(own);
        }
        if (host === undefined) {
          if (own === undefined) {
            return Effect.fail(new PullRequestUnavailableError({ reason: "provider-unsupported" }));
          }
          return Effect.fail(
            new PullRequestOperationError({
              operation: "resolveRepository",
              detail: "The change request does not belong to the selected project.",
            }),
          );
        }
        const referenceKey = `${host}/${repository}`.toLowerCase();
        const repositoryKey = sourceControlDefinitions.canonicalRepositoryKey(referenceKey);
        // A host that spells one repository several ways (Azure's SSH and legacy clone hosts)
        // can differ from the browser URL's host. Compare the complete repository identity
        // before narrowing those checkouts by host.
        return listWorkspaceProjects(
          sourceControlDefinitions.findByRepositoryKey(referenceKey) ? {} : { host },
        ).pipe(
          Effect.flatMap(({ supported }) => {
            const onHost = supported.filter((candidate) => candidate.host === host);
            const route =
              supported.find(
                (candidate) =>
                  candidate.repositoryKey !== null && candidate.repositoryKey === repositoryKey,
              ) ??
              onHost.find(
                (candidate) =>
                  candidate.repositoryKey === null &&
                  candidate.repository.toLowerCase() === repository.toLowerCase(),
              ) ??
              onHost.find((candidate) => candidate.repositoryKey === null);
            if (route === undefined) {
              return Effect.gen(function* () {
                const publicHost = sourceControlDefinitions.findByPublicHost(host);
                const api = publicHost === undefined ? null : registry.get(publicHost.kind);
                if (api?.readsPublicHostWithoutCheckout) {
                  const selected = yield* projects.getShell(ref.projectId).pipe(
                    Effect.mapError(
                      (cause) =>
                        new PullRequestOperationError({
                          operation: "resolveRepository",
                          detail: "The selected project could not be read.",
                          cause,
                        }),
                    ),
                  );
                  if (Option.isSome(selected)) {
                    return {
                      cursorKey: listCursorKey(host, repository),
                      project: selected.value,
                      api: withRateLimitBackoff(api, host, rateLimits),
                      repository,
                      host,
                      remote: sourceControlDefinitions.repositoryKeyFromRemote(
                        `https://${host}/${repository}`,
                      ),
                      repositoryKey: null,
                    };
                  }
                }
                return yield* new PullRequestUnavailableError({ reason: "provider-unsupported" });
              });
            }
            return Effect.succeed(
              route.repositoryKey !== null ||
                route.repository.toLowerCase() === repository.toLowerCase()
                ? route
                : {
                    ...route,
                    repository,
                    remote: sourceControlDefinitions.repositoryKeyFromRemote(
                      `https://${host}/${repository}`,
                    ),
                  },
            );
          }),
        );
      }),
    );

  const canonicalRef = Effect.fn("PullRequestService.canonicalRef")(function* <
    I extends PullRequestRef,
  >(input: I) {
    const project = yield* requireProject(input);
    return {
      ...input,
      projectId: project.project.id,
      host: project.host,
      repository: project.repository,
    };
  });

  type ResolvedViewer = {
    readonly host: string;
    readonly kind: SourceControlProviderKind;
    readonly viewer: string | null;
    readonly error: PullRequestProviderError | null;
  };
  const viewersByHost = new Map<string, { readonly at: number; readonly result: ResolvedViewer }>();
  const viewerFlights = yield* Cache.makeWith(
    (key: string): Effect.Effect<ResolvedViewer> => {
      const [host, kind, roots] = JSON.parse(key) as [
        string,
        SourceControlProviderKind,
        ReadonlyArray<string>,
      ];
      const registered = registry.get(kind);
      if (registered === null) {
        return Effect.die(new Error(`Missing pull request provider: ${kind}`));
      }
      const api = withRateLimitBackoff(registered, host, rateLimits, { viewerAllowsPause: true });
      return Effect.firstSuccessOf(roots.map((cwd) => api.getViewer({ cwd, host }))).pipe(
        Effect.map((viewer) => ({
          host,
          kind,
          viewer: viewer as string | null,
          error: null as PullRequestProviderError | null,
        })),
        Effect.tap((result) =>
          Effect.map(Clock.currentTimeMillis, (at) => viewersByHost.set(host, { at, result })),
        ),
        Effect.catch((error) =>
          Effect.succeed({
            host,
            kind,
            viewer: null,
            error,
          }),
        ),
      );
    },
    {
      capacity: VIEWER_CACHE_CAPACITY,
      // Share cold-page lookups briefly; keep failures retryable.
      timeToLive: (exit) =>
        Exit.isSuccess(exit) && exit.value.error === null ? Duration.seconds(1) : Duration.zero,
    },
  );

  const resolveViewers = (
    projects: ReadonlyArray<SupportedProject>,
    viewerRoots: WorkspaceProjects["viewerRoots"],
    options?: { readonly allowPaused: boolean },
  ) =>
    Effect.forEach(
      [...new Set(projects.map(({ host }) => host))],
      (host) =>
        Effect.flatMap(Clock.currentTimeMillis, (now): Effect.Effect<ResolvedViewer> => {
          const held = viewersByHost.get(host);
          if (held !== undefined && now - held.at <= Duration.toMillis(VIEWER_CACHE_TTL)) {
            return Effect.succeed(held.result);
          }
          const forHost = projects.filter((project) => project.host === host);
          const api = forHost[0]!.api;
          // Include deduplicated checkouts too; one unreadable worktree must not mark the whole host signed out.
          const roots =
            viewerRoots.get(host) ?? forHost.map(({ project }) => project.workspaceRoot);
          const key = JSON.stringify([host, api.kind, [...new Set(roots)].sort()]);
          if (options?.allowPaused === true) return Cache.get(viewerFlights, key);
          // Check pauses outside the shared lookup so background reads cannot spawn repeated failing CLIs and extend the pause.
          return rateLimits.check({ provider: api.kind, host }).pipe(
            Effect.flatMap(() => Cache.get(viewerFlights, key)),
            Effect.catch((error) =>
              Effect.succeed<ResolvedViewer>({
                host,
                kind: api.kind,
                viewer: null,
                error: new PullRequestProviderError({
                  provider: api.kind,
                  operation: "getViewer",
                  reason: "rate-limited",
                  detail: error.detail,
                  retryAt: error.retryAt,
                  cause: error,
                }),
              }),
            ),
          );
        }),
      { concurrency: REPOSITORY_CONCURRENCY },
    );

  const viewerOf = (project: SupportedProject): Effect.Effect<string | null> =>
    routingCredential.pipe(
      Effect.flatMap((credential) =>
        credential !== null
          ? Effect.succeed(credential.viewer)
          : resolveViewers([project], new Map()).pipe(
              Effect.map(([resolved]) => resolved?.viewer ?? null),
            ),
      ),
    );

  const routingIdentity: PullRequestService["Service"]["routingIdentity"] = Effect.fn(
    "PullRequestService.routingIdentity",
  )(function* (input) {
    const host = input.host.toLowerCase();
    const { supported } = yield* listWorkspaceProjects({ host });
    const project = supported.find(
      (candidate) => registry.get(candidate.api.kind)?.getRoutingIdentity !== undefined,
    );
    const api = project === undefined ? null : registry.get(project.api.kind);
    if (project === undefined || api?.getRoutingIdentity === undefined) {
      return yield* new PullRequestUnavailableError({ reason: "provider-unsupported" });
    }
    const identity = yield* api
      .getRoutingIdentity({
        cwd: project.project.workspaceRoot,
        host,
      })
      .pipe(Effect.mapError(toPullRequestError("routeIdentity")));
    return { ...identity, host, provider: api.kind };
  });

  const withRoutingCredential: PullRequestService["Service"]["withRoutingCredential"] = Effect.fn(
    "PullRequestService.withRoutingCredential",
  )(function* (input, operation) {
    if (input.expectedAccountId === undefined) return yield* operation;
    const rejected = () =>
      new PullRequestOperationError({
        operation: "routeIdentity",
        detail: "The signed-in account could not be verified before starting the operation.",
      });
    const project = yield* requireProject(input).pipe(Effect.mapError(rejected));
    const api = registry.get(project.api.kind);
    if (
      api?.withVerifiedCredential === undefined ||
      input.host?.toLowerCase() !== project.host.toLowerCase()
    ) {
      return yield* rejected();
    }
    const result = yield* api
      .withVerifiedCredential(
        { cwd: project.project.workspaceRoot, host: project.host, repository: project.repository },
        (identity) =>
          identity.accountId === input.expectedAccountId
            ? operation.pipe(Effect.provideService(routingCredential, identity), Effect.result)
            : Effect.fail(rejected()),
      )
      .pipe(Effect.catchTags({ PullRequestProviderError: () => Effect.fail(rejected()) }));
    return yield* Effect.fromResult(result);
  });

  const routing = Effect.fn("PullRequestService.routing")(function* (input: PullRequestRef) {
    const project = yield* requireProject(input);
    const api = registry.get(project.api.kind);
    if (api?.getRoutingIdentity === undefined) {
      return yield* new PullRequestUnavailableError({ reason: "provider-unsupported" });
    }
    const identity = yield* api
      .getRoutingIdentity({
        cwd: project.project.workspaceRoot,
        host: project.host,
      })
      .pipe(Effect.mapError(toPullRequestError("routeIdentity")));
    if (!identity.viewer.trim() || !identity.accountId.trim()) {
      return yield* new PullRequestOperationError({
        operation: "routeIdentity",
        detail: "The signed-in account could not be verified.",
      });
    }
    return {
      host: project.host,
      provider: project.api.kind,
      ...identity,
      projectTitle: project.project.title,
      workspaceRoot: project.project.workspaceRoot,
    };
  });

  const toSummary = (
    project: SupportedProject,
    changeRequest: ProviderChangeRequestSummary | ProviderChangeRequestDetail,
    observedAt: number,
    reply = false,
  ): PullRequestSummary => ({
    provider: project.api.kind,
    projectId: project.project.id,
    repository: project.repository,
    number: changeRequest.number,
    title: changeRequest.title,
    url: changeRequest.url,
    state: changeRequest.state,
    headBranch: changeRequest.headBranch,
    baseBranch: changeRequest.baseBranch,
    // An action reply may not carry these, and null would erase a time a client already holds.
    ...(changeRequest.closedAt === undefined && reply
      ? {}
      : { closedAt: changeRequest.closedAt ?? null }),
    ...(changeRequest.mergedAt === undefined && reply
      ? {}
      : { mergedAt: changeRequest.mergedAt ?? null }),
    updatedAt: changeRequest.updatedAt,
    observedAt,
    ...(changeRequest.isDraft === undefined ? {} : { isDraft: changeRequest.isDraft }),
    ...(changeRequest.author === undefined ? {} : { author: changeRequest.author }),
    ...(changeRequest.additions === undefined ? {} : { additions: changeRequest.additions }),
    ...(changeRequest.deletions === undefined ? {} : { deletions: changeRequest.deletions }),
    ...(changeRequest.changedFiles === undefined
      ? {}
      : { changedFiles: changeRequest.changedFiles }),
    ...(changeRequest.reviewDecision === undefined
      ? {}
      : { reviewDecision: changeRequest.reviewDecision }),
    ...(changeRequest.checksState === undefined ? {} : { checksState: changeRequest.checksState }),
    ...(changeRequest.mergeability === undefined
      ? {}
      : { mergeability: changeRequest.mergeability }),
    ...(changeRequest.stack === undefined ? {} : { stack: changeRequest.stack }),
    ...(changeRequest.headSha?.trim() ? { headSha: changeRequest.headSha.trim() } : {}),
    ...(changeRequest.autoMergeEnabled === undefined
      ? {}
      : { autoMergeEnabled: changeRequest.autoMergeEnabled }),
    ...(changeRequest.autoMergeMethod === undefined
      ? {}
      : { autoMergeMethod: changeRequest.autoMergeMethod }),
  });

  const summaryUncached: PullRequestService["Service"]["summary"] = (input) =>
    requireProject(input).pipe(
      Effect.flatMap((project) => {
        const providerInput = {
          cwd: project.project.workspaceRoot,
          repository: project.repository,
          host: project.host,
          number: input.number,
        };
        const read: Effect.Effect<
          ProviderChangeRequestSummary | ProviderChangeRequestDetail,
          PullRequestProviderError
        > =
          project.api.getChangeRequestSummary === undefined
            ? project.api.getChangeRequest(providerInput)
            : project.api.getChangeRequestSummary(providerInput);
        return read.pipe(
          Effect.mapError(toPullRequestError("summary")),
          observeRead,
          Effect.map(({ value, observedAt }) => toSummary(project, value, observedAt)),
        );
      }),
    );

  const stackUncached: PullRequestService["Service"]["stack"] = (input, options) =>
    requireProject(input).pipe(
      Effect.flatMap((project) => {
        const read = project.api.getChangeRequestStack;
        if (read === undefined) return Effect.succeed(null);
        return read({
          cwd: project.project.workspaceRoot,
          repository: project.repository,
          host: project.host,
          number: input.number,
          includeDetails: options?.includeDetails !== false,
        }).pipe(
          Effect.mapError(toPullRequestError("stack")),
          Effect.map((stack): PullRequestStack | null =>
            stack === null
              ? null
              : {
                  id: stack.id,
                  number: stack.number,
                  url: stack.url,
                  base: stack.base,
                  layers: stack.layers.map((layer) => ({
                    ...layer,
                    number: layer.number,
                    headBranch: layer.headBranch,
                    state: layer.state,
                  })),
                },
          ),
        );
      }),
    );

  const detailUncached: PullRequestService["Service"]["detail"] = (input) =>
    requireProject(input).pipe(
      Effect.flatMap((project) =>
        Effect.all(
          [
            project.api
              .getChangeRequest({
                cwd: project.project.workspaceRoot,
                repository: project.repository,
                host: project.host,
                number: input.number,
              })
              .pipe(Effect.mapError(toPullRequestError("detail")), observeRead),
            viewerOf(project),
          ],
          { concurrency: 2 },
        ).pipe(
          Effect.map(([{ value: changeRequest, observedAt }, viewer]): PullRequestDetail => ({
            provider: project.api.kind,
            capabilities: project.api.capabilities,
            projectId: project.project.id,
            projectTitle: project.project.title,
            workspaceRoot: project.project.workspaceRoot,
            repository: project.repository,
            number: changeRequest.number,
            title: changeRequest.title,
            body: changeRequest.body,
            url: changeRequest.url,
            author: changeRequest.author,
            state: changeRequest.state,
            isDraft: changeRequest.isDraft,
            mergeability: changeRequest.mergeability,
            additions: changeRequest.additions,
            deletions: changeRequest.deletions,
            changedFiles: changeRequest.changedFiles,
            headBranch: changeRequest.headBranch,
            ...(changeRequest.headRepositoryNameWithOwner === undefined
              ? {}
              : { headRepositoryNameWithOwner: changeRequest.headRepositoryNameWithOwner }),
            ...(changeRequest.headSha ? { headSha: changeRequest.headSha } : {}),
            baseBranch: changeRequest.baseBranch,
            createdAt: changeRequest.createdAt,
            updatedAt: changeRequest.updatedAt,
            observedAt,
            mergedAt: changeRequest.mergedAt,
            closedAt: changeRequest.closedAt,
            reviewers: changeRequest.reviewers,
            labels: changeRequest.labels,
            checks: changeRequest.checks,
            mergeCapabilities: changeRequest.mergeCapabilities,
            viewerPermissions: changeRequest.viewerPermissions,
            ...(viewer === null || viewer.trim().length === 0 ? {} : { viewer }),
            ...(changeRequest.baseComparison === undefined
              ? {}
              : { baseComparison: changeRequest.baseComparison }),
            ...(changeRequest.behindBy === undefined ? {} : { behindBy: changeRequest.behindBy }),
            ...(changeRequest.autoMergeEnabled === undefined
              ? {}
              : { autoMergeEnabled: changeRequest.autoMergeEnabled }),
            ...(changeRequest.autoMergeMethod === undefined
              ? {}
              : { autoMergeMethod: changeRequest.autoMergeMethod }),
            ...(changeRequest.maintainerCanModify === undefined
              ? {}
              : { maintainerCanModify: changeRequest.maintainerCanModify }),
            ...(changeRequest.workflowApprovalsRequired === undefined
              ? {}
              : { workflowApprovalsRequired: changeRequest.workflowApprovalsRequired }),
          })),
        ),
      ),
    );

  const activityUncached: PullRequestService["Service"]["activity"] = (input) =>
    requireProject(input).pipe(
      Effect.flatMap((project) =>
        project.api
          .getChangeRequestActivity({
            cwd: project.project.workspaceRoot,
            repository: project.repository,
            host: project.host,
            number: input.number,
          })
          .pipe(
            Effect.mapError(toPullRequestError("activity")),
            Effect.map((activity): PullRequestActivity => ({
              ...(activity.author === undefined ? {} : { author: activity.author }),
              ...(activity.reviewers === undefined ? {} : { reviewers: activity.reviewers }),
              comments: activity.comments,
              commentCount: activity.commentCount,
              commentsTruncated: activity.commentsTruncated,
              ...(activity.reviewThreadsTruncated === undefined
                ? {}
                : { reviewThreadsTruncated: activity.reviewThreadsTruncated }),
              reviewThreads: activity.reviewThreads,
              commits: activity.commits,
              ...(activity.reactions === undefined ? {} : { reactions: activity.reactions }),
            })),
          ),
      ),
    );

  const threadComments: PullRequestService["Service"]["threadComments"] = (input) =>
    requireProject(input).pipe(
      Effect.flatMap(
        (project): Effect.Effect<PullRequestThreadCommentsResult, PullRequestError> => {
          const read = project.api.getReviewThreadComments;
          if (read === undefined) {
            return Effect.fail(
              new PullRequestOperationError({
                operation: "threadComments",
                detail: "This host does not page review thread comments.",
              }),
            );
          }
          return read({
            cwd: project.project.workspaceRoot,
            repository: project.repository,
            host: project.host,
            number: input.number,
            threadId: input.threadId,
            cursor: input.cursor,
          }).pipe(Effect.mapError(toPullRequestError("threadComments")));
        },
      ),
    );

  const context = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(context);

  const revalidate = <A, E>(read: Effect.Effect<A, E>) =>
    Effect.context<never>().pipe(
      Effect.flatMap((caller) =>
        Effect.sync(() => runFork(Effect.ignore(read).pipe(Effect.provideContext(caller)))),
      ),
    );

  const makeLastGoodRead = <A>(capacity: number) => {
    const held = new Map<string, { readonly at: number; readonly value: A }>();
    const record = (key: string, value: A) =>
      Effect.map(Clock.currentTimeMillis, (at) => {
        held.delete(key);
        if (held.size >= capacity) {
          const oldest = held.keys().next().value;
          if (oldest !== undefined) held.delete(oldest);
        }
        held.set(key, { at, value });
      });
    const read = (key: string, effect: Effect.Effect<A, PullRequestError>) =>
      effect.pipe(
        Effect.tap((value) => record(key, value)),
        Effect.catchTags({
          PullRequestOperationError: (error) => {
            if (!isPullRequestProviderError(error.cause)) {
              return Effect.fail(error);
            }
            const provider = error.cause;
            if (provider.reason !== "failed" && provider.reason !== "rate-limited") {
              return Effect.fail(error);
            }
            return Effect.flatMap(Clock.currentTimeMillis, (now) => {
              const snapshot = held.get(key);
              if (
                snapshot === undefined ||
                now - snapshot.at > Duration.toMillis(STALE_DETAIL_WINDOW)
              ) {
                return Effect.fail(error);
              }
              return Effect.logWarning("using recent pull request data after a failed refresh", {
                operation: error.operation,
                reason: provider.reason,
              }).pipe(Effect.as(snapshot.value));
            });
          },
        }),
      );
    const serveHeld = (key: string, effect: Effect.Effect<A, PullRequestError>) => {
      const snapshot = held.get(key);
      if (snapshot === undefined) return read(key, effect);
      return revalidate(read(key, effect)).pipe(Effect.as(snapshot.value));
    };
    return { peek: (key: string) => held.get(key)?.value, read, record, serveHeld };
  };
  const lastGoodSummary = makeLastGoodRead<PullRequestSummary>(DETAIL_CACHE_CAPACITY);
  const lastGoodDetail = makeLastGoodRead<PullRequestDetail>(DETAIL_CACHE_CAPACITY);

  // A shared monotonic counter prevents evicted scopes reusing epochs held by old entries.
  let epochCounter = 0;
  let listingsEpoch = 0;
  const refEpochs = new Map<string, number>();
  const projectEpochs = new Map<ProjectId, number>();
  let projectEpochFloor = 0;
  const REF_EPOCH_CAPACITY = 2_048;
  const refScope = (ref: PullRequestRef) =>
    JSON.stringify([
      ref.projectId,
      ref.host?.toLowerCase() ?? "",
      ref.repository.toLowerCase(),
      ref.number,
    ]);
  const mergedEpochs = new Map<string, number>();
  const refEpoch = (ref: PullRequestRef) => {
    const scope = refScope(ref);
    return Math.max(
      mergedEpochs.get(scope) ?? projectEpochs.get(ref.projectId) ?? projectEpochFloor,
      refEpochs.get(scope) ?? 0,
    );
  };
  const noteMerged = (ref: PullRequestRef) => {
    const scope = refScope(ref);
    if (mergedEpochs.has(scope)) return;
    if (mergedEpochs.size >= REF_EPOCH_CAPACITY) {
      const oldest = mergedEpochs.keys().next().value;
      if (oldest !== undefined) mergedEpochs.delete(oldest);
    }
    mergedEpochs.set(scope, projectEpochs.get(ref.projectId) ?? projectEpochFloor);
  };
  const refCacheKey = (ref: CredentialRef) =>
    JSON.stringify([
      refEpoch(ref),
      ref.projectId,
      ref.host?.toLowerCase() ?? null,
      ref.repository.toLowerCase(),
      ref.number,
      ref.expectedAccountId ?? null,
      ref[credentialNamespace] ?? null,
    ]);
  const refOfCacheKey = (key: string): PullRequestRef => {
    const [, projectId, host, repository, number, expectedAccountId, fingerprint] = JSON.parse(
      key,
    ) as [number, string, string | null, string, number, string | null, string | null];
    return {
      projectId,
      ...(host === null ? {} : { host }),
      ...(expectedAccountId === null ? {} : { expectedAccountId }),
      ...(fingerprint === null ? {} : { [credentialNamespace]: fingerprint }),
      repository,
      number,
    } as PullRequestRef;
  };
  const statsCacheKey = (key: string) => JSON.stringify([listingsEpoch, key]);
  const recentStats = new Map<
    string,
    { readonly at: number; readonly value: PullRequestDiffStat }
  >();
  const recordStats = (key: string, value: PullRequestDiffStat, at: number) => {
    recentStats.delete(key);
    recentStats.set(key, { at, value });
    if (recentStats.size > REF_EPOCH_CAPACITY) {
      const oldest = recentStats.keys().next().value;
      if (oldest !== undefined) recentStats.delete(oldest);
    }
  };
  const bumpEpoch = (epochs: Map<string, number>, ref: PullRequestRef) => {
    const scope = refScope(ref);
    if (!epochs.has(scope) && epochs.size >= REF_EPOCH_CAPACITY) {
      const oldest = epochs.keys().next().value;
      if (oldest !== undefined) epochs.delete(oldest);
    }
    epochs.set(scope, ++epochCounter);
  };
  const bumpRefEpoch = (ref: PullRequestRef) => bumpEpoch(refEpochs, ref);

  const persistedRead = Effect.fn("PullRequestService.persistedRead")(function* <A>(
    input: CredentialRef,
    operation: string,
    codec: Schema.Codec<A, string>,
    read: Effect.Effect<A, PullRequestError>,
  ) {
    const project = yield* requireProject(input);
    const key = [
      operation,
      project.api.kind,
      project.host.toLowerCase(),
      project.repository.toLowerCase(),
      project.project.id,
      project.project.workspaceRoot,
      String(input.number),
      input.expectedAccountId ?? "",
      input[credentialNamespace] ?? "",
    ]
      .map(encodeURIComponent)
      .join(":");
    const lookup = yield* Effect.cached(read);
    const encodedRead = lookup.pipe(
      Effect.flatMap((value) =>
        Schema.encodeEffect(codec)(value).pipe(
          Effect.mapError(
            (cause) =>
              new PullRequestOperationError({
                operation: "cache",
                detail: "Could not encode PR cache data.",
                cause,
              }),
          ),
        ),
      ),
    );
    const payload = yield* readCache.get(key, encodedRead, [
      `project:${input.projectId}`,
      refScope(input),
    ]);
    const decoded = yield* Schema.decodeEffect(codec)(payload).pipe(Effect.option);
    return Option.isSome(decoded) ? decoded.value : yield* lookup;
  });
  const summaryCodec = Schema.fromJsonString(PullRequestSummary);
  const stackCodec = Schema.fromJsonString(Schema.NullOr(PullRequestStack));

  const summary: PullRequestService["Service"]["summary"] = (input, options) => {
    const key = refCacheKey(input);
    const cached = persistedRead(input, "summary", summaryCodec, summaryUncached(input));
    const held = lastGoodSummary.peek(key);
    return held !== undefined &&
      input.allowStale !== false &&
      (options?.recoverTransientFailure !== false || held.state === "merged")
      ? Effect.succeed(held)
      : cached.pipe(
          Effect.tap((value) =>
            shouldReplaceHeldSummary(key, value) ? lastGoodSummary.record(key, value) : Effect.void,
          ),
        );
  };

  const stack: PullRequestService["Service"]["stack"] = (input, options) =>
    persistedRead(
      input,
      `stack:${options?.includeDetails !== false}`,
      stackCodec,
      stackUncached(input, options),
    );

  const watchFingerprintCache = yield* Cache.makeWith(
    (key: string) => {
      const input = refOfCacheKey(key);
      return requireProject(input).pipe(
        Effect.flatMap((project) =>
          project.api.getChangeRequestWatchFingerprint === undefined
            ? Effect.succeed(null)
            : project.api
                .getChangeRequestWatchFingerprint({
                  cwd: project.project.workspaceRoot,
                  repository: project.repository,
                  host: project.host,
                  number: input.number,
                })
                .pipe(Effect.mapError(toPullRequestError("watchFingerprint"))),
        ),
      );
    },
    {
      capacity: DETAIL_CACHE_CAPACITY,
      timeToLive: (exit) => (Exit.isSuccess(exit) ? CHECKS_CACHE_TTL : Duration.zero),
    },
  );

  const detailCache = yield* Cache.makeWith(
    (key: string) => {
      const statsKey = statsCacheKey(key);
      return detailUncached(refOfCacheKey(key)).pipe(
        Effect.tap(
          Effect.fn("PullRequestService.recordDetailStats")(function* (value: PullRequestDetail) {
            recordStats(
              statsKey,
              {
                projectId: value.projectId,
                repository: value.repository,
                number: value.number,
                additions: value.additions,
                deletions: value.deletions,
              },
              yield* Clock.currentTimeMillis,
            );
          }),
        ),
      );
    },
    {
      capacity: DETAIL_CACHE_CAPACITY,
      timeToLive: (exit) =>
        Exit.isSuccess(exit) ? detailTimeToLive(exit.value.state) : Duration.zero,
    },
  );
  const summaryFromDetail = (
    detail: PullRequestDetail,
    previous: PullRequestSummary | undefined,
  ): PullRequestSummary => ({
    // Detail does not carry review/check summaries. Keep the last summary observation.
    ...previous,
    provider: detail.provider,
    projectId: detail.projectId,
    repository: detail.repository,
    number: detail.number,
    title: detail.title,
    url: detail.url,
    state: detail.state,
    isDraft: detail.isDraft,
    author: detail.author,
    additions: detail.additions,
    deletions: detail.deletions,
    changedFiles: detail.changedFiles,
    mergeability: detail.mergeability,
    headBranch: detail.headBranch,
    baseBranch: detail.baseBranch,
    closedAt: detail.closedAt,
    mergedAt: detail.mergedAt,
    updatedAt: detail.updatedAt,
    observedAt: detail.observedAt,
  });
  const shouldReplaceHeldSummary = (key: string, next: PullRequestSummary) =>
    supersedesReading(lastGoodSummary.peek(key), next);
  // Keep newest detail states across epochs/credentials; summary reads would mask subsequent detail changes.
  const detailStates = new Map<string, PullRequestReading>();
  const noteDetailReading = (ref: PullRequestRef, next: PullRequestSummary) =>
    Effect.suspend(() => {
      const scope = refScope(ref);
      const current = detailStates.get(scope);
      if (!supersedesReading(current, next)) return Effect.void;
      detailStates.delete(scope);
      if (detailStates.size >= REF_EPOCH_CAPACITY) {
        const oldest = detailStates.keys().next().value;
        if (oldest !== undefined) detailStates.delete(oldest);
      }
      detailStates.set(scope, {
        state: next.state,
        isDraft: next.isDraft,
        updatedAt: next.updatedAt,
        observedAt: next.observedAt,
      });
      return (current?.state !== next.state || current?.isDraft !== next.isDraft) &&
        ref.host !== undefined
        ? PubSub.publish(stateChanges, {
            host: ref.host,
            repository: ref.repository,
            number: ref.number,
          })
        : Effect.void;
    });
  // Keep routed reports separate; unverified reports must not outrank this environment's reads.
  const reportedStates = new Map<
    string,
    {
      readonly state: PullRequestState;
      readonly isDraft: boolean | undefined;
      readonly atMs: number;
    }
  >();
  const reportState: PullRequestService["Service"]["reportState"] = ({
    reference,
    state,
    isDraft,
  }) =>
    Effect.all([canonicalRef(reference), Clock.currentTimeMillis]).pipe(
      Effect.flatMap(([ref, nowMs]) =>
        Effect.suspend(() => {
          const scope = refScope(ref);
          const reported = reportedStates.get(scope);
          if (
            reported?.state === state &&
            reported.isDraft === isDraft &&
            nowMs - reported.atMs < REPORTED_STATE_DEDUPE_MS
          )
            return Effect.void;
          reportedStates.delete(scope);
          if (reportedStates.size >= REF_EPOCH_CAPACITY) {
            const oldest = reportedStates.keys().next().value;
            if (oldest !== undefined) reportedStates.delete(oldest);
          }
          reportedStates.set(scope, { state, isDraft, atMs: nowMs });
          return ref.host === undefined
            ? Effect.void
            : PubSub.publish(stateChanges, {
                host: ref.host,
                repository: ref.repository,
                number: ref.number,
              });
        }),
      ),
    );
  const detail: PullRequestService["Service"]["detail"] = (input) => {
    const key = refCacheKey(input);
    // Skip reads older than strict summaries; caching them would preserve regressions without asking the host again.
    const read = Cache.get(detailCache, key).pipe(
      Effect.tap((value) => {
        if (value.state === "merged") noteMerged(input);
        const summary = summaryFromDetail(value, lastGoodSummary.peek(key));
        return noteDetailReading(input, summary).pipe(
          Effect.andThen(
            shouldReplaceHeldSummary(key, summary)
              ? lastGoodSummary.record(key, summary)
              : Effect.void,
          ),
        );
      }),
    );
    return input.allowStale === false
      ? read.pipe(Effect.tap((value) => lastGoodDetail.record(key, value)))
      : lastGoodDetail.serveHeld(key, read);
  };

  const activityCache = yield* Cache.makeWith(
    (key: string) => {
      return activityUncached(refOfCacheKey(key));
    },
    {
      capacity: DETAIL_CACHE_CAPACITY,
      timeToLive: (exit, key) =>
        Exit.isSuccess(exit) ? detailTimeToLive(lastGoodSummary.peek(key)?.state) : Duration.zero,
    },
  );

  const activity: PullRequestService["Service"]["activity"] = (input) => {
    const key = refCacheKey(input);
    return Cache.get(activityCache, key);
  };

  const forgetProviderReads = (scope?: { readonly repository: string; readonly number?: number }) =>
    Effect.forEach(
      registry.kinds,
      (kind) => registry.get(kind)?.forgetChangeRequestReads?.(scope) ?? Effect.void,
      { discard: true },
    );

  const invalidate: PullRequestService["Service"]["invalidate"] = Effect.fn(
    "PullRequestService.invalidate",
  )(function* (input, options) {
    const reference = input.reference;
    if (reference !== undefined) {
      yield* canonicalRef(reference).pipe(
        Effect.flatMap((ref) =>
          forgetProviderReads({ repository: ref.repository, number: ref.number }).pipe(
            Effect.andThen(readCache.invalidate(refScope(ref))),
            Effect.andThen(Effect.sync(() => bumpRefEpoch(ref))),
          ),
        ),
        Effect.ignore,
      );
    } else {
      yield* forgetProviderReads();
      listingsEpoch = ++epochCounter;
      viewersByHost.clear();
      yield* Cache.invalidateAll(viewerFlights);
    }
    if (options?.notifyReaders) {
      yield* SubscriptionRef.set(pullRequestRefreshes, ++epochCounter);
    }
  });

  const refreshAfterTurn: PullRequestService["Service"]["refreshAfterTurn"] = Effect.fn(
    "PullRequestService.refreshAfterTurn",
  )(function* (projectId) {
    // Everything the provider holds, not just the project's repository: a turn can touch a
    // change request reached through another repository, and no epoch may move until those
    // reads are gone, or a reader in between keeps the old one under the new epoch.
    yield* forgetProviderReads();
    listingsEpoch = ++epochCounter;
    projectEpochs.delete(projectId);
    if (projectEpochs.size >= REF_EPOCH_CAPACITY) {
      const oldest = projectEpochs.keys().next().value;
      if (oldest !== undefined) {
        projectEpochFloor = projectEpochs.get(oldest)!;
        projectEpochs.delete(oldest);
      }
    }
    projectEpochs.set(projectId, listingsEpoch);
    const epoch = listingsEpoch;
    yield* readCache.invalidate(`project:${projectId}`);
    yield* SubscriptionRef.set(pullRequestRefreshes, epoch);
  });

  const credentialCached =
    <I extends PullRequestRef, Args extends ReadonlyArray<unknown>, A, E>(
      read: (input: I, ...args: Args) => Effect.Effect<A, E>,
    ) =>
    (input: I, ...args: Args) =>
      Effect.gen(function* () {
        const ref = yield* canonicalRef(input);
        const credential = yield* routingCredential;
        return yield* read(
          credential === null
            ? ref
            : { ...ref, [credentialNamespace]: credential.credentialFingerprint },
          ...args,
        );
      });

  return PullRequestService.of({
    withSharedProjectReads,
    routing,
    routingIdentity,
    withRoutingCredential,
    summary: credentialCached(summary),
    stack: credentialCached(stack),
    subscribeStateChanges: PubSub.subscribe(stateChanges).pipe(
      Effect.map((subscription) => Stream.fromSubscription(subscription)),
    ),
    reportState,
    subscribeRefreshes: SubscriptionRef.changes(pullRequestRefreshes).pipe(
      Stream.filter((revision) => revision > 0),
    ),
    refreshAfterTurn,
    detail: credentialCached(detail),
    watchFingerprint: credentialCached((input) =>
      Cache.get(watchFingerprintCache, refCacheKey(input)),
    ),
    activity: credentialCached(activity),
    threadComments,
    invalidate,
  });
});

export const layer = Layer.effect(PullRequestService, make);
