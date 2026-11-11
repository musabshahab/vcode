import type { RunId, ScopedThreadRef } from "@codenine/contracts";
import { scopedThreadKey } from "@codenine/client-runtime/environment";
import { useEffect, useRef } from "react";
import { useDiffPanelStore } from "../diffPanelStore";
import { useRightPanelStore } from "../rightPanelStore";
import type { TurnDiffSummary } from "../types";
import {
  observeProactivePanelUserChoice,
  resolveProactiveTurnDiffAction,
  shouldOpenProactiveTurnDiff,
} from "../components/ChatView.logic";

/**
 * Opens the right panel on its own when a turn just completed with a diff.
 * A panel the user opened or closed since wins; see observeProactivePanelUserChoice.
 */
export function useProactivePanels(input: {
  // Null for drafts and while the thread is unavailable.
  readonly threadRef: ScopedThreadRef | null;
  readonly enabled: boolean;
  readonly settingsHydrated: boolean;
  readonly threadDetailLoading: boolean;
  readonly runningTurnId: RunId | null;
  readonly latestRun: { readonly runId: RunId; readonly status: string } | null;
  readonly latestRunSettled: boolean;
  readonly turnDiffSummaries: ReadonlyArray<TurnDiffSummary>;
  readonly isGitRepo: boolean | undefined;
  readonly onDiffPanelOpen: (() => void) | undefined;
}) {
  const {
    threadRef,
    enabled: proactivePanelsEnabled,
    settingsHydrated: clientSettingsHydrated,
    threadDetailLoading,
    runningTurnId: activeRunningTurnId,
    latestRun: activeLatestRun,
    latestRunSettled,
    turnDiffSummaries,
    isGitRepo,
    onDiffPanelOpen,
  } = input;
  const proactivePanelObservationRef = useRef<ReturnType<
    typeof observeProactivePanelUserChoice
  > | null>(null);
  const threadKey = threadRef ? scopedThreadKey(threadRef) : null;

  // oxlint-disable-next-line codenine/no-unreasoned-state-sync -- opens the diff surface in the right panel store as runs complete
  useEffect(() => {
    if (threadKey === null || threadRef === null) {
      proactivePanelObservationRef.current = null;
      return;
    }
    const panels = useRightPanelStore.getState();
    const observation = observeProactivePanelUserChoice(proactivePanelObservationRef.current, {
      threadKey: threadKey,
      runningTurnId: activeRunningTurnId,
      userActionRevision: panels.getUserActionRevision(threadRef),
    });
    proactivePanelObservationRef.current = observation;
    const { runningTurnId: previousRunningTurnId, userActionRevision } = observation;
    if (!clientSettingsHydrated || threadDetailLoading) return;

    const settledTurnId = latestRunSettled ? (activeLatestRun?.runId ?? null) : null;
    const newlyCompletedTurnId = shouldOpenProactiveTurnDiff({
      previousRunningTurnId,
      runningTurnId: activeRunningTurnId,
      settledTurnId,
      turnCompleted: activeLatestRun?.status === "completed",
    })
      ? settledTurnId
      : null;
    const eligibleCompletion = proactivePanelsEnabled && newlyCompletedTurnId !== null;
    const completedCheckpoint = eligibleCompletion
      ? turnDiffSummaries.find((checkpoint) => checkpoint.runId === newlyCompletedTurnId)
      : undefined;
    const diffAction = eligibleCompletion
      ? resolveProactiveTurnDiffAction({
          checkpoint: completedCheckpoint,
          isGitRepo,
        })
      : "ignore";
    proactivePanelObservationRef.current = {
      ...observation,
      // Preserve first-entry eligibility while the checkpoint or repository load.
      runningTurnId: diffAction === "defer" ? previousRunningTurnId : activeRunningTurnId,
    };
    if (diffAction !== "open" || newlyCompletedTurnId === null) return;
    if (
      !panels.openProactive(
        threadRef,
        { kind: "diff", turnId: newlyCompletedTurnId },
        userActionRevision,
      )
    ) {
      return;
    }
    useDiffPanelStore.getState().selectGitScope(threadRef, "branch");
    onDiffPanelOpen?.();
  }, [
    activeLatestRun?.runId,
    activeLatestRun?.status,
    activeRunningTurnId,
    clientSettingsHydrated,
    isGitRepo,
    latestRunSettled,
    onDiffPanelOpen,
    proactivePanelsEnabled,
    threadDetailLoading,
    threadKey,
    threadRef,
    turnDiffSummaries,
  ]);
}
