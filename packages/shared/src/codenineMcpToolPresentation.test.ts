import { describe, expect, it } from "vite-plus/test";

import {
  CODENINE_MCP_TOOL_NAMES,
  resolveCodenineMcpSummaryAction,
  resolveCodenineMcpToolDefinition,
  resolveCodenineMcpToolPresentation,
} from "./codenineMcpToolPresentation.ts";

describe("resolveCodenineMcpToolPresentation", () => {
  it("recognizes every Codenine tool across provider prefixes and completion suffixes", () => {
    for (const tool of CODENINE_MCP_TOOL_NAMES) {
      const presentation = resolveCodenineMcpToolPresentation(tool);
      for (const prefix of [
        "mcp__codenine__",
        "Codenine.",
        "codenine.",
        "codenine-direct.",
        "mcp__codenine_direct__",
        "codenine/",
        "codenine:",
        "mcp_codenine_",
        "Codenine ",
        "codenine · ",
      ]) {
        expect(resolveCodenineMcpToolPresentation(`${prefix}${tool} completed`), tool).toEqual(
          presentation,
        );
      }
      expect(resolveCodenineMcpToolPresentation(`mcp__another-server__${tool}`), tool).toBeNull();
    }
  });
});

describe("resolveCodenineMcpToolDefinition", () => {
  it("labels an action tool call as the action it ran", () => {
    expect(
      resolveCodenineMcpToolDefinition("mcp__codenine__codenine_queue", { action: "edit" })?.labels,
    ).toEqual(resolveCodenineMcpToolDefinition("codenine_queue_edit")?.labels);
    expect(
      resolveCodenineMcpToolDefinition("codenine_thread_transfer", { action: "fork" })?.displayName,
    ).toBe(resolveCodenineMcpToolDefinition("codenine_thread_fork")?.displayName);
    expect(
      resolveCodenineMcpToolDefinition("codenine_queue", { action: "unknown" })?.labels[2],
    ).toBe("Managed");
  });
});

describe("resolveCodenineMcpSummaryAction", () => {
  it("summarizes an action tool by the action each call ran", () => {
    expect(
      resolveCodenineMcpSummaryAction("mcp__codenine__codenine_queue", { action: "list" }),
    ).toBe("queue-list");
    expect(resolveCodenineMcpSummaryAction("codenine_queue", { action: "edit" })).toBe(
      "queue-edit",
    );
    expect(resolveCodenineMcpSummaryAction("codenine_thread_transfer", { action: "status" })).toBe(
      "thread-transfers",
    );
    expect(resolveCodenineMcpSummaryAction("codenine_thread_configure", {})).toBe(
      "thread-configuration",
    );
    expect(resolveCodenineMcpSummaryAction("delegate_task", { task: "x" })).toBe("delegate");
  });
});
