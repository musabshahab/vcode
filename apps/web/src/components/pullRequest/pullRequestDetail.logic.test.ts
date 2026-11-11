import { GitCommandError } from "@codenine/contracts";
import { describe, expect, it } from "vite-plus/test";

import { appendHandoff, checkoutFailureDescription } from "./pullRequestDetail.logic";
import type { ReviewCommentContext } from "~/reviewCommentContext";

describe("what to say when an action fails", () => {
  // regression: #15007 checkout failures hid git's error detail
  it("uses bounded git diagnostics and falls back when checkout has no useful detail", () => {
    const diagnostic = (detail: string, reason?: GitCommandError["reason"]) =>
      new GitCommandError({
        cwd: "/workspace",
        operation: "GitVcsDriver.createWorktree",
        command: "git worktree add",
        detail,
        reason,
      });
    expect(
      checkoutFailureDescription(diagnostic("git worktree add failed", "path_already_exists")),
    ).toBe("git worktree add failed (path_already_exists)");
    const reason = "The worktree directory already exists. Choose another directory.";
    expect(checkoutFailureDescription(diagnostic(reason))).toBe(reason);
    expect(checkoutFailureDescription(diagnostic("x".repeat(900)))).toBe(`${"x".repeat(319)}…`);
    for (const failure of [undefined, diagnostic(""), diagnostic("exited with code 1")]) {
      expect(checkoutFailureDescription(failure)).toBe(
        "Check that the branch still exists and is not checked out elsewhere, then try again.",
      );
    }
  });
});

describe("a second handoff into the same composer", () => {
  const chip = (id: string): ReviewCommentContext => ({
    id,
    sectionId: "pull-request:42",
    sectionTitle: "PR #42",
    filePath: "PR #42",
    startIndex: 0,
    endIndex: 0,
    rangeLabel: "Add the pull requests page",
    text: "",
    diff: "",
  });
  const ids = (comments: ReadonlyArray<ReviewCommentContext>) => comments.map((c) => c.id);

  it("keeps the earlier findings and their chips", () => {
    const next = appendHandoff(
      {
        prompt: "Fix the first finding.",
        reviewComments: [chip("pull-request-finding:t1")],
      },
      { prompt: "Fix the second finding.", reviewComments: [chip("pull-request-finding:t2")] },
    );
    expect(next.prompt).toBe("Fix the first finding.\n\nFix the second finding.");
    expect(ids(next.reviewComments)).toEqual([
      "pull-request-finding:t1",
      "pull-request-finding:t2",
    ]);
  });

  it("keeps earlier diff selections when another is added", () => {
    const next = appendHandoff(
      {
        prompt: "why this?",
        reviewComments: [
          chip("pull-request-context:42"),
          chip("pull-request-selection:page.tsx:1:2"),
        ],
      },
      {
        prompt: "and this?",
        reviewComments: [
          chip("pull-request-context:42"),
          chip("pull-request-selection:page.tsx:8:9"),
        ],
      },
    );
    expect(next.prompt).toBe("why this?\n\nand this?");
    expect(ids(next.reviewComments)).toEqual([
      "pull-request-context:42",
      "pull-request-selection:page.tsx:1:2",
      "pull-request-selection:page.tsx:8:9",
    ]);
  });

  it("swaps in the newer copy of a chip it already holds", () => {
    const stale = { ...chip("pull-request-context:42"), text: "Explain only." };
    const fresh = { ...chip("pull-request-context:42"), text: "" };
    const next = appendHandoff(
      { prompt: "Explain this pull request.", reviewComments: [stale, chip("file-comment:3")] },
      { prompt: "why this?", reviewComments: [fresh] },
    );
    expect(next.reviewComments).toEqual([fresh, chip("file-comment:3")]);
  });

  it("preserves a multiline request even when its lines already occur in the draft", () => {
    const prompt = "keep this line\nchange the middle\nkeep this line";
    const incoming = "keep this line\nnew middle\nkeep this line";
    expect(appendHandoff({ prompt, reviewComments: [] }, { prompt: incoming }).prompt).toBe(
      `${prompt}\n\n${incoming}`,
    );
    const reordered = "change the middle\nkeep this line";
    expect(appendHandoff({ prompt, reviewComments: [] }, { prompt: reordered }).prompt).toBe(
      `${prompt}\n\n${reordered}`,
    );
  });

  it("changes nothing when the same handoff lands twice", () => {
    const handoff = {
      prompt: "Fix the review finding attached to this message.  \nThe pull request is #42.",
      reviewComments: [chip("pull-request-finding:t1")],
    };
    const once = appendHandoff({ prompt: "", reviewComments: [] }, handoff);
    expect(appendHandoff(once, handoff)).toEqual(once);
  });

  it("keeps each finding prompt intact, including its preamble", () => {
    const preamble = "The pull request is #42.\nIts branch is `feature`.";
    const next = appendHandoff(
      {
        prompt: `Fix the review remark quoted below.\n${preamble}\n> reviewer: rename it`,
        reviewComments: [],
      },
      { prompt: `Fix the review remark quoted below.\n${preamble}\n> reviewer: add a test` },
    );
    expect(next.prompt).toBe(
      `Fix the review remark quoted below.\n${preamble}\n> reviewer: rename it\n\nFix the review remark quoted below.\n${preamble}\n> reviewer: add a test`,
    );
  });

  it("keeps what the reader typed, trailing line breaks aside", () => {
    expect(
      appendHandoff(
        { prompt: "check the migration first\n", reviewComments: [chip("file-comment:3")] },
        { prompt: "", reviewComments: [chip("pull-request-context:42")] },
      ),
    ).toEqual({
      prompt: "check the migration first\n",
      reviewComments: [chip("file-comment:3"), chip("pull-request-context:42")],
    });
    expect(
      appendHandoff(
        { prompt: "check the migration first\n", reviewComments: [] },
        { prompt: "Explain this pull request.", reviewComments: [] },
      ).prompt,
    ).toBe("check the migration first\n\nExplain this pull request.");
  });
});
