# Ensemble

Ensemble makes a coding subscription go further. It runs each task with a team of AI agents and
puts every job on the cheapest model that can do it, so your strongest model's allowance is spent
on planning and review, not on reading files and running tests.

## Why

Used directly, Claude Code or Codex runs a whole task on one model. If that is your strongest
model, every file it reads and every test it runs draws on the same daily and weekly limits as
the hard thinking, and the limits arrive sooner.

Ensemble splits the task by role. A lead plans the work and hands research, implementation,
testing and review to subagents, each on the model you chose for that role. The strong model does
the parts that need it. Cheaper models do the volume.

- **On a subscription**, the same work uses less of your strongest model's limits. With two
  subscriptions, such as Claude and Codex, the team also spreads the work across both.
- **On API keys**, the same split lowers the bill.

How much you save depends on the task and on how your plan counts each model. The app's **Usage**
page shows what each model used and what is left in each limit.

Ensemble drives the coding agents you already have, with your own sign-ins or keys. Nothing is
resold. You run it from a web app, a desktop app, or the command line.

> [!NOTE]
> Ensemble is built on an open-source base whose names it has not replaced yet. The command is
> still `t3`, the data folder is still `~/.t3`, and the app's own screens and the guides under
> [docs/](./docs) still say T3 Code. Only this README uses the new name.

## What you get

- **A team per task.** Type `/team` before a task. The lead plans, splits the work into steps
  with the files each step owns, and delegates by role: research, implementation, test, review.
- **A model per role.** Put the volume on cheaper models and keep the strong one for the lead and
  the review. Reviews can run on a different provider from the one that wrote the code, so a
  second model family checks the first.
- **Presets.** Balanced, Budget and Max quality fill every role from the models your providers
  offer, with a rough cost for a typical task.
- **A budget.** A dollar limit on what one request's subagents may use. When it is reached the
  lead stops delegating and asks you.
- **Isolation and undo.** Run a task in its own git worktree. Every turn is checkpointed, so you
  can view the diff and restore.
