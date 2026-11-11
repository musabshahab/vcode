import { SourceControlProviderKind } from "@codenine/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as KeyValueStore from "effect/persistence/KeyValueStore";
import { assert, expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import type { OrchestrationProjectShell, ProjectId } from "@codenine/contracts";
import { DEFAULT_SERVER_SETTINGS } from "@codenine/contracts/settings";
import type { ServerSettings } from "@codenine/contracts";
import * as ServerSettingsService from "../serverSettings.ts";
import { PullRequestOperationError } from "@codenine/contracts";

import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as SourceControlProviderRegistry from "../sourceControl/SourceControlProviderRegistry.ts";
import type { SourceControlProvider } from "@codenine/source-control-core/server/SourceControlProvider";
import { isSshRemoteUrl } from "@codenine/shared/sourceControl";
import * as SourceControlRateLimit from "@codenine/source-control-core/server/SourceControlRateLimit";
import { fakePullRequestProvider } from "@codenine/source-control-testing/fakeSourceControlDriver";
import {
  PullRequestProviderError,
  type ProviderChangeRequest,
  type PullRequestProviderApi,
} from "@codenine/source-control-core/server/PullRequestProvider";
import * as PullRequestProviderRegistry from "./PullRequestProviderRegistry.ts";
import * as PullRequestService from "./PullRequestService.ts";
import * as PullRequestReadCache from "./PullRequestReadCache.ts";

function project(input: {
  readonly id: string;
  readonly title: string;
  readonly workspaceRoot: string;
  readonly repository?: string;
  readonly provider?: string;
  readonly host?: string;
  readonly remoteUrl?: string;
}): OrchestrationProjectShell {
  const host = input.host ?? (input.provider === "gitlab" ? "gitlab.com" : "github.com");
  return {
    id: input.id as ProjectId,
    title: input.title,
    workspaceRoot: input.workspaceRoot,
    ...(input.repository
      ? {
          repositoryIdentity: {
            canonicalKey: `${host}/${input.repository}`,
            locator: {
              source: "git-remote" as const,
              remoteName: "origin",
              remoteUrl: input.remoteUrl ?? `https://${host}/${input.repository}.git`,
            },
            provider: SourceControlProviderKind.make(input.provider ?? "github"),
            displayName: input.repository,
          },
        }
      : {}),
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
  };
}

function changeRequest(number: number, updatedAt: string): ProviderChangeRequest {
  return {
    number,
    title: `Change request ${number}`,
    url: `https://host/pull/${number}`,
    author: { login: "octocat", name: null, avatarUrl: null },
    headBranch: `feat/${number}`,
    baseBranch: "main",
    state: "open",
    isDraft: false,
    mergeability: "mergeable",
    additions: 1,
    deletions: 0,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt,
    reviewRequestLogins: [],
    labels: [],
  };
}

function hostedChangeRequest(body: string, additions = 1) {
  return {
    ...changeRequest(1, "2026-07-02T00:00:00Z"),
    body,
    additions,
    changedFiles: 2,
    mergedAt: null,
    closedAt: null,
    reviewers: [],
    checks: [],
    mergeCapabilities: { merge: true, squash: true, rebase: true },
    viewerPermissions: {
      actions: ["merge"] as const,
      comment: true,
      resolve: true,
      verdicts: ["comment", "approve", "request-changes"] as const,
      requestReviewers: true,
    },
  };
}

/** A host whose SSH remotes name an alias, so discovery says which server serves them. */
const sshAliasHost = {
  resolveRemoteWebHost: ({ cwd, context, resolveContext }) =>
    isSshRemoteUrl(context.remoteUrl)
      ? resolveContext({
          cwd,
          context: {
            ...context,
            provider: { kind: SourceControlProviderKind.make("unknown"), name: "", baseUrl: "" },
          },
        }).pipe(
          Effect.map((resolved) =>
            resolved === null || resolved.provider.kind === "unknown"
              ? null
              : new URL(resolved.provider.baseUrl).host,
          ),
        )
      : Effect.succeed(null),
} as SourceControlProvider["Service"];

function makeService(input: {
  readonly settings?: ServerSettings;
  readonly projects: ReadonlyArray<OrchestrationProjectShell>;
  readonly providers: ReadonlyArray<PullRequestProviderApi>;
  readonly resolveHandle?: SourceControlProviderRegistry.SourceControlProviderRegistry["Service"]["resolveHandle"];
  readonly resolveRepositoryIdentity?: RepositoryIdentityResolver.RepositoryIdentityResolver["Service"]["resolve"];
  readonly onProjectRead?: () => void;
}) {
  // Build in the test scope; per-call Effect.provide would close the marks database on service acquisition.
  return Effect.flatMap(
    Layer.build(
      Layer.mergeAll(
        Layer.mock(ServerSettingsService.ServerSettingsService)({
          getSettings: Effect.succeed(input.settings ?? DEFAULT_SERVER_SETTINGS),
        }),
        Layer.succeed(
          PullRequestProviderRegistry.PullRequestProviderRegistry,
          PullRequestProviderRegistry.fromProviders(input.providers),
        ),
        Layer.mock(SourceControlProviderRegistry.SourceControlProviderRegistry)({
          resolveLink: () => undefined,
          resolveHandle:
            input.resolveHandle ?? (() => Effect.die("Unexpected provider refinement")),
          get: (kind) =>
            Effect.succeed(
              kind === "forgejo" ? sshAliasHost : ({} as SourceControlProvider["Service"]),
            ),
        }),
        Layer.mock(ProjectService.ProjectService)({
          listShells: (options) =>
            Effect.sync(() => {
              input.onProjectRead?.();
              return input.projects.filter(
                (project) => options?.projectIds?.includes(project.id) ?? true,
              );
            }),
          getShell: (projectId) =>
            Effect.sync(() => {
              input.onProjectRead?.();
              return Option.fromNullishOr(input.projects.find((p) => p.id === projectId));
            }),
        }),
        Layer.mock(RepositoryIdentityResolver.RepositoryIdentityResolver)({
          resolve: input.resolveRepositoryIdentity ?? (() => Effect.succeed(null)),
        }),
        SourceControlRateLimit.layer,
        Layer.effect(PullRequestReadCache.PullRequestReadCache, PullRequestReadCache.make).pipe(
          Layer.provide(KeyValueStore.layerMemory),
          Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
        ),
      ),
    ),
    (context) => Effect.provideContext(PullRequestService.make, context),
  );
}

it.effect("routing verifies the current account on the requested host without caching it", () =>
  Effect.gen(function* () {
    let viewer = "first-account";
    const service = yield* makeService({
      projects: [
        project({
          id: "p1",
          title: "web",
          workspaceRoot: "/a",
          repository: "acme/web",
          host: "github.example.test",
        }),
      ],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("github"), {
          getRoutingIdentity: (input) => {
            assert.deepStrictEqual(input, { cwd: "/a", host: "github.example.test" });
            return Effect.succeed({
              viewer,
              accountId: viewer === "first-account" ? "123" : "456",
            });
          },
        }),
      ],
    });
    const ref = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    assert.deepStrictEqual(yield* service.routing(ref), {
      host: "github.example.test",
      provider: SourceControlProviderKind.make("github"),
      viewer: "first-account",
      accountId: "123",
      projectTitle: "web",
      workspaceRoot: "/a",
    });
    viewer = "second-account";
    assert.strictEqual((yield* service.routing(ref)).viewer, "second-account");
    viewer = " ";
    const failure = yield* service.routing(ref).pipe(Effect.flip);
    assert.strictEqual(failure._tag, "PullRequestOperationError");
    if (failure._tag === "PullRequestOperationError") {
      assert.strictEqual(failure.operation, "routeIdentity");
    }
  }),
);

