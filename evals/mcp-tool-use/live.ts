#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off
// Runs MCP tool-use cases through the real Claude Code or Codex harness, on the machine's own
// sign-in, so a subscription pays instead of an API key. See the README's "Live runs" section.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeReadline from "node:readline";
import * as NodeUtil from "node:util";
import { query } from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { expandTeamCommand } from "@t3tools/provider-core/server/orchestrationInstructions";
import { projectComposerContextForProvider } from "@t3tools/shared/composerContextReferences";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  buildCodexTurnStartParams,
  codexThreadRuntimeParams,
} from "../../apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts";
import { toMcpElicitationResponse } from "../../apps/server/src/provider/CodexMcpElicitation.ts";
import { buildCodexInitializeParams } from "../../apps/server/src/provider/CodexProvider.ts";
import {
  answerLiveToolCall,
  gradeSample,
  liveCall,
  liveSample,
  McpToolUseCase,
  readOnlyCommand,
  t3SystemAppend,
} from "./run.ts";

const CLAUDE_MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"] as const;
const T3_PREFIX = "mcp__t3-code__";
// Claude Code's own tools that only read or edit files. Beyond these it gets read-only shell
// commands and nothing else: no network and no native subagents, so a run changes nothing outside
// its temporary folder. Codex runs in its own sandbox, which allows the same.
const FILE_TOOLS: ReadonlySet<string> = new Set([
  "Read",
  "Glob",
  "Grep",
  "LS",
  "Edit",
  "Write",
  "TodoWrite",
  "ToolSearch",
]);
const WRITE_TOOLS: ReadonlySet<string> = new Set(["Edit", "Write"]);
/** The parts of a case's world a folder of files can stand in for. */
const WORLD_KEYS: ReadonlySet<string> = new Set(["repo", "branch", "status", "files", "commits"]);

const { values } = NodeUtil.parseArgs({
  options: {
    case: { type: "string" },
    harness: { type: "string", default: "claude" },
    model: { type: "string" },
    effort: { type: "string", default: "medium" },
    samples: { type: "string", default: "1" },
    "max-turns": { type: "string", default: "12" },
    claude: { type: "string" },
    codex: { type: "string" },
    out: { type: "string" },
  },
});
const harness = (["claude", "codex"] as const).find((candidate) => candidate === values.harness);
const claudeModel = CLAUDE_MODELS.find(
  (candidate) => candidate === (values.model ?? "claude-sonnet-5-5"),
);
const effort = (["low", "medium", "high", "xhigh", "max"] as const).find(
  (candidate) => candidate === values.effort,
);
// Codex takes any model id its sign-in or provider offers, so that one is not checked here.
const model = harness === "codex" ? values.model : claudeModel;
if (!values.out || harness === undefined || model === undefined || effort === undefined) {
  throw new Error(
    `Use --out <directory>, with --harness claude|codex, --effort low|medium|high|xhigh|max, and --model ${CLAUDE_MODELS.join("|")} for Claude Code or a model id for Codex.`,
  );
}
const out = values.out;
const samples = Math.max(1, Number(values.samples));
const maxTurns = Math.max(1, Number(values["max-turns"]));

