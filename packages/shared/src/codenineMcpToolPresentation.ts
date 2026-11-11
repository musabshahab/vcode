export type CodenineMcpToolLogo = "codenine";

export interface CodenineMcpToolPresentation {
  readonly displayName: string;
  readonly logo: CodenineMcpToolLogo;
}

export type CodenineMcpToolSummaryAction =
  | "capabilities"
  | "delegate"
  | "task-status"
  | "task-cancel"
  | "thread-create"
  | "thread-list"
  | "thread-read"
  | "thread-send"
  | "thread-wait"
  | "thread-interrupt"
  | "workflow-stop"
  | "background-wait"
  | "thread-configuration"
  | "thread-configure"
  | "thread-fork"
  | "thread-merge"
  | "thread-search"
  | "thread-transfers"
  | "thread-organize"
  | "thread-update"
  | "queue-list"
  | "queue-read"
  | "queue-edit"
  | "queue-cancel"
  | "queue-reorder"
  | "queue-steer"
  | "question-list"
  | "question-read"
  | "question-respond"
  | "secret-request"
  | "worktree-handoff"
  | "worktree-list"
  | "worktree-status"
  | "project-list"
  | "project-read"
  | "project-create"
  | "project-update"
  | "project-delete"
  | "project-clone"
  | "environment-read"
  | "environment-update"
  | "attachment-prepare"
  | "attachment-discard"
  | "attachment-send"
  | "link-pr"
  | "unlink-pr"
  | "list-prs"
  | "watch-pr"
  | "unwatch-pr";

export interface CodenineMcpToolDefinition {
  readonly displayName: string;
  readonly labels: readonly [action: string, running: string, completed: string, detail: string];
  readonly icon: "codenine" | "pull-request";
  readonly summaryAction: CodenineMcpToolSummaryAction;
}

function tool(
  labels: CodenineMcpToolDefinition["labels"],
  summaryAction: CodenineMcpToolSummaryAction,
  icon: CodenineMcpToolDefinition["icon"] = "codenine",
  displayName = `${labels[0]} ${labels[3]}`,
): CodenineMcpToolDefinition {
  return { displayName, labels, icon, summaryAction };
}

// Codex registers "codenine-direct" for Codenine tools kept out of Code Mode.
const CODENINE_MCP_SERVER_ALIASES = new Set(["codenine", "codenine-direct", "codenine_direct"]);