it.effect("rejects a different Forgejo HTTP port for an HTTP checkout", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      projects: [
        project({
          id: "http",
          title: "http",
          workspaceRoot: "/http",
          repository: "team/repo",
          provider: SourceControlProviderKind.make("forgejo"),
          host: "code.example",
          remoteUrl: "http://code.example:4000/team/repo.git",
        }),
      ],
      providers: [fakePullRequestProvider(SourceControlProviderKind.make("forgejo"))],
    });
    const failure = yield* service
      .summary(
        {
          projectId: "http" as ProjectId,
          host: "code.example:3000",
          repository: "team/repo",
          number: 42,
        },
        { recoverTransientFailure: false },
      )
      .pipe(Effect.flip);
    assert.strictEqual(failure._tag, "PullRequestUnavailableError");
  }),
);

it.effect("resolves a project's repository identity when its shell has none cached", () =>
  Effect.gen(function* () {
    const resolved = project({
      id: "web",
      title: "web",
      workspaceRoot: "/web",
      repository: "acme/web",
    });
    const service = yield* makeService({
      projects: [{ ...resolved, repositoryIdentity: null }],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("github"), {
          getChangeRequestSummary: () => Effect.succeed(changeRequest(7, "2026-07-02T00:00:00Z")),
        }),
      ],
      resolveRepositoryIdentity: () => Effect.succeed(resolved.repositoryIdentity ?? null),
    });

    const summary = yield* service.summary(
      { projectId: "web" as ProjectId, host: "github.com", repository: "acme/web", number: 7 },
      { recoverTransientFailure: false },
    );

    assert.strictEqual(summary.number, 7);
  }),
);

