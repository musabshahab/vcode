import {
  WS_METHODS,
  PullRequestLinkedThreadsResult,
  type EnvironmentId,
  type PullRequestRef,
  PullRequestSummary,
  type VcsStatusResult,
} from "@codenine/contracts";
import { Atom } from "effect/reactivity";

import { persistQuery } from "./queryPersistence.ts";
import {
  createEnvironmentRpcQueryAtomFamily,
  createEnvironmentRpcSubscriptionAtomFamily,
  type QueryAnswerHandler,
} from "./runtime.ts";
import { createPullRequestRouter } from "./pullRequestRouting.ts";
import type { EnvironmentRegistry } from "../connection/registry.ts";

const LINKED_PULL_REQUEST_IDLE_TTL_MS = 5_000;

function makePullRequestRefreshAtomFamily<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "environment-data:pull-requests:turn-refreshes",
    tag: WS_METHODS.pullRequestsSubscribeRefreshes,
  });
}

const refreshFamiliesByRuntime = new WeakMap<
  object,
  ReturnType<typeof makePullRequestRefreshAtomFamily>
>();

function createPullRequestRefreshAtomFamily<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
): ReturnType<typeof makePullRequestRefreshAtomFamily<R, E>> {
  const existing = refreshFamiliesByRuntime.get(runtime);
  if (existing) return existing as ReturnType<typeof makePullRequestRefreshAtomFamily<R, E>>;
  const refreshes = makePullRequestRefreshAtomFamily(runtime);
  refreshFamiliesByRuntime.set(runtime, refreshes);
  return refreshes;
}

/** A linked pull request's state, for threads whose links carry no snapshot yet. */
export function createLinkedPullRequestSummaryAtomFamily<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
  onAnswer?: QueryAnswerHandler<PullRequestRef, PullRequestSummary>,
) {
  const refreshes = createPullRequestRefreshAtomFamily(runtime);
  const routedRequest = createPullRequestRouter();
  return createEnvironmentRpcQueryAtomFamily(runtime, {
    label: "environment-data:pull-requests:linked-summary",
    persistence: persistQuery(PullRequestSummary),
    tag: WS_METHODS.pullRequestsSummary,
    execute: (input) => routedRequest(WS_METHODS.pullRequestsSummary, input),
    staleTimeMs: 60_000,
    refreshIntervalMs: 60_000,
    idleTtlMs: LINKED_PULL_REQUEST_IDLE_TTL_MS,
    refreshTrigger: ({ environmentId }) => refreshes({ environmentId, input: {} }),
    isFinal: (summary) => summary.state === "merged",
    ...(onAnswer === undefined ? {} : { onAnswer }),
  });
}

export function pullRequestDetailToVcsStatus(
  detail: PullRequestSummary,
): NonNullable<VcsStatusResult["pr"]> {
  return {
    number: detail.number,
    title: detail.title,
    url: detail.url,
    baseRef: detail.baseBranch,
    headRef: detail.headBranch,
    state: detail.state,
    ...(detail.isDraft === true ? { isDraft: true } : {}),
    updatedAt: detail.updatedAt,
  };
}

export function createPullRequestEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const refreshes = createPullRequestRefreshAtomFamily(runtime);
  return {
    refreshes,
    linkedThreads: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-requests:linked-threads",
      persistence: persistQuery(PullRequestLinkedThreadsResult),
      tag: WS_METHODS.pullRequestsLinkedThreads,
      staleTimeMs: 0,
      refreshIntervalMs: 10_000,
      refreshTrigger: ({ environmentId }: { readonly environmentId: EnvironmentId }) =>
        refreshes({ environmentId, input: {} }),
    }),
    // For callers that open a thread from the answer: a persisted one reads as final before
    // the connection is known, and a kept one can predate the thread.
    linkedThreadsUncached: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:pull-requests:linked-threads-uncached",
      tag: WS_METHODS.pullRequestsLinkedThreads,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
  };
}
