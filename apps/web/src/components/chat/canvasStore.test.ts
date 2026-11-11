import { EnvironmentId, ThreadId } from "@codenine/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  createChatCanvasStore,
  resolveChatCanvasModel,
  type ChatCanvasMeasurements,
} from "./canvasStore";

const threadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const otherThreadRef = { ...threadRef, threadId: ThreadId.make("thread-2") };
const measurements = (width: number, height = 900): ChatCanvasMeasurements => ({
  width,
  height,
  padding: 48,
  maxChatWidth: 768,
  minChatWidth: 640,
  timelineGutter: 0,
  findBar: null,
});

describe("chat canvas model", () => {
  it("shows the details card inline only where the canvas fits it beside the chat", () => {
    const resolve = (width: number) =>
      resolveChatCanvasModel({
        measurements: measurements(width),
        detailsCardMeasurement: null,
        threadRef,
        detailsCardInlineOpen: true,
      }).detailsCardMode;
    expect(resolve(1400)).toBe("inline");
    expect(resolve(900)).toBe("popover");
  });

  it("ignores a details card measured for another thread", () => {
    const chatWidth = (measuredRef: typeof threadRef) =>
      resolveChatCanvasModel({
        measurements: measurements(1100),
        detailsCardMeasurement: { threadRef: measuredRef, width: 280, fullContentHeight: 400 },
        threadRef,
        detailsCardInlineOpen: true,
      }).layout.chat.width;
    expect(chatWidth(otherThreadRef)).toBe(768);
    expect(chatWidth(threadRef)).toBe(728);
  });

  it("keeps state identity when a measurement repeats", () => {
    const store = createChatCanvasStore();
    store.getState().setMeasurements(measurements(1400));
    const before = store.getState();
    store.getState().setMeasurements(measurements(1400));
    store.getState().measureDetailsCard({ threadRef, width: 280, fullContentHeight: 300 });
    const measured = store.getState();
    store.getState().measureDetailsCard({ threadRef, width: 280, fullContentHeight: 300 });
    expect(measured.measurements).toBe(before.measurements);
    expect(store.getState()).toBe(measured);
  });
});
