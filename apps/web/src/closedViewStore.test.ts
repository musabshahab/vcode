import { scopeThreadRef } from "@codenine/client-runtime/environment";
import { type EnvironmentId, ThreadId } from "@codenine/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { type ClosedViewEntry, useClosedViewStore } from "./closedViewStore";

const refA = scopeThreadRef("env-1" as EnvironmentId, ThreadId.make("thread-A"));
const refB = scopeThreadRef("env-2" as EnvironmentId, ThreadId.make("thread-A"));
const diff = (threadRef: typeof refA) =>
  ({ kind: "panel-tab", threadRef, surface: { kind: "diff", id: "diff" } }) as const;

beforeEach(() => {
  useClosedViewStore.setState({ entries: [] });
});

describe("closedViewStore", () => {
  it.each([
    { id: "bad", kind: "browser", threadRef: refA, snapshot: {} },
    { id: "bad", kind: "panel-tab", surface: { kind: "diff", id: "diff" } },
    { id: "bad", kind: "panel-tab", threadRef: refA },
    { id: "bad", kind: "panel-tab", threadRef: {}, surface: { kind: "diff", id: "diff" } },
    { id: "bad", kind: "panel-tab", threadRef: refA, surface: {} },
    { id: "bad", kind: "panel-tab", threadRef: refA, surface: { kind: "file", id: "file:x" } },
    {
      id: "bad",
      kind: "panel-tab",
      threadRef: refA,
      surface: { kind: "device", id: "device:x", target: {} },
    },
    {
      id: "bad",
      kind: "panel-tab",
      threadRef: refA,
      surface: { kind: "pull-request", id: "pull-request:x", repository: "owner/repo", number: 1 },
    },
    {
      id: "bad",
      kind: "panel-tab",
      threadRef: refA,
      surface: { kind: "side-chat", id: "side-chat:x" },
    },
  ])("discards incomplete saved views %j while retaining valid history", async (entry) => {
    const id = useClosedViewStore.getState().remember(diff(refA));
    const { storage, name } = useClosedViewStore.persist.getOptions();
    await storage!.setItem(name!, {
      state: { entries: [entry as ClosedViewEntry, ...useClosedViewStore.getState().entries] },
      version: 1,
    });
    await useClosedViewStore.persist.rehydrate();
    expect(useClosedViewStore.persist.hasHydrated()).toBe(true);
    expect(useClosedViewStore.getState().entries).toEqual([{ ...diff(refA), id }]);
    expect(() => useClosedViewStore.getState().remember(diff(refB))).not.toThrow();
  });
});
