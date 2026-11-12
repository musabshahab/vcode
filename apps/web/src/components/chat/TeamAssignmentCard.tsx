import type { TeamAssignment } from "@codenine/client-runtime/team";
import { Link } from "@tanstack/react-router";
import { ArrowDownIcon, ClipboardListIcon } from "lucide-react";
import { use, useState } from "react";

import ChatMarkdown from "../ChatMarkdown";
import { Button, InlineButton } from "../ui/button";
import { findRevealRef } from "./markdownFindContext";
import { TeamResultText } from "./TeamResultText";
import { TimelineRowCtx } from "./timelineRowContext";
import { MESSAGE_HEADING_LEVEL } from "./TimelineRowParts";

/** An agent thread's opening brief, shown as the task the lead gave it and what it received. */
export function TeamAssignmentCard({ assignment }: { assignment: TeamAssignment }) {
  const ctx = use(TimelineRowCtx);
  const [expanded, setExpanded] = useState(false);
  const revealRef = findRevealRef(() => setExpanded(true));
  const markdown = (text: string) => (
    <ChatMarkdown
      text={text}
      cwd={ctx.markdownCwd}
      threadRef={ctx.threadRef ?? undefined}
      skills={ctx.skills}
      lineBreaks
      parseRawHtml={false}
      headingLevelOffset={MESSAGE_HEADING_LEVEL}
    />
  );
  return (
    <article
      aria-label="Assignment from the lead"
      className="relative flex min-w-0 flex-col gap-3 rounded-xl border px-4 py-3"
    >
      <div className="flex items-center gap-2">
        <ClipboardListIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="font-semibold">Assignment from the lead</h3>
      </div>
      {assignment.brief === null ? null : (
        <div data-thread-find-text="true">{markdown(assignment.brief)}</div>
      )}
      {assignment.received.map((received) => (
        <section
          key={received.taskId}
          aria-label={`Received from ${received.from}`}
          className="flex flex-col gap-1 rounded-lg bg-muted/40 p-3"
        >
          <p className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <ArrowDownIcon aria-hidden className="size-3.5 shrink-0" />
            Received from
            {received.threadId === null ? (
              <span className="font-medium text-foreground">{received.from}</span>
            ) : (
              <InlineButton
                render={
                  <Link
                    to="/$environmentId/$threadId"
                    params={{
                      environmentId: ctx.activeThreadEnvironmentId,
                      threadId: received.threadId,
                    }}
                  />
                }
              >
                {received.from}
              </InlineButton>
            )}
          </p>
          <div data-thread-find-text="true">
            <TeamResultText text={received.result ?? "No result was recorded."} />
          </div>
        </section>
      ))}
      {/* Find reads the DOM, so the full brief stays mounted, hidden, while find is open. */}
      {expanded || ctx.findActive ? (
        <div
          ref={revealRef}
          hidden={!expanded}
          data-thread-find-text="true"
          className="border-t pt-3"
        >
          {markdown(assignment.fullText)}
        </div>
      ) : null}
      <div className="-ms-1">
        <Button
          size="xs"
          variant="ghost-muted"
          aria-expanded={expanded}
          data-scroll-anchor-ignore
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Hide the full brief" : "Show the full brief"}
        </Button>
      </div>
    </article>
  );
}