const CODENINE_MCP_TOOLS: Readonly<Record<string, CodenineMcpToolDefinition>> = {
  link_pull_request: tool(
    ["Link", "Linking", "Linked", "a pull request"],
    "link-pr",
    "pull-request",
  ),
  link_pull_requests: tool(
    ["Link", "Linking", "Linked", "pull requests"],
    "link-pr",
    "pull-request",
  ),
  unlink_pull_request: tool(
    ["Unlink", "Unlinking", "Unlinked", "a pull request"],
    "unlink-pr",
    "pull-request",
  ),
  unlink_pull_requests: tool(
    ["Unlink", "Unlinking", "Unlinked", "pull requests by state"],
    "unlink-pr",
    "pull-request",
  ),
  list_thread_pull_requests: tool(
    ["Check", "Checking", "Checked", "linked pull requests"],
    "list-prs",
    "pull-request",
  ),
  watch_pull_request: tool(
    ["Watch", "Watching", "Watching", "a pull request"],
    "watch-pr",
    "pull-request",
  ),
  unwatch_pull_request: tool(
    ["Stop watching", "Unwatching", "Stopped watching", "a pull request"],
    "unwatch-pr",
    "pull-request",
  ),
  orchestrator_capabilities: tool(
    ["Get", "Getting", "Got", "orchestration capabilities"],
    "capabilities",
  ),
  delegate_task: tool(["Delegate", "Delegating", "Delegated", "a child task"], "delegate"),
  task_status: tool(["Get", "Getting", "Got", "delegated task status"], "task-status"),
  task_cancel: tool(
    ["Cancel", "Canceling", "Requested cancellation of", "a delegated task"],
    "task-cancel",
  ),
  request_secret: tool(["Ask for", "Asking for", "Asked for", "a secret"], "secret-request"),
  create_threads: tool(["Create", "Creating", "Created", "Codenine threads"], "thread-create"),
  codenine_thread_start: tool(
    ["Start", "Starting", "Started", "a Codenine thread"],
    "thread-create",
  ),
  codenine_thread_list: tool(["List", "Listing", "Listed", "Codenine threads"], "thread-list"),
  codenine_thread_read: tool(["Read", "Reading", "Read", "a Codenine thread"], "thread-read"),
  codenine_thread_send: tool(["Send", "Sending", "Sent", "to a Codenine thread"], "thread-send"),
  codenine_thread_wait: tool(["Wait", "Waiting", "Waited", "for a Codenine thread"], "thread-wait"),
  codenine_workflow_stop: tool(
    ["Stop", "Stopping", "Requested a stop for", "a workflow"],
    "workflow-stop",
  ),
  codenine_background_wait: tool(
    ["Update", "Updating", "Updated", "background waits"],
    "background-wait",
  ),
  codenine_thread_interrupt: tool(
    ["Interrupt", "Interrupting", "Requested an interrupt of", "a Codenine thread"],
    "thread-interrupt",
  ),
  codenine_worktree_handoff: tool(
    ["Hand off", "Handing off", "Handed off", "thread to a git worktree"],
    "worktree-handoff",
  ),
  codenine_worktree_status: tool(
    ["Get", "Getting", "Got", "thread worktree status"],
    "worktree-status",
  ),
  codenine_queue: tool(["Manage", "Managing", "Managed", "queued messages"], "queue-edit"),
  codenine_pending_request: tool(
    ["Handle", "Handling", "Handled", "pending questions"],
    "question-respond",
  ),
  codenine_queue_list: tool(["List", "Listing", "Listed", "queued messages"], "queue-list"),
  codenine_queue_read: tool(["Read", "Reading", "Read", "a queued message"], "queue-read"),
  codenine_queue_edit: tool(["Edit", "Editing", "Edited", "a queued message"], "queue-edit"),
  codenine_queue_cancel: tool(
    ["Cancel", "Canceling", "Requested cancellation of", "a queued run"],
    "queue-cancel",
  ),
  codenine_queue_reorder: tool(
    ["Reorder", "Reordering", "Reordered", "a queued run"],
    "queue-reorder",
  ),
  codenine_queue_promote_to_steer: tool(
    ["Steer with", "Steering with", "Requested steering with", "a queued message"],
    "queue-steer",
  ),
  codenine_pending_request_list: tool(
    ["List", "Listing", "Listed", "pending questions"],
    "question-list",
  ),
  codenine_pending_request_read: tool(
    ["Read", "Reading", "Read", "pending questions"],
    "question-read",
  ),
  codenine_pending_request_respond: tool(
    ["Answer", "Answering", "Answered", "pending questions"],
    "question-respond",
  ),
  codenine_thread_configuration: tool(
    ["Read", "Reading", "Read", "thread configuration"],
    "thread-configuration",
  ),
  codenine_thread_configure: tool(
    ["Use", "Using", "Used", "thread model settings"],
    "thread-configure",
  ),
  codenine_thread_transfer: tool(["Use", "Using", "Used", "thread transfers"], "thread-fork"),
  codenine_thread_fork: tool(
    ["Fork", "Forking", "Requested a fork of", "this thread"],
    "thread-fork",
  ),
  codenine_thread_merge_back: tool(
    ["Merge", "Merging", "Requested a merge of", "thread context"],
    "thread-merge",
  ),
  codenine_thread_search: tool(
    ["Search", "Searching", "Searched", "thread content"],
    "thread-search",
  ),
  codenine_thread_transfers: tool(
    ["Read", "Reading", "Read", "thread transfers"],
    "thread-transfers",
  ),
  codenine_thread_organize: tool(
    ["Organize", "Organizing", "Organized", "a thread"],
    "thread-organize",
  ),
  codenine_thread_update: tool(
    ["Update", "Updating", "Updated", "Codenine thread metadata"],
    "thread-update",
  ),
  codenine_worktree_list: tool(
    ["List", "Listing", "Listed", "workspace branches"],
    "worktree-list",
  ),
  codenine_environment_read: tool(
    ["Read", "Reading", "Read", "environment preferences"],
    "environment-read",
  ),
  codenine_environment_preferences_update: tool(
    ["Update", "Updating", "Updated", "environment preferences"],
    "environment-update",
  ),
  codenine_thread_launch: tool(
    ["Launch", "Launching", "Launched", "a project thread"],
    "thread-create",
  ),
  codenine_project_list: tool(["List", "Listing", "Listed", "projects"], "project-list"),
  codenine_project_read: tool(["Read", "Reading", "Read", "a project"], "project-read"),
  codenine_project_create: tool(
    ["Register", "Registering", "Registered", "a project"],
    "project-create",
  ),
  codenine_project_update: tool(["Update", "Updating", "Updated", "a project"], "project-update"),
  codenine_project_delete: tool(["Delete", "Deleting", "Deleted", "a project"], "project-delete"),
  codenine_project_clone: tool(["Clone", "Cloning", "Cloned", "a repository"], "project-clone"),
  codenine_attachment_prepare_upload: tool(
    ["Prepare", "Preparing", "Prepared", "an attachment upload"],
    "attachment-prepare",
  ),
  codenine_attachment_discard: tool(
    ["Discard", "Discarding", "Discarded", "a pending attachment"],
    "attachment-discard",
  ),
  codenine_thread_send_attachments: tool(
    ["Send", "Sending", "Sent", "attachments"],
    "attachment-send",
  ),
};

export const CODENINE_MCP_TOOL_NAMES: ReadonlySet<string> = new Set(
  Object.keys(CODENINE_MCP_TOOLS),
);

function normalizeCodenineMcpToolLabel(value: string): string {
  return value.replace(/\s+(?:complete|completed)\s*$/i, "").trim();
}

