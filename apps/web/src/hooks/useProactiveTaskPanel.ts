import { scopedThreadKey } from "@codenine/client-runtime/environment";
import type { RunId, ScopedThreadRef, TeamPlanId } from "@codenine/contracts";
import { useEffect, useRef } from "react";

import { observeProactivePanelUserChoice } from "../components/ChatView.logic";
import { useRightPanelStore } from "../rightPanelStore";

/**
 * Opens the Task tab on its own when a lead's plan waits for approval, and on a team's thread
 * whose panel this device never set. Each plan is offered once, so a tab the user closed stays
 * closed; a choice the user made since the current turn started wins over the turn's proposal.
 */
export function useProactiveTaskPanel(input: {
  // Null where the panel is a sheet or absent, so nothing pops up over the conversation.
  readonly threadRef: ScopedThreadRef | null;
  readonly planId: TeamPlanId | null;
  readonly awaitingApproval: boolean;
  readonly runningTurnId: RunId | null;
}) {
  const { threadRef, planId, awaitingApproval, runningTurnId } = input;
  const observationRef = useRef<ReturnType<typeof observeProactivePanelUserChoice> | null>(null);
  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;

  // oxlint-disable-next-line codenine/no-unreasoned-state-sync -- opens the task surface in the right panel store when a team plan appears
  useEffect(() => {
    if (threadKey === null || threadRef === null) {
      observationRef.current = null;
      return;
    }
    const panels = useRightPanelStore.getState();
    const observation = observeProactivePanelUserChoice(observationRef.current, {
      threadKey,
      runningTurnId,
      userActionRevision: panels.getUserActionRevision(threadRef),
    });
    observationRef.current = observation;
    if (planId === null) return;
    panels.openProactiveTask(
      threadRef,
      { planId, awaitingApproval },
      observation.userActionRevision,
    );
  }, [awaitingApproval, planId, runningTurnId, threadKey, threadRef]);
}