it.effect("routes a hosted reference to another repository through a project on that host", () =>
  Effect.gen(function* () {
    const seen: Array<{ cwd: string; repository: string; host: string }> = [];
    let projectReads = 0;
    const service = yield* makeService({
      onProjectRead: () => {
        projectReads += 1;
      },
      projects: [
        project({ id: "frontend", title: "web", workspaceRoot: "/web", repository: "acme/web" }),
      ],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("github"), {
          getChangeRequestSummary: (input) =>
            Effect.sync(() => {
              seen.push({ cwd: input.cwd, repository: input.repository, host: input.host });
              return changeRequest(7, "2026-07-02T00:00:00Z");
            }),
        }),
      ],
    });

    const summary = yield* service.summary(
      { projectId: "frontend" as ProjectId, host: "github.com", repository: "acme/api", number: 7 },
      { recoverTransientFailure: false },
    );

    assert.strictEqual(summary.number, 7);
    assert.deepStrictEqual(seen, [{ cwd: "/web", repository: "acme/api", host: "github.com" }]);

    // A sync sweep resolves the project once for all of its references, then reads fresh again.
    const readsPerReference = projectReads;
    const read = (number: number) =>
      service.summary(
        { projectId: "frontend" as ProjectId, host: "github.com", repository: "acme/api", number },
        { recoverTransientFailure: false },
      );
    assert.isAbove(readsPerReference, 2);
    yield* service.withSharedProjectReads(Effect.all([read(8), read(9), read(10)]));
    // One read of the project and one of the host's projects, for all three references.
    assert.strictEqual(projectReads, readsPerReference + 2);
    yield* read(11);
    assert.strictEqual(projectReads, readsPerReference * 2 + 2);
  }),
);

it.effect("prefers a matching checkout over a non-repository project's directory", () =>
  Effect.gen(function* () {
    const seen: string[] = [];
    const service = yield* makeService({
      projects: [
        project({ id: "inbox", title: "Inbox", workspaceRoot: "/home/alex" }),
        project({ id: "repo", title: "API", workspaceRoot: "/api", repository: "acme/api" }),
      ],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("github"), {
          getChangeRequestSummary: (input) =>
            Effect.sync(() => {
              seen.push(input.cwd);
              return changeRequest(7, "2026-07-02T00:00:00Z");
            }),
        }),
      ],
    });
    yield* service.summary(
      {
        projectId: "inbox" as ProjectId,
        host: "github.com",
        repository: "acme/api",
        number: 7,
      },
      { recoverTransientFailure: false },
    );
    assert.deepStrictEqual(seen, ["/api"]);
  }),
);

// regression: #17167 refresh linked PRs without a checkout
it.effect("requires an explicit host for a non-repository project's linked PR", () =>
  Effect.gen(function* () {
    const service = yield* makeService({
      projects: [project({ id: "inbox", title: "Inbox", workspaceRoot: "/home/alex" })],
      providers: [fakePullRequestProvider(SourceControlProviderKind.make("github"))],
    });
    const error = yield* service
      .summary(
        {
          projectId: "inbox" as ProjectId,
          repository: "acme/api",
          number: 7,
        },
        { recoverTransientFailure: false },
      )
      .pipe(Effect.flip);
    assert.strictEqual(error._tag, "PullRequestUnavailableError");
  }),
);

