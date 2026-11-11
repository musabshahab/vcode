// Codex truncates entries over 4,000 bytes; keep each section self-contained and below that limit.
export const CODENINE_ORCHESTRATION_SECTIONS: ReadonlyArray<string> = [
  `## Codenine orchestration

Ordinary coding tasks need no Codenine tools.

- Subagents: use your native tool when the child uses your provider, a model it offers, and no settings beyond yours (Claude \`Agent\`, \`run_in_background:false\`; Codex \`spawn_agent\`, then wait). Use \`delegate_task\` for another provider's model, user-asked settings, a separate checkout (\`isolation:"worktree"\`), or \`delegate_task\` by name. A native type on another provider's model counts too. Background agent: \`delegate_task\`, never a background \`Agent\`. Workflow only when asked.
- Call \`orchestrator_capabilities\` once per thread, before the first \`delegate_task\`. Again only after an error or a user-named provider change. Settings go in \`target.options\`. Provider or model unavailable: say so. Never switch unasked, or fall back to native tools, Workflow, or CLIs. Never make a child's checkout in the shell or in \`task\`.
- Every new delegate review or re-check is a new \`delegate_task\` (brief, findings, objections), never a \`codenine_thread_send\`. Fix small review findings yourself; start no delegate for them. When told to proceed without a delegate, or to run fewer, \`task_cancel\` the extras. Start no replacement.
- Follow a running delegate's \`next\`. Do not poll it (\`task_status\`, \`sleep\`, watchers, Monitor, ScheduleWakeup). Stop a delegate run you replace or no longer need with \`task_cancel\`, never \`codenine_thread_interrupt\` on a \`childThreadId\`.
- Team: when the user asks for a team of agents, call \`propose_team\` and end your turn. Start no work and no delegates before they approve it.
- If you are a subagent or child, do the work yourself. Start no subagents unless your task says to.`,
  `- \`codenine_thread_launch\` and \`create_threads\` make new top-level threads, only when the user asks for a new thread. "Subagent", "delegate", and "parallel" never mean one. Worktree thread: set \`workspaceStrategy\`. Honor a requested base. Otherwise, independent work uses the default branch as \`remote/branch\` with \`startFromOrigin:true\`; with no remote, use the local default. Required unpublished commits and dependent work use their local base. Shell worktrees do not bind it, and no checkout setup in its prompt. No \`workspaceStrategy\`: project root, not your worktree.
- Given a thread id, \`codenine_thread_read\` it before you answer about it.
- In your reply, mention a thread by its \`link\`, verbatim. Never a plain title or bare id.
- A login, token, PIN, pairing code or sudo password only the user can give: call \`request_secret\`, not a chat ask or a handoff. Not for access you have. Sudo: if \`sudo -n <cmd>\` says a password is required, use \`delivery: "file"\` and run \`sudo -S -p '' <cmd> < "$file"\`; the password takes stdin, so give other input as a file argument.
- Codenine tools may load late. Try the name once before you call it absent.`,
];

export const CODENINE_ORCHESTRATION_INSTRUCTIONS = `

${CODENINE_ORCHESTRATION_SECTIONS.join("\n\n")}
`;
