import { EyeIcon, EyeOffIcon } from "lucide-react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { cn } from "~/lib/utils";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import {
  ChangeRequestStatusIcon,
  type PrStatusIndicator,
  type ThreadPr,
} from "../ThreadStatusIndicators";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import {
  THREAD_DETAILS_PANEL_ICON_CLASS,
  THREAD_DETAILS_PANEL_LABEL_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS,
  THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS,
} from "./threadDetailsPanelStyles";

export function ThreadDetailsPrRow({
  pr,
  number,
  status,
  label,
  openAriaLabel,
  onOpen,
  onStopWatching,
}: {
  pr: ThreadPr;
  number: number;
  status: PrStatusIndicator | null;
  label: string;
  openAriaLabel: string;
  onOpen: (event: ReactMouseEvent<HTMLElement>) => void;
  onStopWatching?: (() => void) | undefined;
}) {
  const icon =
    pr && status ? (
      <ChangeRequestStatusIcon
        state={pr.state}
        className={cn(THREAD_DETAILS_PANEL_ICON_CLASS, status.colorClass)}
      />
    ) : (
      <PullRequestGlyph.pullRequest className={THREAD_DETAILS_PANEL_ICON_CLASS} />
    );

  const openRow = (part: "row" | "primary") => (
    <Tooltip>
      <TooltipTrigger
        render={
          <ThreadDetailsControl
            type="button"
            variant="ghost"
            size="sm"
            part={part}
            aria-label={openAriaLabel}
            onClick={onOpen}
            onAuxClick={onOpen}
          />
        }
      >
        {icon}
        <span className={cn("min-w-0 flex-1 truncate text-left", THREAD_DETAILS_PANEL_LABEL_CLASS)}>
          {label}
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">{status?.tooltip ?? `#${number}`}</TooltipPopup>
    </Tooltip>
  );

  const watching = onStopWatching !== undefined && (pr?.state ?? "open") === "open";
  if (!watching) return openRow("row");
  return (
    <div className={THREAD_DETAILS_PANEL_SPLIT_GROUP_CLASS}>
      {openRow("primary")}
      <span aria-hidden="true" className={THREAD_DETAILS_PANEL_SPLIT_SEPARATOR_CLASS} />
      <Tooltip>
        <TooltipTrigger
          render={
            <ThreadDetailsControl
              type="button"
              variant="ghost"
              size="sm"
              part="secondary"
              className="group/watch"
              aria-label={`Stop watching #${number}`}
              onClick={onStopWatching}
            />
          }
        >
          <EyeIcon aria-hidden className="size-4 group-hover/watch:hidden" />
          <EyeOffIcon aria-hidden className="hidden size-4 group-hover/watch:block" />
        </TooltipTrigger>
        <TooltipPopup side="top">
          Watching: the agent wakes when checks finish, someone comments, or the branch conflicts.
          Click to stop.
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
