// @effect-diagnostics globalTimers:off - Shelf placement timers run in web and native clients, outside an Effect runtime.
import { threadRuntimeIsActive, type EnvironmentThreadShell } from "./models.ts";
import { toSortableTimestamp } from "./threadSort.ts";
import { effectiveSnoozed } from "./threadSettled.ts";

type WorkingThreadInput = Pick<
  EnvironmentThreadShell,
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "interactionMode"
  | "latestRun"
  | "runtime"
>;

export function isThreadWorking(thread: WorkingThreadInput): boolean {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return false;
  if (thread.pendingSubagentRequest != null) return false;
  if (!threadRuntimeIsActive(thread.runtime) && thread.runtime?.status !== "idle") return false;
  const run = thread.latestRun;
  const runSettled =
    run !== null &&
    run.status !== "preparing" &&
    run.status !== "queued" &&
    run.status !== "starting" &&
    run.status !== "running" &&
    run.status !== "waiting" &&
    thread.runtime?.activeRunId !== run.runId;
  return !(thread.interactionMode === "plan" && thread.hasActionableProposedPlan && runSettled);
}

export type SidebarThreadStatus =
  | "approval"
  | "input"
  | "preparing"
  | "working"
  | "waiting"
  | "failed"
  | "limited"
  | "ready";

type SidebarThreadStatusInput = Pick<
  EnvironmentThreadShell,
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "runtime"
  | "blockedOnThreadWait"
>;

export function resolveSidebarThreadStatus(thread: SidebarThreadStatusInput): SidebarThreadStatus {
  if (thread.hasPendingApprovals || thread.pendingSubagentRequest === "approval") {
    return "approval";
  }
  if (thread.hasPendingUserInput || thread.pendingSubagentRequest === "user_input") {
    return "input";
  }
  if (thread.runtime?.status === "running" && thread.blockedOnThreadWait === true) {
    return "waiting";
  }
  if (thread.runtime?.status === "preparing") {
    return "preparing";
  }
  if (
    thread.runtime !== null &&
    ["queued", "starting", "running", "waiting"].includes(thread.runtime.status)
  ) {
    return "working";
  }
  if (thread.runtime?.status === "idle") {
    return "waiting";
  }
  if (thread.runtime?.status === "failed") {
    return thread.runtime.lastErrorClass === "usage_limit" ? "limited" : "failed";
  }
  return "ready";
}

/** Why a thread waits on the user: a request it holds, or the team plan it leads. */
export type NeedsYouReason = "approval" | "question" | "review" | "failed";

const NEEDS_YOU_ORDER: ReadonlyArray<NeedsYouReason> = ["approval", "question", "review", "failed"];

export type NeedsYouInput = SidebarThreadStatusInput & {
  readonly source?: Pick<EnvironmentThreadShell["source"], "teamSummary">;
};

export function needsYouReason(thread: NeedsYouInput): NeedsYouReason | null {
  const status = resolveSidebarThreadStatus(thread);
  if (status === "approval") return "approval";
  if (status === "input") return "question";
  const team = thread.source?.teamSummary?.status;
  if (team === "proposed") return "review";
  if (team === "failed") return "failed";
  return null;
}

/**
 * One entry per thread that waits on the user, the most pressing reason first and otherwise in
 * the order given. Pass the threads listed as open work, team tasks included: a snoozed or done
 * thread stays out until it wakes or the user brings it back.
 */
export function selectNeedsYou<T extends NeedsYouInput>(
  threads: ReadonlyArray<T>,
): ReadonlyArray<{ readonly thread: T; readonly reason: NeedsYouReason }> {
  return threads
    .flatMap((thread) => {
      const reason = needsYouReason(thread);
      return reason === null ? [] : [{ thread, reason }];
    })
    .toSorted(
      (left, right) => NEEDS_YOU_ORDER.indexOf(left.reason) - NEEDS_YOU_ORDER.indexOf(right.reason),
    );
}

type InboxThreadInput = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "createdAt" | "unsettledAt" | "latestRun"
>;

export function sortInboxThreadsByReturn<T extends InboxThreadInput>(
  threads: readonly T[],
  observedReturnAt?: (thread: T) => number | undefined,
): T[] {
  const timestamps = new Map(
    threads.map((thread) => [
      thread,
      Math.max(
        toSortableTimestamp(thread.createdAt) ?? 0,
        toSortableTimestamp(thread.unsettledAt ?? undefined) ?? 0,
        toSortableTimestamp(thread.latestRun?.requestedAt ?? undefined) ?? 0,
        toSortableTimestamp(thread.latestRun?.completedAt ?? undefined) ?? 0,
        observedReturnAt?.(thread) ?? 0,
      ),
    ]),
  );
  return sortNewestFirst(threads, timestamps);
}

type WorkingSortInput = Pick<
  EnvironmentThreadShell,
  "id" | "environmentId" | "createdAt" | "latestRun" | "latestUserAuthoredMessageAt"
>;

export function sortWorkingThreadsBySend<T extends WorkingSortInput>(threads: readonly T[]): T[] {
  const timestamps = new Map(
    threads.map((thread) => [
      thread,
      Math.max(
        toSortableTimestamp(thread.createdAt) ?? 0,
        toSortableTimestamp(
          (thread.latestUserAuthoredMessageAt === undefined
            ? thread.latestRun?.requestedAt
            : thread.latestUserAuthoredMessageAt) ?? undefined,
        ) ?? 0,
      ),
    ]),
  );
  return sortNewestFirst(threads, timestamps);
}

