import { useAtomValue } from "@effect/atom-react";
import { sourceControlClients } from "@codenine/client-runtime/source-control-clients";
import {
  createLinkedPullRequestSummaryAtomFamily,
  createPullRequestEnvironmentAtoms,
} from "@codenine/client-runtime/state/pull-requests";
import type {
  EnvironmentId,
  ProjectId,
  PullRequestRef,
  PullRequestSummary,
  ThreadPullRequestLink,
} from "@codenine/contracts";
import {
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@codenine/client-runtime/thread-pull-requests";
import { Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { useEnvironmentQuery } from "./query";
import { environmentThreadShells } from "./threads";

function compareSummaries(current: PullRequestSummary, incoming: PullRequestSummary): number {
  const merged = Number(incoming.state === "merged") - Number(current.state === "merged");
  if (merged !== 0) return merged;
  const updated = Date.parse(incoming.updatedAt) - Date.parse(current.updatedAt);
  if (updated !== 0) return updated;
  if (current.observedAt === undefined && incoming.observedAt === undefined) return 0;
  return (incoming.observedAt ?? -Infinity) - (current.observedAt ?? -Infinity);
}

export function newestPullRequestSummary(
  current: PullRequestSummary | null,
  observed: PullRequestSummary | null,
): PullRequestSummary | null {
  if (current === null) return observed;
  if (observed === null) return current;
  return compareSummaries(current, observed) >= 0 ? observed : current;
}

export const pullRequestEnvironment = createPullRequestEnvironmentAtoms(connectionAtomRuntime);

const linkedPullRequestSummaryAtom =
  createLinkedPullRequestSummaryAtomFamily(connectionAtomRuntime);

function threadPullRequestLinkToSummary(
  link: ThreadPullRequestLink,
  projectId: ProjectId,
): PullRequestSummary | null {
  const updatedAt = link.snapshot?.updatedAt;
  if (link.snapshot === null || updatedAt == null) return null;
  return {
    ...link.snapshot,
    provider: (
      sourceControlClients.findByChangeRequestUrl(link.url) ?? sourceControlClients.get(undefined)
    ).kind,
    projectId,
    repository: link.repository,
    number: link.number,
    url: link.url,
    updatedAt,
  };
}

function savedPullRequestKey(
  environmentId: EnvironmentId,
  reference: Pick<PullRequestRef, "host" | "repository" | "number">,
): string {
  return reference.host === undefined
    ? ""
    : `${environmentId}:${threadPullRequestKeyOf({ ...reference, host: reference.host })}`;
}

const savedPullRequestSummariesAtom = Atom.make((get) => {
  const summaries = new Map<string, PullRequestSummary>();
  for (const thread of get(environmentThreadShells.threadShellsAtom)) {
    for (const link of visibleThreadPullRequests(thread.pullRequests)) {
      const summary = threadPullRequestLinkToSummary(link, thread.projectId);
      if (summary === null) continue;
      const key = savedPullRequestKey(thread.environmentId, link);
      summaries.set(key, newestPullRequestSummary(summaries.get(key) ?? null, summary) ?? summary);
    }
  }
  return summaries;
});

const savedPullRequestSummaryAtom = Atom.family((key: string) =>
  Atom.make((get) => get(savedPullRequestSummariesAtom).get(key) ?? null).pipe(
    Atom.withEquality((previous, next) => JSON.stringify(previous) === JSON.stringify(next)),
    Atom.setIdleTTL(5 * 60_000),
  ),
);

/** The newer of the host's answer and the snapshot a thread's link saved. */
export function useLinkedPullRequestSummary(
  environmentId: EnvironmentId | null,
  reference: PullRequestRef | null,
  enabled: boolean,
): PullRequestSummary | null {
  const answer = useEnvironmentQuery(
    !enabled || environmentId === null || reference === null
      ? null
      : linkedPullRequestSummaryAtom({ environmentId, input: reference }),
  ).data;
  const saved = useAtomValue(
    savedPullRequestSummaryAtom(
      environmentId === null || reference === null
        ? ""
        : savedPullRequestKey(environmentId, reference),
    ),
  );
  return newestPullRequestSummary(answer ?? null, saved);
}
