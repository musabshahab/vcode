import { scopedThreadKey, scopeThreadRef } from "@codenine/client-runtime/environment";
import type { EnvironmentThreadShell } from "@codenine/client-runtime/state/models";
import type { NeedsYouReason } from "@codenine/client-runtime/state/thread-inbox";
import type { ScopedThreadRef } from "@codenine/contracts";
import { memo } from "react";

import { attachSidebarTree } from "../../lib/sidebarTree";
import { cn } from "~/lib/utils";
import { SidebarAttentionDot } from "./SidebarTeamTasks";

const NEEDS_YOU_VERB: Record<NeedsYouReason, string> = {
  approval: "Approve",
  question: "Answer",
  review: "Approve team",
  failed: "Team failed",
};

/**
 * The threads waiting on the user, across the projects in view. Each entry opens its thread,
 * which keeps its own row in its project. Entries stay out of the sidebar's thread order, so
 * next, previous and the jump shortcuts meet each thread once, at its row.
 */
export function SidebarNeedsYou(props: {
  entries: ReadonlyArray<{
    readonly thread: EnvironmentThreadShell;
    readonly reason: NeedsYouReason;
  }>;
  activeKey: string | null;
  projectNameByKey: ReadonlyMap<string, string>;
  onOpen: (threadRef: ScopedThreadRef) => void;
}) {
  return (
    <section aria-labelledby="sidebar-needs-you" data-testid="sidebar-needs-you" className="mb-2">
      <h2
        id="sidebar-needs-you"
        className="flex h-8 items-center gap-2 px-2 text-xs font-medium text-warning-foreground"
      >
        <span className="min-w-0 flex-1 truncate">Needs you</span>
        <span className="font-normal tabular-nums text-sidebar-muted-foreground">
          {props.entries.length}
        </span>
      </h2>
      <ul ref={attachSidebarTree} role="presentation" className="flex flex-col gap-px">
        {props.entries.map(({ thread, reason }) => {
          const key = scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
          return (
            <SidebarNeedsYouEntry
              key={key}
              thread={thread}
              reason={reason}
              isActive={props.activeKey === key}
              projectName={
                props.projectNameByKey.get(`${thread.environmentId}:${thread.projectId}`) ?? null
              }
              onOpen={props.onOpen}
            />
          );
        })}
      </ul>
    </section>
  );
}

const SidebarNeedsYouEntry = memo(function SidebarNeedsYouEntry(props: {
  thread: EnvironmentThreadShell;
  reason: NeedsYouReason;
  isActive: boolean;
  projectName: string | null;
  onOpen: (threadRef: ScopedThreadRef) => void;
}) {
  const { thread, reason, onOpen } = props;
  const threadRef = scopeThreadRef(thread.environmentId, thread.id);
  const verb = NEEDS_YOU_VERB[reason];
  return (
    <li className="list-none">
      <button
        type="button"
        data-sidebar-row={`needs-you:${scopedThreadKey(threadRef)}`}
        aria-current={props.isActive ? "page" : undefined}
        aria-label={[`${verb}: ${thread.title}`, props.projectName].filter(Boolean).join(", ")}
        onClick={() => onOpen(threadRef)}
        className={cn(
          "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          props.isActive
            ? "bg-sidebar-row-active text-sidebar-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-row-hover",
        )}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">
          <SidebarAttentionDot attention={reason === "failed" ? "failed" : "attention"} />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <span className="text-secondary-label">{verb}: </span>
          {thread.title}
        </span>
      </button>
    </li>
  );
});
