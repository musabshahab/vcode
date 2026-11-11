# FAQ

## What is Codenine?

Codenine runs coding agents on your codebase and gives you one place to direct them. It is built
to run a team of agents on one task: a lead agent proposes a team, each agent on Codex or Claude
Code with a recommended model and effort, and you adjust that team before it starts.
[Run a team](./thread-sidebar.md#run-a-team)

Codenine also runs single Codex and Claude threads, lets an agent delegate work to subagents, and
gives you checkpoints, diffs, a terminal, worktrees, and pull requests. [Install](./install.md)

## Is Codenine a harness?

No. A harness turns a model into an agent: it gives the model tools, runs them, and hands the
results back. Claude Code and Codex are harnesses. Codenine drives those harnesses and does not
work without one.

## Which providers does it support?

Codex and Claude Code. More may come later. [Provider setup](./install.md#providers)

## Why not switch models inside one Claude Code or Codex session?

Switching models in the middle of a session makes the provider read the whole session again, which
uses up your plan. Codenine is built to give each task its own agent on the model that fits it.

## How much does Codenine cost?

Nothing. Codenine is open source (MIT) and self-hosted. You still pay your provider as you already
do.

## Can I use Codenine with my Claude Code or ChatGPT subscription?

Yes. Codenine uses the provider login on the machine that runs the server. Whether your plan's
terms allow a given use is between you and your provider.

## Can I add a bunch of accounts for one provider?

Codenine is not the place to manage a pool of accounts, and it has no automatic account switcher.

A separate work account is fine. Setup for two:
[Codex](./providers-codex.md#use-multiple-accounts) ·
[Claude](./providers-claude.md#separate-accounts-or-configurations). For a bigger pool, manage the
accounts outside Codenine with a self-hosted proxy such as
[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI). After you set up a hub, Codenine can
show its pooled limits under Usage. [Connect a hub](./usage.md#connect-a-cliproxyapi-hub)

## Can I use an API key or OpenRouter instead of a subscription?

Yes. Add another provider instance in Settings and give it its own keys and endpoint. Your
subscription setup stays untouched. [OpenRouter](./providers-claude.md#openrouter) ·
[Provider instances](./install.md#providers)

## Does Codenine support local models?

No. Codenine drives Codex and Claude Code only.

## How do I use Codenine remotely?

Your agents run wherever the Codenine server runs: your desktop, a server, a VPS. You connect to
it from another browser or desktop app over your local network, Tailscale, or SSH.
[Remote access](./remote-access.md)

Codenine Connect, which reaches a machine without network setup, needs a relay. Nobody runs one for
you: it is off unless you deploy your own.

## Is there a phone app?

No. Codenine has a desktop app and a web app.

## Does my code go to Codenine servers?

No. There are no Codenine servers. Your code and prompts go from your machine to your provider
(Anthropic or OpenAI). [Diagnostics data](./telemetry.md) lists what can leave your machine and how
to turn it off.

## Worktrees are eating my disk. How do I clean them up?

Open **Settings → Worktrees → Cleanup** and turn on automatic worktree cleanup. You can also run
it now from there. [Storage cleanup](./project-settings.md#storage-cleanup)

## Why is my provider not showing up?

Usually the CLI is not installed or not on the `PATH` of the machine that runs the server. Log in
on that machine first, with `codex login` or `claude auth login`. If it is still missing, point
**Binary path** at it in provider settings. Version managers often cause this.
[Provider setup](./install.md#providers)

## Why does Codenine Connect keep disconnecting?

Open **Settings → Environments**, find the machine, and select **Details**. The first part marked
as failed is the cause. [Codenine Connect troubleshooting](./codenine-connect-troubleshooting.md)
