import { lazy, Suspense, useState } from "react";
import { isElectron } from "~/env";
import { FileSurfaceLoading } from "./fileSurfaceChrome";
import type { PdfViewState } from "./PdfViewer";

export const isPdfPreviewFile = (path: string): boolean =>
  /\.pdf$/i.test(path.split(/[?#]/, 1)[0] ?? "");

export const isHtmlPreviewFile = (path: string): boolean =>
  /\.html?$/i.test(path.split(/[?#]/, 1)[0] ?? "");

const PdfViewer = lazy(() => import("./PdfViewer"));

// The document stays mounted while each revision gets a fresh PDF.js document.
function PdfDocument(props: { src: string; title: string; documentKey: string }) {
  const [view, setView] = useState<PdfViewState>({ page: 0, offset: 0, zoom: null, left: 0 });
  return (
    <PdfDocumentRevision
      key={props.documentKey}
      src={props.src}
      title={props.title}
      positionKey={props.documentKey}
      initialView={view}
      onViewChange={setView}
    />
  );
}

// Keep signed URL renewals from reloading the same revision.
function PdfDocumentRevision(props: {
  src: string;
  title: string;
  positionKey: string;
  initialView: PdfViewState;
  onViewChange: (view: PdfViewState) => void;
}) {
  const [src] = useState(props.src);
  // The Electron shell does not enable PDF plugins. WebKit embeds on iOS
  // expose only the first page, even when pdfViewerEnabled reports support.
  const native =
    !isElectron &&
    navigator.pdfViewerEnabled &&
    !/iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !(navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return native ? (
    // oxlint-disable-next-line react/iframe-missing-sandbox -- Chromium's PDF plugin requires an unsandboxed frame; src is an exact-file asset grant.
    <iframe
      src={`${src.split("#", 1)[0]}#navpanes=0&view=FitH`}
      title={props.title}
      className="block h-full min-h-0 w-full flex-1 border-0 bg-white"
    />
  ) : (
    <Suspense fallback={<FileSurfaceLoading />}>
      <PdfViewer
        src={src}
        title={props.title}
        positionKey={props.positionKey}
        initialView={props.initialView}
        onViewChange={props.onViewChange}
      />
    </Suspense>
  );
}

/**
 * HTML runs in a sandboxed frame with an opaque origin, so a page cannot reach
 * the app's session or storage. PDFs use a native viewer or the lazy PDF.js fallback.
 */
export function BrowserDocumentFrame(props: {
  readonly src: string;
  readonly title: string;
  readonly pdf: boolean;
  /** Stable resource identity and revision; defaults to src for callers that reload on URL changes. */
  readonly documentKey?: string | undefined;
  /** Resource identity without its revision, so PDF reloads can retain the reading position. */
  readonly documentId?: string | undefined;
}) {
  const key = props.documentKey ?? props.src;
  return props.pdf ? (
    <PdfDocument
      key={props.documentId ?? key}
      documentKey={key}
      src={props.src}
      title={props.title}
    />
  ) : (
    <FileDocument key={key} src={props.src} title={props.title} />
  );
}

// URL renewals must not discard form input or scroll; a new key mounts a fresh document.
function FileDocument(props: { readonly src: string; readonly title: string }) {
  const [src] = useState(props.src);
  return (
    <iframe
      src={src}
      title={props.title}
      className="min-h-0 flex-1 border-0 bg-white"
      sandbox="allow-scripts allow-forms allow-popups allow-downloads"
    />
  );
}
