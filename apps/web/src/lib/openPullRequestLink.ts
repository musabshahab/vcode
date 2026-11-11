import type { EnvironmentId, ScopedThreadRef } from "@codenine/contracts";
import { type MouseEvent } from "react";

import { sourceControlClients } from "@codenine/client-runtime/source-control-clients";

import { openExternalLink } from "./openExternalLink";
import { useClientSettings } from "../hooks/useSettings";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { selectActiveRightPanel, useRightPanelStore } from "../rightPanelStore";
import {
  selectThreadBranchBaseRef,
  selectThreadDiffPanelSelection,
  useDiffPanelStore,
} from "../diffPanelStore";

import { readProject, readThreadShell } from "../state/entities";
import { reviewEnvironment } from "../state/review";
import { useAtomQueryRunner } from "../state/use-atom-query-runner";

function shouldOpenPullRequestExternally(
  event: Pick<MouseEvent<HTMLElement>, "metaKey" | "ctrlKey"> &
    Partial<Pick<MouseEvent<HTMLElement>, "button">>,
): boolean {
  return event.metaKey || event.ctrlKey || event.button === 1;
}

export function useOpenChangeRequestLink(
  threadRef?: ScopedThreadRef,
): (
  event: Pick<
    MouseEvent<HTMLElement>,
    "preventDefault" | "stopPropagation" | "metaKey" | "ctrlKey"
  > &
    Partial<Pick<MouseEvent<HTMLElement>, "button" | "shiftKey" | "altKey">>,
  targetUrl: string,
  targetThreadRef?: ScopedThreadRef,
  targetEnvironmentId?: EnvironmentId,
  onCommitUnavailable?: () => void,
) => boolean {
  const ignoreWhitespace = useClientSettings((settings) => settings.diffIgnoreWhitespace);
  const readDiffPreview = useAtomQueryRunner(reviewEnvironment.diffPreview, {
    reportFailure: false,
    refresh: true,
  });
  return (event, targetUrl, targetThreadRef, targetEnvironmentId, onCommitUnavailable) => {
    if (shouldOpenPullRequestExternally(event)) return false;
    const resolvedThreadRef = targetThreadRef ?? threadRef;
    const commitThread = resolvedThreadRef ? readThreadShell(resolvedThreadRef) : null;
    const commitProject =
      commitThread && resolvedThreadRef
        ? readProject({
            environmentId: resolvedThreadRef.environmentId,
            projectId: commitThread.projectId,
          })
        : null;
    const identity = commitProject?.repositoryIdentity;
    const parsedCommit = sourceControlClients.parseCommitUrl(targetUrl, identity?.provider);
    // Shift and Alt keep their browser meaning (new window, download) on commit links.
    if (parsedCommit !== null && (event.shiftKey || event.altKey)) return false;
    if (
      parsedCommit !== null &&
      commitThread &&
      resolvedThreadRef &&
      commitProject?.environmentId === resolvedThreadRef.environmentId &&
      identity &&
      identity.provider === parsedCommit.definition.kind &&
      parsedCommit.definition.isChangeRequestInRepository(identity, parsedCommit.link)
    ) {
      const commit = parsedCommit.link;
      event.preventDefault();
      event.stopPropagation();
      const userActionRevision = useRightPanelStore.getState().markUserAction(resolvedThreadRef);
      const baseRef = selectThreadBranchBaseRef(useDiffPanelStore.getState(), resolvedThreadRef);
      const selection = selectThreadDiffPanelSelection(
        useDiffPanelStore.getState().byThreadKey,
        resolvedThreadRef,
      );
      void readDiffPreview({
        environmentId: resolvedThreadRef.environmentId,
        input: {
          cwd: commitThread.worktreePath ?? commitProject.workspaceRoot,
          ...(baseRef ? { baseRef } : {}),
          commitSha: commit.sha,
          ignoreWhitespace,
        },
      })
        .then((result) => {
          if (
            useRightPanelStore.getState().getUserActionRevision(resolvedThreadRef) !==
              userActionRevision ||
            selectThreadDiffPanelSelection(
              useDiffPanelStore.getState().byThreadKey,
              resolvedThreadRef,
            ) !== selection
          )
            return;
          if (
            result._tag === "Success" &&
            result.value.sources.some(
              (source) => source.kind === "commit" && source.headRef === commit.sha,
            )
          ) {
            const diffOpen =
              selectActiveRightPanel(
                useRightPanelStore.getState().byThreadKey,
                resolvedThreadRef,
              ) === "diff";
            useDiffPanelStore.getState().selectCommit(resolvedThreadRef, commit.sha, !diffOpen);
            useRightPanelStore.getState().open(resolvedThreadRef, "diff");
            return;
          }
          if (onCommitUnavailable) return onCommitUnavailable();
          // A popup opened after the lookup has lost the click's activation, so browsers block it.
          if (window.desktopBridge === undefined) {
            const toastId = toastManager.add(
              stackedThreadToast({
                type: "info",
                title: "This commit is not in the thread's workspace",
                actionProps: {
                  children: "Open link",
                  onClick: () => {
                    toastManager.close(toastId);
                    window.open(targetUrl, "_blank", "noopener,noreferrer");
                  },
                },
              }),
            );
            return;
          }
          return openExternalLink(targetUrl);
        })
        .catch((error: unknown) => console.error(error));
      return true;
    }
    return false;
  };
}

export function useOpenPrLink(threadRef?: ScopedThreadRef) {
  const openChangeRequest = useOpenChangeRequestLink(threadRef);
  return (event: MouseEvent<HTMLElement>, prUrl: string, targetThreadRef?: ScopedThreadRef) => {
    if (event.button > 1) return false;
    event.stopPropagation();
    const openInBrowser = shouldOpenPullRequestExternally(event);
    const isAnchor =
      event.currentTarget instanceof HTMLAnchorElement && event.currentTarget.href.length > 0;
    // Native links handle modified clicks; buttons still need openExternal.
    if (openInBrowser && isAnchor) return false;

    event.preventDefault();
    if (!openInBrowser && openChangeRequest(event, prUrl, targetThreadRef)) return true;

    void openExternalLink(prUrl).catch((error: unknown) => {
      console.error(error);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Unable to open pull request link",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
    });
    return false;
  };
}
