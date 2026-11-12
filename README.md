# Codenine

Codenine runs a team of coding agents on one codebase. A lead agent receives the task and proposes
a team of subagents. Each subagent runs on Codex or Claude Code with a recommended model and
effort. You can add or remove agents and change each one's model or effort before the team starts.

Switching models in the middle of a Claude Code or Codex session makes the provider read the whole
session again, which burns usage. Codenine gives each task the model that fits it instead.

## Status

Codenine is early. Expect bugs and breaking changes.

What works today is the base the team feature will be built on:

- Codex and Claude Code threads, using the subscriptions or API keys already set up on your machine
- Delegation to subagents through the orchestrator MCP tools
- Checkpoints and diffs for each turn
- A terminal, Git worktrees, pull request creation and pull request status
- A desktop app (Electron) and a web app that mirrors it

Teams are early. Turn on Team in the composer, or ask the lead agent for a team, and it proposes
one. The Task tab in the right panel lets you change each agent's model and effort, add or remove
agents and tasks, and approve or cancel the team; while the team runs, it shows each agent's status
and result and lets you retry a failed task. See
[Run a team](./docs/user/thread-sidebar.md#run-a-team). A terminal app is planned next.
More providers, such as OpenRouter models, may follow.

Codenine is self-hosted. There is no hosted service, no website, and no published release yet, so
running from source is the supported way to use it. Codenine Connect, the remote-connection
service, is still in the code but stays off unless you deploy and configure
[your own relay](./docs/operations/connect-setup.md).

## Run from source

You need:

- Git
- [Vite+](https://viteplus.dev/guide/) (`vp`). It provides the Node version pinned in
  `package.json` (Node 26), so you do not install Node yourself.
- At least one provider, installed and signed in on the same machine:
  - Codex: install the [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
  - Claude: install [Claude Code](https://claude.com/product/claude-code) and run
    `claude auth login`

Install `vp` on macOS or Linux:

```bash
curl -fsSL https://vite.plus | bash
```

On Windows, in PowerShell:

```powershell
irm https://vite.plus/ps1 | iex
```

Then clone and start the server and the web app:

```bash
git clone https://github.com/musabshahab/codenine.git
cd codenine
vp i
vp run dev
```

Open the pairing URL that the dev runner prints. The bare address does not sign in a new browser.

For the desktop app, run `vp run dev:desktop` instead. To build once and run the built server
without the dev tooling, run `vp run build` and then `vp run start`.

[Install and first run](./docs/user/install.md) covers providers and the command line in more
detail. [Development](./docs/operations/development.md) covers ports, state directories, checks
and desktop builds.

## Documentation

The docs live in [docs/](./docs/README.md). There is no docs site.

- [Install and first run](./docs/user/install.md)
- [Working with threads](./docs/user/thread-sidebar.md)
- [Messages and context](./docs/user/composer.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Source control](./docs/user/source-control.md)
- [Remote access](./docs/user/remote-access.md)
- [Outside agents over MCP](./docs/user/outside-agents.md)
- Providers: [Codex](./docs/user/providers-codex.md) · [Claude](./docs/user/providers-claude.md)
- [FAQ](./docs/user/faq.md)

To work on Codenine, start with [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[architecture overview](./docs/internals/overview.md).

## Contributing and support

Report bugs in [issues](https://github.com/musabshahab/codenine/issues) and propose features in
[discussions](https://github.com/musabshahab/codenine/discussions). Report security problems
privately, as [SECURITY.md](./.github/SECURITY.md) describes.

## License

[MIT](./LICENSE). Codenine is a fork of [T3 Code](https://github.com/pingdotgg/t3code).
