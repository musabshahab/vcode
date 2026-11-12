import { scopeProjectRef, scopeThreadRef } from "@codenine/client-runtime/environment";
import { planProjectRemoval } from "@codenine/client-runtime/state/projects";
import { mapAtomCommandResult, settlePromise } from "@codenine/client-runtime/state/runtime";
import { useRouter } from "@tanstack/react-router";

import { useComposerDraftStore } from "../composerDraftStore";
import { releaseProjectDraftUploads } from "../lib/composerDraftUploads";
import { readLocalApi } from "../localApi";
import type { SidebarProjectGroupMember } from "../sidebarProjectGrouping";
import { readThreadShells, waitForProjectRemoval } from "../state/entities";
import { readUnloadedThreadCount } from "../state/olderSettledShelf";
import { projectEnvironment } from "../state/projects";
import { useOrchestrationCommand } from "../state/use-orchestration-command";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { checkProjectAccess, reportProjectFailure } from "./useProjectGroupUpdate";

/**
 * Confirms, then removes project checkouts and their threads. With `deleteFolder`, each
 * checkout's folder is deleted on its machine too. Resolves true once every member is gone.
 */
export function useProjectRemoval() {
  const router = useRouter();
  const deleteProject = useOrchestrationCommand(projectEnvironment.delete, {
    reportFailure: false,
  });

  return async (input: {
    readonly members: ReadonlyArray<SidebarProjectGroupMember>;
    readonly groupMemberCount: number;
    readonly hasOtherMembers: boolean;
    readonly displayName: string;
    readonly deleteFolder?: boolean;
  }): Promise<boolean> => {
    const { members } = input;
    const deleteFolder = input.deleteFolder === true;
    const verb = deleteFolder ? "delete" : "remove";
    const failureTitle = `Failed to ${verb} project`;
    if (checkProjectAccess(members, failureTitle)) return false;
    const api = readLocalApi();
    if (!api) return false;

    const threads = readThreadShells();
    const { projectThreads, confirmationMessage } = planProjectRemoval({
      ...input,
      threads,
      unloadedThreadCount: readUnloadedThreadCount(members, threads),
    });
    const confirmed = await settlePromise(() =>
      api.dialogs.confirm(confirmationMessage, { variant: "destructive" }),
    );
    if (confirmed._tag === "Failure" || !confirmed.value) return false;
    if (checkProjectAccess(members, failureTitle)) return false;

    const draftStore = useComposerDraftStore.getState();
    for (const member of members) {
      if (checkProjectAccess([member], failureTitle)) return false;
      const memberThreads = projectThreads.filter(
        (thread) => thread.environmentId === member.environmentId && thread.projectId === member.id,
      );
      const result = mapAtomCommandResult(
        await deleteProject({
          environmentId: member.environmentId,
          input: { projectId: member.id, force: true, ...(deleteFolder ? { deleteFolder } : {}) },
        }),
        () => undefined,
      );
      if (result._tag === "Failure") {
        reportProjectFailure(`Failed to ${verb} "${member.title}"`, result);
        return false;
      }
      const projectRef = scopeProjectRef(member.environmentId, member.id);
      await waitForProjectRemoval(projectRef);
      // Read the route after deletion; the user may have moved on while it ran.
      const routeTarget = resolveThreadRouteTarget(
        router.state.matches[router.state.matches.length - 1]?.params ?? {},
      );
      const routeDraft =
        routeTarget?.kind === "draft" ? draftStore.getDraftSession(routeTarget.draftId) : null;
      const viewingMember =
        routeTarget?.kind === "server"
          ? memberThreads.some(
              (thread) =>
                thread.environmentId === routeTarget.threadRef.environmentId &&
                thread.id === routeTarget.threadRef.threadId,
            )
          : routeDraft?.environmentId === member.environmentId &&
            routeDraft.projectId === member.id;
      releaseProjectDraftUploads(
        projectRef,
        memberThreads.map((thread) => scopeThreadRef(thread.environmentId, thread.id)),
      );
      const projectDraftThread = draftStore.getDraftThreadByProjectRef(projectRef);
      if (projectDraftThread) {
        draftStore.clearDraftThread(projectDraftThread.draftId);
      }
      draftStore.clearProjectDraftThreadId(projectRef);
      if (viewingMember) void router.navigate({ to: "/", replace: true });
    }
    return true;
  };
}
