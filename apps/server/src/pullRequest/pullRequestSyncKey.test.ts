import { ProjectId, SourceControlProviderKind } from "@codenine/contracts";
import { describe, expect, it } from "vite-plus/test";

import { pullRequestSyncKey } from "./pullRequestSyncKey.ts";

describe("pullRequestSyncKey", () => {
  const reference = { projectId: ProjectId.make("project"), repository: "acme/web", number: 7 };
  it("resolves a hostless reference through the checkout's host", () => {
    const identity = {
      canonicalKey: "github.com/acme/web",
      provider: SourceControlProviderKind.make("github"),
      name: "web",
      displayName: "acme/web",
      locator: {
        source: "git-remote" as const,
        remoteName: "origin",
        remoteUrl: "https://github.com/acme/web",
      },
    };
    expect(pullRequestSyncKey(reference, identity)).toEqual({
      host: "github.com",
      repository: "acme/web",
      number: 7,
    });
  });
  it("keys a hosted reference without requiring a checkout", () => {
    expect(pullRequestSyncKey({ ...reference, host: "GitHub.com" })).toEqual({
      host: "github.com",
      repository: "acme/web",
      number: 7,
    });
    expect(pullRequestSyncKey(reference)).toBeNull();
  });
});
