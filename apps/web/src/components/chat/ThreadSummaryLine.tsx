import { formatDiffCount } from "@codenine/client-runtime/diff-count";
import type { EnvironmentId } from "@codenine/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Equal from "effect/Equal";
import { AsyncResult, Atom } from "effect/reactivity";
import type { ReactNode } from "react";

import type { ThreadPanelPresentation } from "../../rightPanelLayout";
import { vcsEnvironment } from "../../state/vcs";
import { resolveChangesTotals } from "../GitActionsControl.logic";
import { PopoverCreateHandle, PopoverTrigger } from "../ui/popover";

// Its own slice of the status stream the chat view already holds, so a changed line count
// re-renders only this line.
const summaryGitStatusAtom = Atom.family((status: ReturnType<typeof vcsEnvironment.status>) =>
  Atom.map(status, (result) => {
    const data = AsyncResult.getOrElse(result, () => null);
    if (data === null || !data.isRepo) return null;
    const totals = resolveChangesTotals(data);
    return {
      branch: data.refName,
      insertions: totals?.insertions ?? 0,
      deletions: totals?.deletions ?? 0,
    };
  }).pipe(Atom.withEquality(Equal.equals)),
);
const NO_SUMMARY_GIT_STATUS_ATOM: ReturnType<typeof summaryGitStatusAtom> = Atom.make(null);

const LEADING_ROW_CLASS_NAME =
  "flex min-w-0 max-w-full items-start gap-1 text-xs leading-4 text-muted-foreground";

/** Branch, changes and machine under the thread title; it opens and closes the details card. */
export function ThreadSummaryLine(props: {
  /** Leads the line outside the details button, such as a team agent's place in its team. */
  leading?: ReactNode;
  environmentId: EnvironmentId;
  gitCwd: string | null;
  fallbackBranch: string | null;
  machineLabel: string | null;
  detailsOpen: boolean;
  detailsPresentation: ThreadPanelPresentation;
  detailsPopoverHandle: ReturnType<typeof PopoverCreateHandle>;
  onToggleDetails: () => void;
}) {
  const git = useAtomValue(
    props.gitCwd === null
      ? NO_SUMMARY_GIT_STATUS_ATOM
      : summaryGitStatusAtom(
          vcsEnvironment.status({
            environmentId: props.environmentId,
            input: { cwd: props.gitCwd },
          }),
        ),
  );
  const branch = git?.branch ?? props.fallbackBranch;
  const changes =
    git && (git.insertions > 0 || git.deletions > 0)
      ? `+${formatDiffCount(git.insertions)} −${formatDiffCount(git.deletions)}`
      : null;
  const parts = [branch, changes, props.machineLabel].filter((part) => part !== null);
  if (parts.length === 0) {
    return props.leading === undefined ? null : (
      <div className={LEADING_ROW_CLASS_NAME}>{props.leading}</div>
    );
  }

  const popover = props.detailsPresentation === "popover";
  const line = (
    <button
      type="button"
      aria-expanded={props.detailsOpen}
      aria-label={`Thread details: ${parts.join(", ")}`}
      onClick={popover ? undefined : props.onToggleDetails}
      className="flex min-w-0 max-w-full cursor-pointer self-start rounded-sm text-xs leading-4 text-muted-foreground tabular-nums transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <span className="truncate">{parts.join(" · ")}</span>
    </button>
  );
  const details = popover ? (
    <PopoverTrigger handle={props.detailsPopoverHandle} render={line} />
  ) : (
    line
  );
  return props.leading === undefined ? (
    details
  ) : (
    <div className={LEADING_ROW_CLASS_NAME}>
      {props.leading}
      <span aria-hidden className="shrink-0">
        ·
      </span>
      {details}
    </div>
  );
}