it.effect("does not revive old summaries when project epochs are evicted", () =>
  Effect.gen(function* () {
    let title = "old";
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("github"), {
          getChangeRequest: () => Effect.succeed({ ...hostedChangeRequest("body"), title }),
        }),
      ],
    });
    const ref = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    assert.strictEqual((yield* service.summary(ref))?.title, "old");
    title = "new";
    yield* service.refreshAfterTurn(ref.projectId);
    assert.strictEqual((yield* service.summary(ref))?.title, "new");
    for (let index = 0; index < 2048; index++)
      yield* service.refreshAfterTurn(`project-${index}` as ProjectId);
    assert.strictEqual((yield* service.summary(ref))?.title, "new");
  }),
);

it.effect("a refresh or a finished turn drops the provider's own change request reads", () =>
  Effect.gen(function* () {
    const forgotten: Array<{ readonly repository: string; readonly number?: number } | undefined> =
      [];
    const service = yield* makeService({
      projects: [
        project({
          id: "p1",
          title: "web",
          workspaceRoot: "/a",
          repository: "acme/web",
          provider: "gitlab",
        }),
      ],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("gitlab"), {
          forgetChangeRequestReads: (scope) => Effect.sync(() => void forgotten.push(scope)),
        }),
      ],
    });
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };

    yield* service.invalidate({ reference });
    yield* service.refreshAfterTurn(reference.projectId);
    yield* service.invalidate({});

    assert.deepStrictEqual(forgotten, [
      { repository: "acme/web", number: 1 },
      undefined,
      undefined,
    ]);
  }),
);

it.effect("a read during a refresh cannot keep the provider's old change request", () =>
  Effect.gen(function* () {
    let hostTitle = "old";
    let held: string | undefined;
    let gate:
      | { readonly entered: Deferred.Deferred<void>; readonly release: Deferred.Deferred<void> }
      | undefined;
    const service = yield* makeService({
      projects: [
        project({
          id: "p1",
          title: "web",
          workspaceRoot: "/a",
          repository: "acme/web",
          provider: "gitlab",
        }),
      ],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("gitlab"), {
          getChangeRequest: () =>
            Effect.sync(() => {
              held ??= hostTitle;
              return { ...hostedChangeRequest("body"), title: held };
            }),
          forgetChangeRequestReads: () =>
            Effect.gen(function* () {
              if (gate !== undefined) {
                yield* Deferred.succeed(gate.entered, undefined);
                yield* Deferred.await(gate.release);
              }
              held = undefined;
            }),
        }),
      ],
    });
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    const refreshWithReadInBetween = (refresh: Effect.Effect<void>) =>
      Effect.gen(function* () {
        gate = { entered: yield* Deferred.make<void>(), release: yield* Deferred.make<void>() };
        const running = yield* refresh.pipe(Effect.forkChild());
        yield* Deferred.await(gate.entered);
        yield* service.detail(reference);
        yield* Deferred.succeed(gate.release, undefined);
        yield* Fiber.join(running);
        gate = undefined;
      });

    assert.strictEqual((yield* service.detail(reference)).title, "old");
    hostTitle = "after turn";
    yield* refreshWithReadInBetween(service.refreshAfterTurn(reference.projectId));
    assert.strictEqual((yield* service.detail(reference)).title, "after turn");

    hostTitle = "after refresh";
    yield* refreshWithReadInBetween(service.invalidate({ reference }));
    assert.strictEqual((yield* service.detail(reference)).title, "after refresh");
  }),
);

it.effect("rejects mismatched routing credentials before use and preserves action errors", () =>
  Effect.gen(function* () {
    let operations = 0;
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("github"), {
          getRoutingIdentity: () => Effect.succeed({ accountId: "101", viewer: "octocat" }),
          withVerifiedCredential: (_, use) =>
            use({
              accountId: "101",
              viewer: "octocat",
              credentialFingerprint: "credential-a",
            }),
        }),
      ],
    });
    const reference = {
      projectId: "p1" as ProjectId,
      repository: "acme/web",
      number: 1,
      host: "github.com",
      expectedAccountId: "202",
    };
    const actionError = new PullRequestOperationError({
      operation: "runAction",
      detail: "ambiguous",
    });
    const operation = Effect.sync(() => {
      operations += 1;
    }).pipe(Effect.andThen(Effect.fail(actionError)));
    const rejected = yield* Effect.flip(service.withRoutingCredential(reference, operation));
    assert.strictEqual(rejected._tag, "PullRequestOperationError");
    if (rejected._tag === "PullRequestOperationError")
      assert.strictEqual(rejected.operation, "routeIdentity");
    assert.strictEqual(operations, 0);
    assert.strictEqual(
      yield* Effect.flip(
        service.withRoutingCredential({ ...reference, expectedAccountId: "101" }, operation),
      ),
      actionError,
    );
    assert.strictEqual(operations, 1);
    assert.deepStrictEqual(yield* service.routingIdentity({ host: "github.com" }), {
      accountId: "101",
      viewer: "octocat",
      host: "github.com",
      provider: "github",
    });
  }),
);

