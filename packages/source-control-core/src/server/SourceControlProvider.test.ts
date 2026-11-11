import { assert, it } from "@effect/vitest";

import {
  repositoryPathFromRemoteUrl,
  transportSafeSourceControlErrorValue,
} from "./SourceControlProvider.ts";

it("removes URL credentials, query parameters, and fragments from error transport values", () => {
  assert.strictEqual(
    transportSafeSourceControlErrorValue(
      "https://user:secret@example.test/org/repo/pull/42?token=secret#discussion",
    ),
    "https://example.test/org/repo/pull/42",
  );
});

it.each([
  ["git@github.com:Codenine/codenine.git", "Codenine/codenine"],
  ["github.com:Codenine/codenine.git", "Codenine/codenine"],
  ["gitlab.com:Codenine/platform/codenine", "Codenine/platform/codenine"],
  ["https://github.com/Codenine/codenine.git", "Codenine/codenine"],
  ["C:/repos/codenine", null],
])("reads the repository path of %s", (remoteUrl, expected) => {
  assert.strictEqual(repositoryPathFromRemoteUrl(remoteUrl), expected);
});
