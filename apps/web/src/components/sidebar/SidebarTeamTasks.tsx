import type { TeamThreadAttention } from "@codenine/client-runtime/state/team-threads";
import { ChevronRightIcon, UsersIcon } from "lucide-react";
import { createContext, type ReactNode, use } from "react";

import { cn } from "~/lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

const ATTENTION_DOT_CLASS_NAME: Record<TeamThreadAttention, string> = {
  attention: "bg-warning",
  failed: "bg-error",
  unread: "bg-success",
  working: "bg-info",
};

const ATTENTION_DOT_LABEL: Record<TeamThreadAttention, string> = {
  attention: ", needs you",
  failed: ", failed",
  unread: ", done",
  working: ", working",
};

/** The dot a closed folder or a collapsed team shows for the rows it hides. */
export function SidebarAttentionDot(props: { attention: TeamThreadAttention }) {
  return (
    <span
      className={cn("size-1.5 shrink-0 rounded-full", ATTENTION_DOT_CLASS_NAME[props.attention])}
    >
      <span className="sr-only">{ATTENTION_DOT_LABEL[props.attention]}</span>
    </span>
  );
}

/**
 * Draws a lead's team task rows. The sidebar provides it on each render and only this slot
 * reads it, so a lead row stays memoized while its task rows follow the list.
 */
export const SidebarTeamTasksContext = createContext<(leadKey: string) => ReadonlyArray<ReactNode>>(
  () => [],
);

export function SidebarTeamTasks(props: { leadKey: string }) {
  const rows = use(SidebarTeamTasksContext)(props.leadKey);
  if (rows.length === 0) return null;
  return (
    <ul
      role="presentation"
      className="ms-4 mt-px flex flex-col gap-px border-s border-sidebar-border/70 ps-1"
    >
      {rows}
    </ul>
  );
}

/** The lead row's quiet team count, which shows or hides the team's task rows. */
export function SidebarTeamToggle(props: {
  count: number;
  expanded: boolean;
  attention: TeamThreadAttention | null;
  /** Off when the row already shows the team icon. */
  showIcon: boolean;
  onToggle: () => void;
}) {
  const label = `${props.expanded ? "Hide" : "Show"} the team's ${props.count} ${props.count === 1 ? "thread" : "threads"}`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-expanded={props.expanded}
            aria-label={label}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              props.onToggle();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-sm px-0.5 text-xs tabular-nums text-secondary-label outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
      >
        {props.showIcon ? <UsersIcon aria-hidden className="size-3" /> : null}
        {props.count}
        {props.attention !== null ? <SidebarAttentionDot attention={props.attention} /> : null}
        <ChevronRightIcon aria-hidden className={cn("size-3", props.expanded && "rotate-90")} />
      </TooltipTrigger>
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}
