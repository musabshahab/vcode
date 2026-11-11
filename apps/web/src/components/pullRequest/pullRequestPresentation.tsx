import type { PullRequestState } from "@codenine/contracts";

import {
  PULL_REQUEST_STATE_PRESENTATION,
  type PullRequestStatePresentation,
} from "./pullRequestIcons";

export function resolvePullRequestState(input: {
  readonly state: PullRequestState;
  readonly isDraft: boolean;
}): PullRequestStatePresentation {
  const key = input.state === "open" && input.isDraft ? "draft" : input.state;
  return PULL_REQUEST_STATE_PRESENTATION[key];
}