it.effect(
  "opening detail preserves enriched linked summaries and updates draft and diff fields",
  () =>
    Effect.gen(function* () {
      const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
      const service = yield* makeService({
        projects: [
          project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" }),
        ],
        providers: [
          fakePullRequestProvider(SourceControlProviderKind.make("github"), {
            getChangeRequestSummary: () =>
              Effect.succeed({
                ...changeRequest(1, "2026-07-02T00:00:00Z"),
                isDraft: true,
                reviewDecision: "approved",
                checksState: "passing",
              }),
            getChangeRequest: () =>
              Effect.succeed({
                ...hostedChangeRequest("body", 14),
                deletions: 3,
                changedFiles: 5,
                mergeability: "conflicting",
              }),
          }),
        ],
      });
      yield* service.summary(reference);
      const detail = yield* service.detail(reference);
      const summary = yield* service.summary(reference);
      assert.strictEqual(summary.isDraft, false);
      assert.deepStrictEqual(summary.author, detail.author);
      assert.strictEqual(summary.additions, 14);
      assert.strictEqual(summary.deletions, 3);
      assert.strictEqual(summary.changedFiles, 5);
      assert.strictEqual(summary.mergeability, "conflicting");
      assert.strictEqual(summary.reviewDecision, "approved");
      assert.strictEqual(summary.checksState, "passing");
    }),
);

it.effect("notifies linked threads when detail changes draft status in either direction", () =>
  Effect.gen(function* () {
    let isDraft = true;
    let updatedAt = "2026-07-02T00:00:00Z";
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("github"), {
          getChangeRequest: () =>
            Effect.sync(() => ({ ...hostedChangeRequest("body"), isDraft, updatedAt })),
        }),
      ],
    });
    const changes = yield* service.subscribeStateChanges;
    const read = () => service.detail({ ...reference, allowStale: false });
    yield* read();
    yield* read();
    isDraft = false;
    yield* service.invalidate({ reference });
    yield* read();
    yield* read();
    isDraft = true;
    yield* service.invalidate({ reference });
    yield* read();

    isDraft = false;
    updatedAt = "2026-07-01T00:00:00Z";
    yield* service.invalidate({ reference });
    yield* read();

    // A different PR ends collection after all the synchronous notifications above.
    yield* service.reportState({ reference: { ...reference, number: 2 }, state: "open" });
    const events = yield* Stream.runCollect(
      changes.pipe(Stream.takeUntil((event) => event.number === 2, { excludeLast: true })),
    );
    assert.deepStrictEqual(events, [
      { host: "github.com", repository: "acme/web", number: 1 },
      { host: "github.com", repository: "acme/web", number: 1 },
      { host: "github.com", repository: "acme/web", number: 1 },
    ]);
  }),
);

it.effect("deduplicates routed PR reports without dropping draft changes", () =>
  Effect.gen(function* () {
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [fakePullRequestProvider(SourceControlProviderKind.make("github"))],
    });
    const changes = yield* service.subscribeStateChanges;
    for (const isDraft of [true, true, false, false, true]) {
      yield* service.reportState({ reference, state: "open", isDraft });
    }
    yield* service.reportState({ reference, state: "open" });
    yield* service.reportState({ reference, state: "open" });
    yield* service.reportState({ reference: { ...reference, number: 2 }, state: "open" });
    const events = yield* Stream.runCollect(
      changes.pipe(Stream.takeUntil((event) => event.number === 2, { excludeLast: true })),
    );
    assert.deepStrictEqual(
      events.map((event) => event.number),
      [1, 1, 1, 1],
    );
  }),
);

