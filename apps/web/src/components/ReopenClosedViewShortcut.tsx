import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@codenine/client-runtime/environment";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef } from "react";

import { isCommandPaletteOpen } from "../commandPaletteBus";
import { useClosedViewStore } from "../closedViewStore";
import { useComposerDraftStore } from "../composerDraftStore";
import { environmentCatalog } from "../connection/catalog";
import { resolveShortcutCommand } from "../keybindings";
import { isEditableFocused } from "../lib/editableFocus";
import { isTerminalFocused } from "../lib/terminalFocus";
import { isModelPickerOpen } from "../modelPickerVisibility";
import { planNextReopen, reopenClosedView } from "../reopenClosedView";
import { selectThreadRightPanelState, useRightPanelStore } from "../rightPanelStore";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { readProject, readThreadShell } from "../state/entities";
import { primaryServerKeybindingsAtom } from "../state/server";
import { environmentShell } from "../state/shell";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../terminalUiStateStore";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  resolveThreadRouteTarget,
} from "../threadRoutes";
import { toastManager } from "./ui/toast";

export function ReopenClosedViewShortcut() {
  const navigate = useNavigate();
  const params = useParams({ strict: false });
  const target = resolveThreadRouteTarget(params);
  const draft = useComposerDraftStore((state) =>
    target?.kind === "draft" ? state.getDraftSession(target.draftId) : null,
  );
  const threadRef =
    target?.kind === "server"
      ? target.threadRef
      : draft
        ? (draft.promotedTo ?? scopeThreadRef(draft.environmentId, draft.threadId))
        : null;
  const terminalOpen = useTerminalUiStateStore(
    (state) =>
      selectThreadTerminalUiState(state.terminalUiStateByThreadKey, threadRef).terminalOpen,
  );
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const pending = useRef(Promise.resolve());

  const reopenNext = useEffectEvent(async () => {
    const catalog = appAtomRegistry.get(environmentCatalog.catalogValueAtom);
    const drafts = useComposerDraftStore.getState();
    const panelsByThread = useRightPanelStore.getState().byThreadKey;
    const { drop, restore } = planNextReopen(useClosedViewStore.getState().entries, (entry) => {
      const ref = entry.threadRef;
      const panel = selectThreadRightPanelState(panelsByThread, ref);
      return {
        environmentKnown: catalog.entries.has(ref.environmentId),
        catalogReady: catalog.isReady,
        ownerExists: readThreadShell(ref) !== null || drafts.getDraftThreadByRef(ref) !== null,
        sideChatExists:
          entry.surface.kind !== "side-chat" ||
          readThreadShell(scopeThreadRef(ref.environmentId, entry.surface.threadId)) !== null,
        shellLive:
          appAtomRegistry.get(environmentShell.stateValueAtom(ref.environmentId)).status === "live",
        panel,
      };
    });
    for (const entry of drop) useClosedViewStore.getState().remove(entry.id);
    if (!restore) return;

    const ref = restore.threadRef;
    const thread = readThreadShell(ref);
    const owner = thread ?? drafts.getDraftThreadByRef(ref);
    const project = owner ? readProject(scopeProjectRef(ref.environmentId, owner.projectId)) : null;
    if (!reopenClosedView(restore, { workspaceAvailable: project !== null })) {
      useClosedViewStore.getState().defer(restore.id);
      return;
    }
    useClosedViewStore.getState().remove(restore.id);
    const draftId = thread === null ? drafts.getDraftIdByRef(ref) : null;
    if (draftId !== null)
      await navigate({ to: "/draft/$draftId", params: buildDraftThreadRouteParams(draftId) });
    else await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(ref) });
  });

  const enqueueReopen = useEffectEvent(() => {
    pending.current = pending.current
      .then(() => reopenNext())
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not reopen view",
          description: error instanceof Error ? error.message : String(error),
        });
      });
  });

  // oxlint-disable-next-line codenine/no-unreasoned-state-sync -- subscribes to window keydown and the desktop menu action for the reopen closed view shortcut
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        isCommandPaletteOpen() ||
        useClosedViewStore.getState().entries.length === 0 ||
        (event.target instanceof HTMLElement && event.target.closest("[data-keybinding-capture]"))
      )
        return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          editableFocus: isEditableFocused(event.target),
          modelPickerOpen: isModelPickerOpen(),
        },
      });
      if (command !== "view.reopenClosed") return;
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) enqueueReopen();
    };
    window.addEventListener("keydown", onKeyDown, true);
    const unsubscribe = window.desktopBridge?.onMenuAction((action) => {
      if (action === "view.reopenClosed" && !isCommandPaletteOpen()) enqueueReopen();
    });
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      unsubscribe?.();
    };
  }, [keybindings, terminalOpen]);

  return null;
}