// The person's installed harness, which holds their sign-in.
const onPath = NodeChildProcess.spawnSync("which", [harness], { encoding: "utf8" }).stdout.trim();
const binary = (harness === "codex" ? values.codex : values.claude) ?? onPath;
if (binary === "") throw new Error(`No ${harness} on PATH. Pass --${harness} <path to it>.`);
const services = Layer.merge(NodeServices.layer, FetchHttpClient.layer);
const decodeCase = Schema.decodeUnknownSync(McpToolUseCase);
const casesDirectory = NodePath.join(import.meta.dirname, "cases");
const allCases = NodeFS.readdirSync(casesDirectory)
  .filter((file) => file.endsWith(".ndjson"))
  .flatMap((file) =>
    NodeFS.readFileSync(NodePath.join(casesDirectory, file), "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => decodeCase(JSON.parse(line))),
  );

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Why a case cannot run live. A live run starts one fresh top-level session with file tools only. */
const skipReason = ({ setup, expect }: McpToolUseCase) => {
  if (setup.role !== "top") return "is not a top-level thread";
  if ((setup.priorTurns ?? []).length > 0) return "needs earlier turns replayed";
  if (setup.sideChat !== undefined) return "is a side chat";
  if (setup.harness !== undefined && setup.harness !== harness)
    return `runs only on ${setup.harness}`;
  // Commits and pull requests only show through a shell, which a live run does not have.
  const beyondFiles = Object.keys(setup.world ?? {}).filter((key) => !WORLD_KEYS.has(key));
  if (beyondFiles.length > 0) return `needs a simulated ${beyondFiles.join(", ")}`;
  if (expect.shellMust !== undefined || expect.shellMustNot !== undefined)
    return "checks shell commands against a simulated machine";
  return undefined;
};

const wanted = values.case?.split(",").map((id) => id.trim());
const selected = allCases.filter((testCase) =>
  wanted === undefined ? skipReason(testCase) === undefined : wanted.includes(testCase.id),
);
for (const id of wanted ?? []) {
  if (!allCases.some((testCase) => testCase.id === id)) throw new Error(`No case named ${id}.`);
}

/** A folder holding the case's files as a clean git repository. */
const makeWorkspace = (testCase: McpToolUseCase) => {
  const cwd = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-live-eval-"));
  const files = (testCase.setup.world as { readonly files?: unknown } | undefined)?.files;
  for (const [file, contents] of Object.entries(isRecord(files) ? files : {})) {
    if (typeof contents !== "string") continue;
    const target = NodePath.join(cwd, file);
    NodeFS.mkdirSync(NodePath.dirname(target), { recursive: true });
    NodeFS.writeFileSync(target, contents);
  }
  const git = (...args: ReadonlyArray<string>) =>
    NodeChildProcess.execFileSync(
      "git",
      ["-c", "user.name=eval", "-c", "user.email=eval@example.com", ...args],
      {
        cwd,
        stdio: "ignore",
      },
    );
  git("init", "-q", "-b", testCase.setup.world?.branch ?? "main");
  git("add", "-A");
  git("commit", "-q", "--allow-empty", "-m", "Initial commit");
  return cwd;
};

type Sample = Effect.Success<ReturnType<typeof liveSample>>;
type Call = ReturnType<typeof liveCall>;

/**
 * T3's MCP endpoint for one sample, over HTTP as in the product: the real tool names,
 * descriptions and schemas, answered from the case's mocks.
 */
const serveT3Tools = async (
  { sample, tools }: Sample,
  onCall: (name: string, input: unknown, failed: boolean) => void,
) => {
  const respond = async (request: unknown): Promise<unknown> => {
    if (!isRecord(request) || typeof request.method !== "string") return undefined;
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: request.id, result });
    const params = isRecord(request.params) ? request.params : {};
    switch (request.method) {
      case "initialize":
        return reply({
          protocolVersion: params.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "t3-code", version: "eval" },
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({
          tools: tools.map((tool) => ({
            name: tool.name.slice(T3_PREFIX.length),
            description: tool.description,
            inputSchema: tool.input_schema,
          })),
        });
      case "tools/call": {
        const name = `${T3_PREFIX}${String(params.name)}`;
        const input = params.arguments ?? {};
        const block = await Effect.runPromise(
          answerLiveToolCall(sample, {
            type: "tool_use",
            id: String(request.id),
            name,
            input,
          }).pipe(Effect.provide(services)),
        );
        onCall(name, input, block.is_error === true);
        return reply({
          content: [{ type: "text", text: typeof block.content === "string" ? block.content : "" }],
          isError: block.is_error === true,
        });
      }
      default:
        // Notifications carry no id and get no reply.
        return request.id === undefined
          ? undefined
          : { jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown method" } };
    }
  };
  const server = NodeHttp.createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      void Promise.all((Array.isArray(body) ? body : [body]).map(respond)).then((replies) => {
        const answered = replies.filter((entry) => entry !== undefined);
        if (answered.length === 0) {
          response.writeHead(202).end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(Array.isArray(body) ? answered : answered[0]));
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port for the tools.");
  return { url: `http://127.0.0.1:${address.port}/mcp`, close: () => server.close() };
};

type Run = { calls: Array<Call>; text: string; stopReason: string; finalText?: string };
type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  apiPriceUsd: number;
  turns: number;
};
type Session = {
  readonly testCase: McpToolUseCase;
  readonly sample: Sample;
  readonly cwd: string;
  readonly prompt: string;
  readonly run: Run;
  readonly usage: Usage;
};

const runClaude = async (
  { testCase, sample, cwd, prompt, run, usage }: Session,
  model: (typeof CLAUDE_MODELS)[number],
) => {
  const t3 = await serveT3Tools(sample, () => {});
  let step = 0;
  /** Why a tool call is refused, if it is. */
  const refusal = (name: string, input: unknown) => {
    if (name.startsWith(T3_PREFIX)) return undefined;
    if (name === "Bash") {
      const command = isRecord(input) ? input.command : undefined;
      return typeof command === "string" && readOnlyCommand(command, cwd)
        ? undefined
        : "Only read-only commands inside this folder run here, such as ls, cat, rg and git status.";
    }
    if (!FILE_TOOLS.has(name)) {
      return `${name} is not available here. Use the file tools and the T3 tools.`;
    }
    const file = isRecord(input) ? input.file_path : undefined;
    return WRITE_TOOLS.has(name) &&
      !(typeof file === "string" && !NodePath.relative(cwd, file).startsWith(".."))
      ? "Only files in this folder can be changed."
      : undefined;
  };
  try {
    const session = query({
      prompt,
      options: {
        model,
        effort,
        cwd,
        maxTurns: testCase.maxSteps ?? maxTurns,
        pathToClaudeCodeExecutable: binary,
        // The person's own settings, memory files and MCP servers stay out of the sample, and
        // the sample stays out of their session history.
        settingSources: [],
        persistSession: false,
        strictMcpConfig: true,
        mcpServers: { "t3-code": { type: "http", url: t3.url } },
        systemPrompt: { type: "preset", preset: "claude_code", append: t3SystemAppend(model) },
        // A hook sees every call. canUseTool alone would miss the commands Claude Code approves
        // by itself, such as read-only shell commands.
        hooks: {
          PreToolUse: [
            {
              hooks: [
                async (input) => {
                  const reason =
                    input.hook_event_name === "PreToolUse"
                      ? refusal(input.tool_name, input.tool_input)
                      : undefined;
                  return reason === undefined
                    ? {}
                    : {
                        hookSpecificOutput: {
                          hookEventName: "PreToolUse",
                          permissionDecision: "deny",
                          permissionDecisionReason: reason,
                        },
                      };
                },
              ],
            },
          ],
        },
        canUseTool: async (name, input) => {
          const reason = refusal(name, input);
          return reason === undefined
            ? { behavior: "allow", updatedInput: input }
            : { behavior: "deny", message: reason };
        },
      },
    });
    for await (const message of session) {
      if (message.type === "assistant") {
        step += 1;
        for (const block of message.message.content) {
          if (block.type === "text") run.text += `${block.text}\n`;
          if (block.type === "tool_use") {
            run.calls.push(
              liveCall(step, {
                type: "tool_use",
                id: block.id,
                name: block.name,
                input: block.input,
              }),
            );
          }
        }
      }
      if (message.type === "user" && Array.isArray(message.message.content)) {
        for (const block of message.message.content) {
          if (block.type !== "tool_result") continue;
          const call = run.calls.find((candidate) => candidate.id === block.tool_use_id);
          if (call !== undefined) call.failed = block.is_error === true;
        }
      }
      if (message.type === "result") {
        run.stopReason = message.subtype === "success" ? "end_turn" : message.subtype;
        if (message.subtype === "success") run.finalText = message.result;
        usage.input = message.usage.input_tokens;
        usage.output = message.usage.output_tokens;
        usage.cacheRead = message.usage.cache_read_input_tokens ?? 0;
        usage.cacheWrite = message.usage.cache_creation_input_tokens ?? 0;
        usage.apiPriceUsd = message.total_cost_usd;
        usage.turns = message.num_turns;
      }
    }
  } finally {
    t3.close();
  }
};

/** `codex app-server` over its line-delimited JSON-RPC, as T3 Code's Codex adapter drives it. */
const startCodex = (cwd: string) => {
  const child = NodeChildProcess.spawn(binary, ["app-server"], {
    cwd,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending = new Map<
    number,
    { readonly resolve: (result: unknown) => void; readonly reject: (error: Error) => void }
  >();
  const handlers: {
    notification: (method: string, params: unknown) => void;
    request: (method: string, params: unknown) => unknown;
  } = { notification: () => {}, request: () => ({}) };
  let nextId = 1;
  const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
  NodeReadline.createInterface({ input: child.stdout }).on("line", (line) => {
    const message: unknown = JSON.parse(line);
    if (!isRecord(message)) return;
    if (typeof message.method === "string") {
      if (message.id === undefined) handlers.notification(message.method, message.params);
      else send({ id: message.id, result: handlers.request(message.method, message.params) });
      return;
    }
    const waiting = typeof message.id === "number" ? pending.get(message.id) : undefined;
    if (waiting === undefined) return;
    pending.delete(Number(message.id));
    if (message.error === undefined) waiting.resolve(message.result);
    else waiting.reject(new Error(`Codex: ${JSON.stringify(message.error)}`));
  });
  child.on("exit", () => {
    for (const waiting of pending.values()) waiting.reject(new Error("Codex stopped."));
    handlers.notification("exit", undefined);
  });
  return {
    handlers,
    notify: (method: string) => send({ method }),
    request: (method: string, params: unknown) =>
      new Promise<unknown>((resolve, reject) => {
        const id = nextId++;
        pending.set(id, { resolve, reject });
        send({ id, method, params });
      }),
    close: () => child.kill(),
  };
};

const runCodex = async ({ testCase, sample, cwd, prompt, run, usage }: Session, model: string) => {
  const cap = (testCase.maxSteps ?? maxTurns) + 4;
  let steps = 0;
  let interrupt = () => {};
  const record = (name: string, input: unknown, failed: boolean) => {
    steps += 1;
    run.calls.push({
      ...liveCall(steps, { type: "tool_use", id: `call-${steps}`, name, input }),
      failed,
    });
    if (steps === cap) interrupt();
  };
  const t3 = await serveT3Tools(sample, record);
  const codex = startCodex(cwd);
  const runtimePolicy = {
    runtimeMode: "full-access",
    interactionMode: "default",
    cwd,
    // Commands stay inside the folder and off the network. What would leave it asks first, and
    // the answer below is no. "never" would also refuse T3's own tools.
    approvalPolicy: "on-request",
    sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: false },
  } as const;
  const modelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model,
    options: [{ id: "reasoningEffort", value: effort }],
  };
  try {
    await codex.request("initialize", buildCodexInitializeParams());
    codex.notify("initialized");
    const started = await codex.request("thread/start", {
      // Keeps the sample out of the person's Codex history.
      ephemeral: true,
      ...codexThreadRuntimeParams({
        threadId: null,
        mcpSession: {
          environmentId: EnvironmentId.make("eval"),
          threadId: ThreadId.make("eval"),
          providerSessionId: "eval",
          providerInstanceId: modelSelection.instanceId,
          endpoint: t3.url,
          authorizationHeader: "Bearer eval",
          browserToolsAvailable: true,
        },
        modelSelection,
        runtimePolicy,
      }),
    });
    const threadId = isRecord(started) && isRecord(started.thread) ? String(started.thread.id) : "";
    let completed = false;
    const done = new Promise<void>((resolve) => {
      codex.handlers.request = (method, params) => {
        // The user closes a question, as the cases mock.
        if (method.endsWith("requestUserInput")) {
          record("request_user_input", params, false);
          return { answers: {} };
        }
        if (method === "mcpServer/elicitation/request" && isRecord(params)) {
          return toMcpElicitationResponse(
            { mode: String(params.mode), requestedSchema: params.requestedSchema },
            String(params.serverName).startsWith("t3-code") ? "accept" : "decline",
          );
        }
        return method === "item/permissions/requestApproval"
          ? { permissions: {} }
          : { decision: method.startsWith("item/") ? "decline" : "denied" };
      };
      codex.handlers.notification = (method, params) => {
        if (method === "exit") {
          if (!completed) run.stopReason = "codex_stopped";
          resolve();
        }
        if (!isRecord(params)) return;
        const item = isRecord(params.item) ? params.item : {};
        if (method === "item/completed") {
          if (item.type === "agentMessage" && typeof item.text === "string") {
            run.text += `${item.text}\n`;
            run.finalText = item.text;
          }
          if (item.type === "commandExecution") {
            record("exec_command", { command: item.command }, (item.exitCode ?? 0) !== 0);
          }
          if (item.type === "fileChange") {
            record("apply_patch", { changes: item.changes }, item.status === "failed");
          }
          if (item.type === "collabAgentToolCall" && item.tool === "spawnAgent") {
            record("spawn_agent", { prompt: item.prompt, model: item.model }, false);
          }
        }
        if (method === "thread/tokenUsage/updated" && isRecord(params.tokenUsage)) {
          const total = isRecord(params.tokenUsage.total) ? params.tokenUsage.total : {};
          const cached = Number(total.cachedInputTokens ?? 0);
          usage.input = Number(total.inputTokens ?? 0) - cached;
          usage.cacheRead = cached;
          usage.output = Number(total.outputTokens ?? 0);
        }
        if (method === "turn/started" && isRecord(params.turn)) {
          const turnId = String(params.turn.id);
          interrupt = () => void codex.request("turn/interrupt", { threadId, turnId });
        }
        if (method === "turn/completed" && isRecord(params.turn)) {
          const { status, error } = params.turn;
          completed = true;
          run.stopReason =
            status === "completed"
              ? "end_turn"
              : status === "interrupted"
                ? "max_turns"
                : `failed: ${isRecord(error) ? String(error.message) : String(status)}`;
          resolve();
        }
      };
    });
    await codex.request(
      "turn/start",
      await Effect.runPromise(
        buildCodexTurnStartParams({
          nativeThreadId: threadId,
          codexInput: [{ type: "text", text: prompt, text_elements: [] }],
          runtimePolicy,
          modelSelection,
          hasT3Mcp: true,
          deviceToolsAvailable: testCase.setup.world?.deviceAgentAccess !== false,
        }),
      ),
    );
    await done;
    usage.turns = steps;
  } finally {
    codex.close();
    t3.close();
  }
};

const runSample = async (testCase: McpToolUseCase) => {
  const sample = await Effect.runPromise(
    liveSample(testCase, harness, model).pipe(Effect.provide(services)),
  );
  const cwd = makeWorkspace(testCase);
  const run: Run = { calls: [], text: "", stopReason: "max_turns" };
  const usage: Usage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    apiPriceUsd: 0,
    turns: 0,
  };
  const session = {
    testCase,
    sample,
    cwd,
    prompt: expandTeamCommand(
      testCase.promptContext === undefined
        ? testCase.prompt
        : projectComposerContextForProvider({ text: testCase.prompt, ...testCase.promptContext }),
    ),
    run,
    usage,
  };
  try {
    await (harness === "codex" || claudeModel === undefined
      ? runCodex(session, model)
      : runClaude(session, claudeModel));
  } finally {
    NodeFS.rmSync(cwd, { recursive: true, force: true });
  }
  const checks = gradeSample(testCase.expect, run);
  return {
    id: testCase.id,
    pass: checks.every((check) => check.pass),
    failed: checks.filter((check) => !check.pass).map((check) => check.check),
    stopReason: run.stopReason,
    finalText: run.finalText ?? "",
    calls: run.calls.map(({ tool, input, failed }) => ({ tool, input, failed })),
    usage,
  };
};

const rows: Array<Awaited<ReturnType<typeof runSample>> & { readonly sample: number }> = [];
const skipped = allCases.flatMap((testCase) => {
  const reason = skipReason(testCase);
  return reason !== undefined && (wanted === undefined || wanted.includes(testCase.id))
    ? [`${testCase.id}: ${reason}`]
    : [];
});
// One at a time: a subscription's limits are shared with the person's own work.
for (const testCase of selected) {
  if (skipReason(testCase) !== undefined) continue;
  for (let sample = 1; sample <= samples; sample += 1) {
    const row = { ...(await runSample(testCase)), sample };
    rows.push(row);
    console.log(
      `${row.id}: ${row.pass ? "pass" : `FAIL (${row.failed.join("; ")})`} · ${row.usage.turns} ${harness === "codex" ? "tool calls" : "turns"} · ${row.stopReason}`,
    );
  }
}

const total = (key: "input" | "output" | "cacheRead" | "cacheWrite" | "apiPriceUsd") =>
  rows.reduce((sum, row) => sum + row.usage[key], 0);
const passed = rows.filter((row) => row.pass).length;
const summary = [
  `# MCP tool-use eval, live through ${harness === "codex" ? "Codex" : "Claude Code"}`,
  "",
  `- ${model} at ${effort} effort, ${samples} sample(s) per case, up to ${maxTurns} turns.`,
  `- Pass: ${passed} of ${rows.length} samples.`,
  `- Tokens: input ${total("input")}, output ${total("output")}, cache read ${total("cacheRead")}, cache write ${total("cacheWrite")}.`,
  harness === "codex"
    ? "- Codex reports no price. On a subscription the tokens count against the plan's limits."
    : `- At API prices this would be about $${total("apiPriceUsd").toFixed(2)}. On a subscription it counts against the plan's limits instead.`,
  ...(skipped.length === 0
    ? []
    : ["", "## Not run live", "", ...skipped.map((line) => `- ${line}`)]),
  "",
  "## Cases",
  "",
  "| Case | Pass |",
  "| --- | --- |",
  ...[...new Set(rows.map((row) => row.id))].map((id) => {
    const of = rows.filter((row) => row.id === id);
    return `| ${id} | ${of.filter((row) => row.pass).length} of ${of.length} |`;
  }),
  "",
].join("\n");
NodeFS.mkdirSync(out, { recursive: true });
NodeFS.writeFileSync(
  NodePath.join(out, "results.jsonl"),
  `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
);
NodeFS.writeFileSync(NodePath.join(out, "summary.md"), summary);
console.log(`\n${summary}`);