- **Three surfaces.** Web, desktop (Electron), and CLI. On a phone, the web app
  [installs to the home screen](./docs/user/remote-access.md#install-the-web-app-on-a-phone).

## Requirements

- Git, and Node 26. The `vp` tool below provides the right Node version.
- At least one coding agent, installed and signed in on the machine that runs Ensemble:
  - **Claude Code:** `claude auth login`
  - **Codex:** `codex login`, or **Connect with ChatGPT** in Settings → Providers
- A second provider is optional, and is what lets a different model family do the review.

## Install and run

Ensemble is run from this repository. There are no published builds.

```bash
curl -fsSL https://vite.plus | bash
```

```bash
git clone https://github.com/musabshahab/vcode.git
```

```bash
cd vcode
```

```bash
vp i
```

### Try it

```bash
vp run dev
```

This starts the server and the web app and prints a pairing URL. Open that URL; the bare address
does not sign a new browser in. For the desktop app, use `vp run dev:desktop` instead.

### Build it

```bash
(cd apps/web && vp build)
```

```bash
(cd apps/server && vp pack)
```

```bash
alias t3="node $PWD/apps/server/dist/bin.mjs"
```

```bash
t3
```

`t3` starts the server and opens the web app. `t3 serve` does the same without a browser, and
`t3 --help` lists every command. The examples below assume the alias.

> [!WARNING]
> Do not run `t3 update` or `t3 install`. They download the upstream project's releases, which do
> not have the team features, and would replace this build.

## First run

The first time you open Ensemble it walks you through setup:

1. **Create project.** A new project, a folder you already have, or a clone of a repository.
2. **Set location.** The folder your projects live in. Later new projects go there too.
3. **Connect providers.** Install and sign in to the agents you want. One is enough to start.
4. **Assemble team.** Pick a recommended team, or choose a model for each role.
5. **Connect GitHub.** Optional. Needed for private repositories and pull requests.
6. **Review setup.** Nothing is created before this step.
7. **First task.** Opens a thread with `/team` and your task, ready to send.

You can skip any step, and open setup again from **Settings → About → Setup**.

## Set up the team

Setup covers this the first time. To change it later, open
**Settings → Threads → Subagent models**.

1. **Pick a preset** from **Presets**, or choose a model for each role yourself. A role left on
   **Thread's model** uses whatever model the thread runs on.
2. **Set a budget** in **Budget per request** if you want a cap. It is in dollars at API prices.
3. **Override per project** if one codebase needs a different team: choose the project in the
   sentence at the top of Settings, then set its roles.

How presets choose: they rank the models your providers offer by list price, and pick each role
from a tier of that ranking. The reviewer comes from a different provider than the implementer
when that provider has a comparable model. The cost shown is a rough guide for a mid-sized task,
not a quote.

### Add Codex next to Claude

With both signed in, a preset puts the implementation on one and the review on the other. To do
it by hand, set **Implementation subagents** to a Claude model and **Review subagents** to a Codex
model, or the reverse.

Codex can also run on an API key through a custom model provider, for example OpenRouter. Put the
provider in a `config.toml` in a folder of its own:

```toml
model = "openai/gpt-6.1-terra"
model_provider = "openrouter"

[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"
wire_api = "responses"
```

Then in **Settings → Providers**, add a Codex instance, choose **Configure manually**, set
**CODEX_HOME path** to that folder, add `OPENROUTER_API_KEY` under **Environment variables**, and
add the model ID under **Custom models**.

## Use the team

In the composer, pick `/team` from the `/` menu or type it:

```text
/team Add rate limiting to the public API routes, with tests
```

From a terminal, in the project's folder:

```bash
t3 project add .
```

```bash
t3 thread start . "/team Add rate limiting to the public API routes, with tests" --wait
```

Add `--worktree main` to run it in a new worktree based on `main`.

What happens:

1. The lead reads enough to plan, and names the files each step owns.
2. Research questions go to research subagents, in parallel.
3. Each implementation step goes to its own subagent. Steps that share no files run in parallel.
   A step whose files another running step holds waits for it.
4. A test subagent runs the project's checks.
5. A review subagent reviews the whole change. The lead has findings fixed and reviews once more.
6. The lead reports what changed, the test result, the review verdict and what is still open,
   with a commit message.

For a one-line change the lead does the edit itself and says no team was needed. Without `/team`
a thread is a single agent, as usual.

### Debug with the team

Describe the failure and what you expect. The research role finds the cause, the test role
reproduces it, and the review role checks the fix:

```text
/team The nightly export job fails with "connection reset" after about ten minutes. Find the
cause, fix it, and add a test that would have caught it.
```

Give it what you have: the error text, the failing command, a log path. If you only want the
cause and not a fix, say so in the task.

### Ship with the team

The team works in your checkout or a worktree and stops at a commit message. Committing, pushing
and opening a pull request are your call, from the thread's branch controls or by asking:

```text
/team Bump the version, update the changelog from the commits since the last tag, and open a
pull request.
```

Agents run the commands you allow. For anything that pushes, publishes or deploys, set the thread
to **Supervised** so each command waits for your approval. See
[permission modes](./docs/user/permission-modes.md).

## Manage a run

- **Watch it.** The thread shows each subagent as it starts and finishes. **Agents** opens any of
  them to read what it did.
- **Stop it.** Stop on the thread also stops its subagents.
- **Answer it.** When a subagent needs an approval or an answer, the lead's thread asks you.
- **Read the change.** The diff panel shows what changed. Each turn has a checkpoint you can
  restore.
- **Keep it apart.** Choose **New worktree** for the thread to keep the changes out of the folder
  you are working in. A worktree starts from a commit, so it lacks your uncommitted changes.
- **See what it cost.** **Usage** breaks spending down by model and shows subscription limits.
- **Read it later.** `t3 thread list` and `t3 thread show <id>` print threads and transcripts.

## Deploy Ensemble on another machine

Agents run where the server runs, with that machine's files and sign-ins. To use a server from
other devices, build it there as above and start it without a browser:

```bash
t3 serve --lan --port 3773
```

`--lan` accepts connections from your local network and tailnet. Use `--host` to bind one address.
Then make a pairing link and open it on the other device:

```bash
t3 pair
```

To keep it running, start it from your own process manager. A systemd user unit, for example:

```ini
[Unit]
Description=Ensemble server

[Service]
WorkingDirectory=%h/vcode
ExecStart=/usr/bin/env node apps/server/dist/bin.mjs serve --lan --port 3773
Restart=on-failure

[Install]
WantedBy=default.target
```

`t3 up` and `t3 service` set up a background service and remote access for the upstream
project's installed releases. They have not been tried with a build from this repository.
[Remote access](./docs/user/remote-access.md) covers Tailscale, HTTPS and pairing in depth.

### On a phone

Start the server with `--lan`, or with `--tailscale-serve` for an `https` address, and open the
pairing link on the phone. From there the web app can be added to the home screen and opens full
screen. Android offers a full install only over `https`. An iPhone's installed app asks for a
pairing token the first time: run `t3 pair` and enter the token it prints. See
[installing on a phone](./docs/user/remote-access.md#install-the-web-app-on-a-phone).

State lives in `~/.t3`. Pass `--base-dir <folder>` to keep it elsewhere, and pass the same flag to
every other command so it finds that server.

## Debug Ensemble itself

- **A role's model does not run.** The lead is told why, for example that the provider is signed
  out. Open **Settings → Providers** and refresh. A role never falls back to another model.
- **No presets offered.** Presets need two models with a known price. Give a model a price under
  **Usage → Model prices**.
- **A step is refused.** Another running step holds one of its files; the lead waits and retries.
- **Delegation stops early.** The budget was reached. Reply to continue; your reply starts a new
  budget.
- **Logs.** The server's trace is under `logs/` in the data folder. `t3 trace` reads it.
- **A broken data folder.** `t3 doctor` inspects and repairs it.
- **While developing.** `vp run dev` restarts the server whenever a server file changes. A run in
  progress resumes afterwards.

## What is enforced, and what is asked

| Rule                                       | How it holds                                                      |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Each role runs on its model                | Enforced. An unavailable model fails the step; nothing falls back |
| Budget per request                         | Enforced for subagents. The lead's own work is not counted        |
| Two review rounds per `/team` request      | Enforced                                                          |
| Steps that share files do not run together | Enforced, for the files a step declares                           |
| A step changes only its own files          | Asked of the agent, not enforced. Check the diff                  |
| One retry on a stronger model              | Asked of the lead, not enforced                                   |
| The pipeline's order                       | Asked of the lead, and checked by the evals in [evals/](./evals)  |

Costs are estimates at API list prices. On a subscription they are not charges. Usage a provider
does not report, and models without a known price, count as nothing.

## Develop

```bash
vp run check:changed
```

runs the fast checks for the files you changed: format, lint, types and the tests beside them.
[AGENTS.md](./AGENTS.md) has the working rules, [docs/internals/overview.md](./docs/internals/overview.md)
the architecture, and [evals/README.md](./evals/README.md) how to check a change to the text
agents read.

## More

- [Running tasks with the team, roles, presets and budget](./docs/user/thread-sidebar.md#give-a-role-its-own-model)
- [Permission modes](./docs/user/permission-modes.md)
- [Remote access](./docs/user/remote-access.md)
- [Codex accounts](./docs/user/providers-codex.md) · [Claude accounts](./docs/user/providers-claude.md)
- [Usage and limits](./docs/user/usage.md)
- [Source control](./docs/user/source-control.md)
- [Using it from scripts and other agents](./docs/user/outside-agents.md)

## Credits and licence

Ensemble is built on [T3 Code](https://github.com/pingdotgg/t3code), which is MIT licensed. The
[LICENSE](./LICENSE) file carries its copyright notice and applies to this repository.
