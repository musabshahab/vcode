import { EnvironmentId, ThreadId, type ThreadPullRequestLink } from "@codenine/contracts";
import {
  decodeComposerContextFragment,
  encodeComposerContextFragment,
} from "@codenine/shared/composerContextClipboard";
import { threadLinkContextReferences } from "@codenine/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadReferenceCopyTarget } from "./threadReference.ts";

const thread = {
  threadRef: { environmentId: EnvironmentId.make("env-1"), threadId: ThreadId.make("thread-1") },
  title: "Fix the login flow",
};

const crossRepositoryPullRequest: ThreadPullRequestLink = {
  host: "github.com",
  repository: "other/repo",
  number: 42,
  url: "https://github.com/other/repo/pull/42",
  source: "manual",
  linkedAt: "2026-01-01T00:00:00.000Z",
  snapshot: null,
  stack: null,
};

describe("resolveThreadReferenceCopyTarget", () => {
  it.each([null, "https://github.com/codenine/pr/12"])(
    "copies a native cross-repository link before the fallback URL %s",
    (linkedPullRequestUrl) => {
      expect(
        resolveThreadReferenceCopyTarget({
          ...thread,
          pullRequests: [crossRepositoryPullRequest],
          linkedPullRequestUrl,
        }),
      ).toMatchObject({
        kind: "pull-request",
        value: crossRepositoryPullRequest.url,
      });
    },
  );

  it("uses the fallback URL when native links are dismissed", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        ...thread,
        pullRequests: [{ ...crossRepositoryPullRequest, source: "stack-dismissed" }],
        linkedPullRequestUrl: "https://github.com/codenine/pr/12",
      }),
    ).toMatchObject({ kind: "pull-request", value: "https://github.com/codenine/pr/12" });
  });

  it("copies a thread chip that pastes back as the same thread on its machine", () => {
    const target = resolveThreadReferenceCopyTarget({ ...thread, linkedPullRequestUrl: null });

    expect(target).toMatchObject({
      kind: "thread",
      description: "Fix the login flow",
      successTitle: "Thread copied",
    });
    const pasted = decodeComposerContextFragment(encodeComposerContextFragment(target!.fragment!));
    expect(pasted).toEqual({
      version: 1,
      source: { environmentId: "env-1" },
      records: [
        expect.objectContaining({
          kind: "thread",
          environmentId: "env-1",
          threadId: "thread-1",
          title: "Fix the login flow",
        }),
      ],
    });
    // Without a hosted app, the plain text is a thread link that pastes back as the record's chip.
    expect(target!.value).toBe("[Fix the login flow](codenine-thread://v2/env-1/thread-1)");
    expect(threadLinkContextReferences(target!.value, pasted!.records, () => undefined)).toEqual({
      text: `[Fix the login flow](codenine-context://v1/thread/${pasted!.records[0]!.contextId})`,
      records: pasted!.records,
    });
  });

  it("links through the build's hosted app", () => {
    expect(
      resolveThreadReferenceCopyTarget({
        ...thread,
        hostedAppUrl: "https://preview.codenine.example",
      })?.value,
    ).toBe("https://preview.codenine.example/threads/env-1/thread-1");
  });
});