function sortNewestFirst<T extends Pick<EnvironmentThreadShell, "id" | "environmentId">>(
  threads: readonly T[],
  timestamps: ReadonlyMap<T, number>,
): T[] {
  return [...threads].sort(
    (left, right) =>
      timestamps.get(right)! - timestamps.get(left)! ||
      left.id.localeCompare(right.id) ||
      left.environmentId.localeCompare(right.environmentId),
  );
}

type TrackedInboxThread = WorkingThreadInput &
  InboxThreadInput &
  Partial<
    Pick<
      EnvironmentThreadShell,
      | "archivedAt"
      | "deletedAt"
      | "pinnedAt"
      | "settledOverride"
      | "settledAt"
      | "snoozedAt"
      | "snoozedUntil"
      | "activeOrderKey"
    >
  >;

type ThreadKeyInput = Pick<EnvironmentThreadShell, "environmentId" | "id">;

/**
 * How long a thread that stopped working keeps reading as working. An orchestrator
 * run can end moments before its continuation starts, so clients wait this long
 * before treating the thread as done.
 */
const WORKING_EXIT_GRACE_MS = 2_000;

/**
 * Keep one at module scope so placement survives routes that unmount the list. Call
 * `observe` when the shells or the snapshot version change, or with null while the beta
 * is off. Its result stays fixed, so a list built from it can be cached.
 */
export function createInboxReturnTracker() {
  const keyOf = (thread: ThreadKeyInput) => `${thread.environmentId}:${thread.id}`;
  const states = new Map<
    string,
    { working: boolean; deadline: number | null; placement: string | null }
  >();
  const returns = new Map<string, number>();
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let version = 0;
  const now = () => {
    // @effect-diagnostics-next-line globalDate:off - The grace deadline is wall-clock time shared by web and native clients.
    return Date.now();
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = undefined;
    let next = Infinity;
    for (const state of states.values()) {
      if (state.deadline !== null) next = Math.min(next, state.deadline);
    }
    if (next === Infinity) return;
    timer = setTimeout(
      () => {
        const at = now();
        for (const [key, state] of states) {
          if (state.deadline !== null && state.deadline <= at) {
            state.working = false;
            state.deadline = null;
            returns.set(key, at);
          }
        }
        schedule();
        version++;
        for (const listener of listeners) listener();
      },
      Math.max(0, next - now()),
    );
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => version,
    observe(threads: readonly TrackedInboxThread[] | null): {
      readonly isWorking: (thread: WorkingThreadInput & ThreadKeyInput) => boolean;
      readonly returnedAt: (thread: ThreadKeyInput) => number | undefined;
    } {
      if (threads === null) {
        clearTimeout(timer);
        timer = undefined;
        states.clear();
        returns.clear();
        return { isWorking: isThreadWorking, returnedAt: () => undefined };
      }
      const present = new Set<string>();
      const at = now();
      // @effect-diagnostics-next-line globalDate:off - Snooze checks compare wall-clock ISO times.
      const observedAt = new Date(at).toISOString();
      for (const thread of threads) {
        const key = keyOf(thread);
        present.add(key);
        const previous = states.get(key);
        const actual = isThreadWorking(thread);
        const placement =
          actual || previous?.working
            ? JSON.stringify([
                thread.archivedAt,
                thread.deletedAt,
                thread.pinnedAt,
                thread.settledOverride,
                thread.settledAt,
                thread.snoozedAt,
                thread.snoozedUntil,
                thread.activeOrderKey,
              ])
            : null;
        const actionable =
          thread.hasPendingApprovals ||
          thread.hasPendingUserInput ||
          thread.pendingSubagentRequest != null ||
          (thread.interactionMode === "plan" && thread.hasActionableProposedPlan) ||
          thread.runtime?.lastError != null ||
          thread.latestRun?.status === "failed";
        const moved = previous !== undefined && previous.placement !== placement;
        const excluded =
          thread.archivedAt != null ||
          thread.deletedAt != null ||
          thread.pinnedAt != null ||
          thread.settledOverride === "settled" ||
          effectiveSnoozed(thread, { now: observedAt });
        // Only shelf placement is held: execution state and attention requests stay authoritative.
        const deadline =
          !actual && previous?.working && !actionable && !moved && !excluded
            ? (previous.deadline ?? at + WORKING_EXIT_GRACE_MS)
            : null;
        const working = actual || (deadline !== null && deadline > at);
        if (previous?.working && !working) returns.set(key, at);
        states.set(key, { working, deadline: working ? deadline : null, placement });
      }
      for (const key of states.keys()) {
        if (!present.has(key)) {
          states.delete(key);
          returns.delete(key);
        }
      }
      schedule();
      const observedWorking = new Map<string, boolean>();
      states.forEach((state, key) => observedWorking.set(key, state.working));
      const observedReturns = new Map(returns);
      return {
        isWorking: (thread) => observedWorking.get(keyOf(thread)) ?? isThreadWorking(thread),
        returnedAt: (thread) => observedReturns.get(keyOf(thread)),
      };
    },
    isWorking: (thread: WorkingThreadInput & ThreadKeyInput) =>
      states.get(keyOf(thread))?.working ?? isThreadWorking(thread),
    returnedAt: (thread: ThreadKeyInput) => returns.get(keyOf(thread)),
  };
}
