import { isListedThreadLineage } from "@codenine/contracts";

import type { EnvironmentProject, EnvironmentThreadShell } from "./models.ts";

export function planProjectRemoval<
  Thread extends Pick<EnvironmentThreadShell, "environmentId" | "projectId" | "lineage">,
>(options: {
  readonly members: ReadonlyArray<
    Pick<EnvironmentProject, "id" | "environmentId" | "title" | "workspaceRoot"> & {
      readonly environmentLabel?: string | null;
    }
  >;
  readonly groupMemberCount: number;
  readonly hasOtherMembers: boolean;
  readonly displayName: string;
  readonly threads: ReadonlyArray<Thread>;
  /** The members' threads this client does not hold: older settled threads its shell left out. */
  readonly unloadedThreadCount?: number;
  /** Also delete each member's folder on its machine. */
  readonly deleteFolder?: boolean;
}) {
  const { members, groupMemberCount, hasOtherMembers, displayName, threads } = options;
  const deleteFolder = options.deleteFolder === true;
  const memberKeys = new Set(members.map((member) => `${member.environmentId}:${member.id}`));
  const projectThreads = threads.filter((thread) =>
    memberKeys.has(`${thread.environmentId}:${thread.projectId}`),
  );
  // Side chats and subagents go with their parent but never show in thread lists.
  const threadCount =
    projectThreads.filter((thread) => isListedThreadLineage(thread.lineage)).length +
    (options.unloadedThreadCount ?? 0);
  const isWholeGroup = members.length === groupMemberCount;
  const targetKind = hasOtherMembers || !isWholeGroup ? "checkout" : "project";
  const singleMember = members.length === 1 ? members[0]! : null;
  const targetLabel = singleMember?.title ?? displayName;
  const chatsLabel = `${threadCount} chat${threadCount === 1 ? "" : "s"}`;
  const confirmationMessage = [
    deleteFolder
      ? `Delete ${targetKind} "${targetLabel}" and its folder?`
      : threadCount > 0
        ? `Remove ${targetKind} "${targetLabel}" and its ${chatsLabel}?`
        : `Remove ${targetKind} "${targetLabel}"?`,
    ...(singleMember
      ? [
          `${deleteFolder ? "Folder" : "Path"}: ${singleMember.workspaceRoot}`,
          ...(singleMember.environmentLabel
            ? [`Environment: ${singleMember.environmentLabel}`]
            : []),
        ]
      : [
          `This removes ${members.length} grouped project entries.`,
          ...(deleteFolder ? members.map((member) => `Folder: ${member.workspaceRoot}`) : []),
        ]),
    ...(deleteFolder
      ? [
          `This permanently deletes ${singleMember ? "the folder" : "each folder"} and everything in it, including uncommitted work and the worktrees Codenine made for its chats.`,
        ]
      : []),
    threadCount > 0 && deleteFolder
      ? `Its ${chatsLabel} and any archived chats are deleted from Codenine.`
      : "Any archived chats are deleted from Codenine.",
    ...(deleteFolder && isWholeGroup && !hasOtherMembers
      ? []
      : [
          isWholeGroup && !hasOtherMembers
            ? "Files on disk are kept."
            : "Other entries in this grouped project are unaffected.",
        ]),
    "This can't be undone.",
  ].join("\n");

  return { projectThreads, isWholeGroup, targetKind, confirmationMessage };
}
