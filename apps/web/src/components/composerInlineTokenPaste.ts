import { ComposerContextId } from "@codenine/contracts";
import type {
  ComposerContextClipboardFragment,
  ComposerContextRecord,
  ScopedThreadRef,
} from "@codenine/contracts";
import {
  COMPOSER_CONTEXT_CLIPBOARD_MIME,
  decodeComposerContextFragment,
  decodeComposerContextClipboardHtml,
} from "@codenine/shared/composerContextClipboard";
import {
  collectComposerContextReferences,
  formatComposerContextReference,
  replaceComposerContextReferences,
  threadLinkContextReferences,
} from "@codenine/shared/composerContextReferences";

import { configuredHostedAppUrl } from "~/hostedPairing";
import { readThreadShell } from "~/state/entities";

const threadTitle = (ref: ScopedThreadRef) => readThreadShell(ref)?.title;

/** Pasted thread links count as context too, so they become chips like a copied chip does. */
export function readPastedComposerContext(
  clipboardData: Pick<DataTransfer, "getData">,
): ComposerContextClipboardFragment | null {
  const pastedText = clipboardData.getData("text/plain");
  const decodedFragment =
    decodeComposerContextFragment(clipboardData.getData(COMPOSER_CONTEXT_CLIPBOARD_MIME)) ??
    decodeComposerContextClipboardHtml(clipboardData.getData("text/html"));
  const threads = threadLinkContextReferences(
    pastedText,
    decodedFragment?.records ?? [],
    threadTitle,
    { hostedAppUrl: configuredHostedAppUrl() },
  );
  const source =
    decodedFragment?.source ??
    (threads.records[0] ? { environmentId: threads.records[0].environmentId } : null);
  if (source === null) return null;
  const pastedIds = new Set<string>(
    collectComposerContextReferences(threads.text).map((occurrence) => occurrence.contextId),
  );
  const records = new Map<string, ComposerContextRecord>();
  for (const record of [...(decodedFragment?.records ?? []), ...threads.records]) {
    records.set(record.contextId, record);
  }
  return {
    version: 1,
    source,
    records: [...records.values()].filter((record) => pastedIds.has(record.contextId)),
  };
}

export function importPastedComposerText(
  clipboardData: Pick<DataTransfer, "getData">,
  importContextFragment?: (
    fragment: ComposerContextClipboardFragment,
  ) => ReadonlyMap<string, string>,
): string {
  const pastedText = clipboardData.getData("text/plain");
  const fragment = importContextFragment ? readPastedComposerContext(clipboardData) : null;
  const rewrittenIds =
    fragment && fragment.records.length > 0 ? importContextFragment!(fragment) : null;
  if (!rewrittenIds || rewrittenIds.size === 0) return pastedText;
  const nextId = (contextId: string) => {
    const id = rewrittenIds.get(contextId);
    return id ? ComposerContextId.make(id) : undefined;
  };
  const text = replaceComposerContextReferences(pastedText, (occurrence) => {
    const contextId = nextId(occurrence.contextId);
    return contextId
      ? formatComposerContextReference({ ...occurrence, contextId })
      : occurrence.source;
  });
  // A thread the import refused, on a machine this agent cannot read, stays the link it was.
  return threadLinkContextReferences(text, fragment?.records ?? [], threadTitle, {
    accept: (record) => nextId(record.contextId),
    hostedAppUrl: configuredHostedAppUrl(),
  }).text;
}
