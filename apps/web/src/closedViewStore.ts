import { scopedThreadKey } from "@codenine/client-runtime/environment";
import { ChatFileAttachment, ScopedThreadRef } from "@codenine/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { randomUUID } from "./lib/utils";
import { type RightPanelSurface } from "./rightPanelStore";

export type ClosedView = {
  kind: "panel-tab";
  threadRef: ScopedThreadRef;
  surface: Exclude<RightPanelSurface, { kind: "terminal" }>;
};

export type ClosedViewEntry = ClosedView & { id: string };

interface ClosedViewStoreState {
  entries: ClosedViewEntry[];
  remember: (view: ClosedView) => string;
  defer: (id: string) => void;
  remove: (id: string) => void;
}

const sameTarget = (entry: ClosedViewEntry, view: ClosedView): boolean => {
  if (
    entry.kind !== view.kind ||
    scopedThreadKey(entry.threadRef) !== scopedThreadKey(view.threadRef)
  ) {
    return false;
  }
  return entry.surface.id === view.surface.id;
};

const isThreadRef = Schema.is(ScopedThreadRef);
const isAttachment = Schema.is(ChatFileAttachment);

const isClosedViewEntry = (entry: unknown): entry is ClosedViewEntry => {
  const view = entry as ClosedViewEntry | null;
  if (!view || typeof view.id !== "string" || !isThreadRef(view.threadRef)) return false;
  if (view.kind !== "panel-tab") return false;
  const surface = view.surface;
  if (!surface || typeof surface.id !== "string") return false;
  switch (surface.kind) {
    case "diff":
    case "files":
    case "task":
      return surface.id === surface.kind;
    case "file":
      return (
        typeof surface.relativePath === "string" &&
        (surface.revealLine === null || Number.isSafeInteger(surface.revealLine)) &&
        Number.isSafeInteger(surface.revealRequestId) &&
        (surface.attachment === undefined || isAttachment(surface.attachment))
      );
    case "side-chat":
      return typeof surface.threadId === "string" && surface.id === `side-chat:${surface.threadId}`;
    default:
      return false;
  }
};

export const useClosedViewStore = create<ClosedViewStoreState>()(
  persist(
    (set) => ({
      entries: [],
      remember: (view) => {
        const id = randomUUID();
        set((state) => ({
          entries: [
            { ...view, id },
            ...state.entries.filter((entry) => !sameTarget(entry, view)),
          ].slice(0, 20),
        }));
        return id;
      },
      defer: (id) =>
        set((state) => {
          const entry = state.entries.find((entry) => entry.id === id);
          return entry
            ? { entries: [...state.entries.filter((entry) => entry.id !== id), entry] }
            : state;
        }),
      remove: (id) =>
        set((state) => ({ entries: state.entries.filter((entry) => entry.id !== id) })),
    }),
    {
      name: "codenine:closed-views:v2",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
      version: 2,
      migrate: (persisted) => {
        const entries = (persisted as Partial<Pick<ClosedViewStoreState, "entries">> | null)
          ?.entries;
        return {
          entries: Array.isArray(entries) ? entries.filter(isClosedViewEntry) : [],
        };
      },
      partialize: ({ entries }) => ({ entries }),
    },
  ),
);
