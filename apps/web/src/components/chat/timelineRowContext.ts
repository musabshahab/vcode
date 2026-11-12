import type { ToolCallDiffTarget } from "../../diffPanelStore";
import type {
  ProviderApprovalDecision,
  RuntimeRequestId,
  WorktreeSetupSnapshot,
} from "@codenine/contracts";
import {
  type EnvironmentId,
  type MessageId,
  type OrchestrationV2TurnItem,
  type RunAttemptId,
  type ScopedThreadRef,
  type ServerProviderSkill,
  type RunId,
  ThreadId,
  type TurnItemId,
} from "@codenine/contracts";
import type { AsyncResult, Atom } from "effect/reactivity";
import type { CommandOutputView } from "@codenine/client-runtime/state/command-output";
import type { WorkflowOpening } from "@codenine/client-runtime/state/subagentRuntime";
import type { TeamAssignment } from "@codenine/client-runtime/team";
import { createContext, type MouseEvent } from "react";
import { type LegendListRef } from "@legendapp/list/react";
import type { CodexArtifactTemplate } from "@codenine/shared/codexArtifactTemplates";
import type { PendingApproval } from "../../session-logic";
import { type ChatFileAttachment } from "../../types";
import { ExpandedImagePreview } from "./ExpandedImagePreview";
import { type AssistantCitationTarget } from "./AssistantCitationSource";
import { type MessagesTimelineRow, type WorkGroupScrollAnchor } from "./MessagesTimeline.logic";
import { type TimestampFormat } from "@codenine/contracts/settings";
import type { TurnItemDetailSource } from "../../state/queries";
import { type HandoffTimelineRun } from "./V2LifecycleRow";

/**
 * Where an expanded row reads an item's detail and a command's output, when not from the
 * environment.
 */
export interface TurnItemSource {
  readonly detail: TurnItemDetailSource;
  readonly commandOutput: (target: {
    readonly threadId: ThreadId;
    readonly itemId: TurnItemId;
  }) => Atom.Atom<AsyncResult.AsyncResult<CommandOutputView, unknown>>;
}

export interface TimelineRowSharedState {
  pendingApprovals: ReadonlyMap<RuntimeRequestId, PendingApproval>;
  respondingRequestIds: ReadonlyArray<RuntimeRequestId>;
  canOperateThread: boolean;
  onRespondToApproval:
    | ((requestId: RuntimeRequestId, decision: ProviderApprovalDecision) => Promise<unknown>)
    | undefined;
  citationRequest: AssistantCitationTarget | null;
  listRef: React.RefObject<LegendListRef | null>;
  timestampFormat: TimestampFormat;
  routeThreadKey: string;
  threadRef: ScopedThreadRef | null;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  workspaceRoot: string | undefined;
  skills: ReadonlyArray<ServerProviderSkill>;
  runs: ReadonlyArray<HandoffTimelineRun>;
  activeThreadEnvironmentId: EnvironmentId;
  onRevertToTurnCount: (targetTurnCount: number, messageId: MessageId) => void;
  onUseArtifactTemplate: (template: CodexArtifactTemplate) => void;
  onRunShellCommand: ((command: string) => void) | undefined;
  findActive: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  displayThreadKey?: string;
  onOpenToolDiff: ((target: ToolCallDiffTarget) => void) | undefined;
  /** Unset where there is no diff to open, so the timeline shows no "Open diff" button. */
  onOpenTurnDiff: ((runId: RunId, filePath?: string) => void) | undefined;
  /** Unset, expanded rows read detail and command output from the environment. */
  turnItemSource: TurnItemSource | undefined;
  onOpenThread: (threadId: OrchestrationV2TurnItem["threadId"]) => void;
  workflowOpening: WorkflowOpening | null;
  /** On a team agent's thread, its opening brief, which shows as an assignment card. */
  teamAssignment: TeamAssignment | null;
  /** Absent hides "Fork from this response". */
  onForkFromRun:
    | ((input: { readonly sourceThreadId: ThreadId; readonly runId: RunId }) => Promise<void>)
    | undefined;
  onToggleTurnFold: (runId: RunId) => void;
  onToggleAttemptFold: (attemptId: RunAttemptId) => void;
  onFileOpen: (attachment: ChatFileAttachment) => void;
  onFileDownload: (attachment: ChatFileAttachment) => void;
  openPullRequest: (event: MouseEvent<HTMLElement>, url: string) => void;
  onToggleWorkGroup: (groupId: string, anchorKey: string) => void;
  onToggleWorkEntry: (anchorKey: string, collapsed: boolean) => void;
  onCancelWorktreeSetup: (() => void) | null;
  retryableWorkspacePreparationRunIds: ReadonlySet<RunId>;
  onRetryWorkspacePreparation: ((runId: RunId) => void) | null;
  onWorktreeSetupWorkLocally: (() => void) | null;
  onOpenWorktreeSetupTerminal: ((terminalId: string) => void) | null;
  workGroupViewState: WorkGroupViewState;
}

export interface TimelineRowActivityState {
  isWorking: boolean;
  isCompacting: boolean;
  isRevertingCheckpoint: boolean;
  awaitingUser: boolean;
  isPreparingWorktree: boolean;
  latestRunId: RunId | null;
  backgroundWorktreeSetup: WorktreeSetupSnapshot | null;
  liveAnswerPreview: string | null;
}

export const TimelineRowCtx = createContext<TimelineRowSharedState>(null!);

export const TimelineRowActivityCtx = createContext<TimelineRowActivityState>(null!);

export interface WorkGroupViewState {
  scrollPositions: Map<string, WorkGroupScrollAnchor>;
  expandedEntries: Set<string>;
}

export const WorkGroupViewCtx = createContext<{
  state: WorkGroupViewState;
  onToggleEntry: (collapsed: boolean) => void;
} | null>(null);

export type TimelineWorkEntry = Extract<
  MessagesTimelineRow,
  { kind: "work" }
>["groupedEntries"][number];

export type TimelineRow = MessagesTimelineRow;