// Timelines resolve every work row's tool name on each update; names repeat across updates.
// ACP titles can carry whole commands, so long labels are parsed but not kept.
const toolNameCache = new Map<string, string | null>();
const TOOL_NAME_CACHE_LIMIT = 10_000;
const TOOL_NAME_CACHE_MAX_KEY_LENGTH = 256;

function resolveCodenineMcpToolName(value: string): string | null {
  if (value.length > TOOL_NAME_CACHE_MAX_KEY_LENGTH) return parseCodenineMcpToolName(value);
  const cached = toolNameCache.get(value);
  if (cached !== undefined) return cached;
  const name = parseCodenineMcpToolName(value);
  if (toolNameCache.size >= TOOL_NAME_CACHE_LIMIT) toolNameCache.clear();
  toolNameCache.set(value, name);
  return name;
}

// ACP tool prefixes vary; match loosely but require a known display-name entry.
function parseCodenineMcpToolName(value: string): string | null {
  const label = normalizeCodenineMcpToolLabel(value);
  const mcpMatch = /^mcp__(?<server>.+?)__(?<tool>.+)$/i.exec(label);
  if (mcpMatch?.groups) {
    const { server, tool } = mcpMatch.groups;
    return server !== undefined &&
      tool !== undefined &&
      CODENINE_MCP_SERVER_ALIASES.has(server.toLowerCase())
      ? tool
      : null;
  }

  const namespaceMatch =
    /^(?<server>codenine[-_]direct|codenine)(?:[.:/]|\s*·\s*)(?<tool>.+)$/i.exec(label);
  if (namespaceMatch?.groups) {
    return namespaceMatch.groups.tool ?? null;
  }

  // Tool names can start with "codenine_" themselves, so a bare name is tried before the prefix.
  if (Object.hasOwn(CODENINE_MCP_TOOLS, label)) return label;
  const prefixed = /^(?:mcp[-_]{1,2})?codenine(?:__|[-_.:/ ])(?<tool>.+)$/i.exec(label);
  const candidate = prefixed?.groups?.tool;
  return candidate !== undefined && Object.hasOwn(CODENINE_MCP_TOOLS, candidate) ? candidate : null;
}

export function resolveCodenineMcpToolId(toolName: string | null | undefined): string | null {
  const name = toolName == null ? null : resolveCodenineMcpToolName(toolName);
  return name !== null && Object.hasOwn(CODENINE_MCP_TOOLS, name) ? name : null;
}

type SummaryInput = Readonly<Record<string, unknown>>;

const asSummaryInput = (input: unknown): SummaryInput | undefined =>
  typeof input === "object" && input !== null ? (input as SummaryInput) : undefined;

/** Action tools present each call as the single-purpose tool its action replaced. */
const ACTION_TOOLS: Readonly<Record<string, (action: string) => string | undefined>> = {
  codenine_queue: (action) => `codenine_queue_${action}`,
  codenine_pending_request: (action) => `codenine_pending_request_${action}`,
  codenine_thread_transfer: (action) =>
    ({
      fork: "codenine_thread_fork",
      merge_back: "codenine_thread_merge_back",
      status: "codenine_thread_transfers",
    })[action],
};

/** Pass the call's input so an action tool resolves to the labels and summary of its action. */
export function resolveCodenineMcpToolDefinition(
  toolName: string | null | undefined,
  input?: unknown,
): CodenineMcpToolDefinition | null {
  const name = toolName == null ? null : resolveCodenineMcpToolName(toolName);
  if (name === null || !Object.hasOwn(CODENINE_MCP_TOOLS, name)) return null;
  const action = asSummaryInput(input)?.action;
  const actionTool = typeof action === "string" ? ACTION_TOOLS[name]?.(action) : undefined;
  return actionTool !== undefined && Object.hasOwn(CODENINE_MCP_TOOLS, actionTool)
    ? CODENINE_MCP_TOOLS[actionTool]!
    : CODENINE_MCP_TOOLS[name]!;
}

/** Tools whose summary depends on which fields a call sets. */
const ACTION_SUMMARIES: Readonly<
  Record<string, (input: SummaryInput) => CodenineMcpToolSummaryAction | undefined>
> = {
  codenine_thread_configure: ({ modelSelection }) =>
    modelSelection === undefined ? "thread-configuration" : "thread-configure",
};

export function resolveCodenineMcpSummaryAction(
  toolName: string | null | undefined,
  input: unknown,
): CodenineMcpToolSummaryAction | null {
  const definition = resolveCodenineMcpToolDefinition(toolName, input);
  if (definition === null) return null;
  const summarize = ACTION_SUMMARIES[resolveCodenineMcpToolName(toolName!) ?? ""];
  const fields = asSummaryInput(input);
  return (fields && summarize?.(fields)) ?? definition.summaryAction;
}

export function resolveCodenineMcpToolPresentation(
  toolName: string | null | undefined,
  input?: unknown,
): CodenineMcpToolPresentation | null {
  const definition = resolveCodenineMcpToolDefinition(toolName, input);
  return definition === null ? null : { displayName: definition.displayName, logo: "codenine" };
}
