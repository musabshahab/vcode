import type { OrchestrationMessageContext } from "@codenine/contracts";
import { hasTeamRequest } from "@codenine/shared/composerContextReferences";
import { UsersIcon } from "lucide-react";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Marks a message the user sent with Team on. */
export function UserMessageTeamRequestTag(props: {
  readonly context: OrchestrationMessageContext | undefined;
}) {
  if (props.context === undefined || !hasTeamRequest(props.context.records)) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            className="me-1 flex items-center justify-end gap-1 text-xs leading-none text-muted-foreground"
            data-user-message-team-request=""
          />
        }
      >
        <UsersIcon aria-hidden="true" className="size-3" />
        Team requested
      </TooltipTrigger>
      <TooltipPopup side="top">
        Sent with Team on: the lead agent plans a team before any work starts
      </TooltipPopup>
    </Tooltip>
  );
}