it.effect("reuses an observed merged state for strict settlement reads", () =>
  Effect.gen(function* () {
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("github"), {
          getChangeRequest: () =>
            Effect.succeed({
              ...hostedChangeRequest("merged body", 4),
              state: "merged",
              updatedAt: "2026-07-03T00:00:00Z",
            }),
          getChangeRequestSummary: () => Effect.die("strict merged state must not refresh"),
        }),
      ],
    });

    yield* service.detail(reference);

    const summary = yield* service.summary(reference, { recoverTransientFailure: false });
    assert.strictEqual(summary.state, "merged");
    assert.strictEqual(summary.updatedAt, "2026-07-03T00:00:00Z");
  }),
);

it.effect("does not let a stale detail reopen overwrite a fresher linked summary", () =>
  Effect.gen(function* () {
    const gate = yield* Deferred.make<void>();
    let detailCalls = 0;
    let summaryTitle = "old title";
    let summaryState: "open" | "merged" = "open";
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };
    const service = yield* makeService({
      projects: [project({ id: "p1", title: "web", workspaceRoot: "/a", repository: "acme/web" })],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("github"), {
          getChangeRequest: () =>
            Effect.gen(function* () {
              detailCalls += 1;
              if (detailCalls > 1) yield* Deferred.await(gate);
              return hostedChangeRequest("old body", 4);
            }),
          getChangeRequestSummary: () =>
            Effect.succeed({
              ...changeRequest(1, "2026-07-02T00:00:00Z"),
              title: summaryTitle,
              state: summaryState,
            }),
        }),
      ],
    });

    const first = yield* service.detail(reference);
    assert.strictEqual(first.title, "Change request 1");

    summaryTitle = "merged title";
    summaryState = "merged";
    yield* TestClock.adjust("61 seconds");
    const settled = yield* service.summary(reference, { recoverTransientFailure: false });
    assert.strictEqual(settled.title, "merged title");
    assert.strictEqual(settled.state, "merged");

    yield* TestClock.adjust("16 seconds");
    const stale = yield* service.detail(reference);
    assert.strictEqual(stale.title, "Change request 1");
    yield* Effect.yieldNow;

    const display = yield* service.summary(reference);
    assert.strictEqual(display.title, "merged title");
    assert.strictEqual(display.state, "merged");
    assert.strictEqual(detailCalls, 2);

    summaryTitle = "updated after merge";
    yield* TestClock.adjust("61 seconds");
    assert.strictEqual((yield* service.summary(reference)).title, "merged title");
    const refreshed = yield* service.summary({ ...reference, allowStale: false });
    assert.strictEqual(refreshed.title, "updated after merge");
    assert.strictEqual(refreshed.state, "merged");
  }),
);

it.effect("pauses uncached activity on a host after one activity read is rate limited", () =>
  Effect.gen(function* () {
    let activityReads = 0;
    const service = yield* makeService({
      projects: [
        project({
          id: "p1",
          title: "web",
          workspaceRoot: "/repo",
          repository: "acme/web",
          provider: "gitlab",
          host: "gitlab.example.test",
        }),
      ],
      providers: [
        fakePullRequestProvider(SourceControlProviderKind.make("gitlab"), {
          getChangeRequestActivity: () =>
            Effect.suspend(() => {
              activityReads++;
              return Effect.fail(
                new PullRequestProviderError({
                  provider: SourceControlProviderKind.make("gitlab"),
                  operation: "getChangeRequestActivity",
                  reason: "rate-limited",
                  detail: "API rate limit exceeded.",
                }),
              );
            }),
        }),
      ],
    });
    const reference = { projectId: "p1" as ProjectId, repository: "acme/web", number: 1 };

    expect(yield* Effect.result(service.activity(reference))).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "PullRequestOperationError",
        cause: { _tag: "PullRequestProviderError", reason: "rate-limited" },
      },
    });
    assert.strictEqual(activityReads, 1);

    // A different change request cannot reuse the first request's cached failure.
    expect(yield* Effect.result(service.activity({ ...reference, number: 2 }))).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "PullRequestOperationError",
        cause: {
          _tag: "PullRequestProviderError",
          reason: "rate-limited",
          cause: {
            _tag: "SourceControlRateLimitPausedError",
            host: "gitlab.example.test",
          },
        },
      },
    });
    assert.strictEqual(activityReads, 1);
  }),
);

// Refresh and expiry are covered by the in-flight test below; repository and number share the ref key.
