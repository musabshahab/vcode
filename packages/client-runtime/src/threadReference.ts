import type {
  ComposerContextClipboardFragment,
  ScopedThreadRef,
  ThreadPullRequestLink,
} from "@codenine/contracts";
import { threadContextRecord } from "@codenine/shared/composerContextReferences";
import { formatThreadLink, hostedThreadLink } from "@codenine/shared/threadLinks";

import { resolveThreadCurrentPullRequestLink } from "./threadPullRequests.ts";

export interface ThreadReferenceCopyTarget {
  readonly kind: "pull-request" | "thread";
  /** The plain text: a PR URL, or a link that opens the thread from anywhere. */
  readonly value: string;
  /** What a toast or palette row shows for the copy. */
  readonly description: string;
  /** Codenine's clipboard format, which pastes a thread back into a composer as a chip. */
  readonly fragment?: ComposerContextClipboardFragment;
  readonly clipboardTarget: string;
  readonly successTitle: string;
  readonly failureTitle: string;
}

/**
 * A link to the thread, through `hostedAppUrl` when the build has a hosted app, else a
 * `codenine-thread` link. It pastes back as a chip into any composer whose agent reads that machine.
 */
export function threadChipCopyTarget(
  threadRef: ScopedThreadRef,
  title: string,
  hostedAppUrl?: string | undefined,
): ThreadReferenceCopyTarget {
  const record = threadContextRecord(threadRef, title);
  return {
    kind: "thread",
    value:
      hostedAppUrl === undefined
        ? formatThreadLink(threadRef, title)
        : hostedThreadLink(threadRef, hostedAppUrl),
    description: record.title,
    fragment: { version: 1, source: { environmentId: threadRef.environmentId }, records: [record] },
    clipboardTarget: "thread",
    successTitle: "Thread copied",
    failureTitle: "Failed to copy thread",
  };
}

export function resolveThreadReferenceCopyTarget(input: {
  readonly threadRef: ScopedThreadRef;
  readonly title: string;
  readonly pullRequests?: ReadonlyArray<ThreadPullRequestLink> | undefined;
  readonly linkedPullRequestUrl?: string | null;
  readonly hostedAppUrl?: string | undefined;
}): ThreadReferenceCopyTarget {
  const pullRequestUrl =
    resolveThreadCurrentPullRequestLink(input.pullRequests ?? [])?.url ??
    input.linkedPullRequestUrl;
  return pullRequestUrl
    ? {
        kind: "pull-request",
        value: pullRequestUrl,
        description: pullRequestUrl,
        clipboardTarget: "pull request link",
        successTitle: "PR link copied",
        failureTitle: "Failed to copy PR link",
      }
    : threadChipCopyTarget(input.threadRef, input.title, input.hostedAppUrl);
}
