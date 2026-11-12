# Install Codenine

Codenine runs coding agents on your computer and lets you control them from its desktop app or a
browser. There is no published release yet, so you run it from source.

## Requirements

- Git
- [Vite+](https://viteplus.dev/guide/) (`vp`). It provides the Node version Codenine is pinned to,
  so you do not install Node yourself.
- An installed, signed-in [provider](#providers) before you start a thread. You can start Codenine
  first and set up providers afterwards.

Install `vp` on macOS or Linux:

```bash
curl -fsSL https://vite.plus | bash
```

On Windows, in PowerShell:

```powershell
irm https://vite.plus/ps1 | iex
```

## Run from source

```bash
git clone https://github.com/musabshahab/codenine.git
cd codenine
vp i
vp run dev
```

`vp run dev` starts the server and the web app with live reload. Open the pairing URL it prints.
The bare address does not sign in a new browser.

To run a built server instead:

```bash
vp run build
vp run start
```

`vp run start` runs the `codenine` command described below with no arguments: it starts the server
and opens the web app in your browser.

To update, pull the repository and run `vp i` again, then restart. With a built server, rebuild
first.

## Desktop app

Run the desktop app from the checkout:

```bash
vp run dev:desktop
```

After `vp run build`, `vp run start:desktop` starts the built app without the dev tooling. To
package an installable, unsigned app for your platform, see
[desktop artifacts](../operations/development.md#desktop-artifacts).

### Windows Subsystem for Linux

In a packaged Windows build that bundles the Linux server, choose a WSL distro in
**Settings → Sharing & access** to run agents and projects there. Install the provider CLIs inside
that distro.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
codenine app
```

This opens a new thread for the current directory, adding the project if needed. Pass a path,
such as `codenine app ../my-project`, to open another directory. It needs the desktop app, so a
standalone server or an SSH session is not enough.

## The `codenine` command

The server is also a command-line tool. In a checkout, after `vp run build`, it is
`node apps/server/dist/bin.mjs`. A packaged desktop app can put a `codenine` link on your `PATH`:
choose **Install** next to **codenine command** in **Settings → About**. The guides write
`codenine` for either form.

| Task                                             | Command                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Start the server and open the web app            | `codenine`                                                                    |
| Start the server without a browser               | `codenine serve`                                                              |
| Create a pairing link for another device         | `codenine pair` ([details](./remote-access.md))                               |
| Set up access from your other devices            | `codenine up` ([details](./remote-access.md))                                 |
| Keep it running in the background (macOS, Linux) | `codenine service install` ([details](./background-service.md))               |
| Reclaim database space                           | `codenine doctor` ([details](./background-service.md#reclaim-database-space)) |

Run `codenine help` or `codenine --help` for the full reference. To start in a new working
directory, use an explicit path such as `codenine ./my-project`. A bare directory name is accepted
only if it already exists.

If `codenine` or `codenine start` reports an already running server, connect to that server
instead. Stop it before starting a replacement, or use a different `--base-dir` for an independent
server.

`codenine update`, the background service, and SSH environments install Codenine from release
archives. Until releases are published, they work only when you
[host release archives yourself](../operations/release.md).

### Intel Macs

The packaged `codenine` executable is not built for Intel Macs. Run the server from source there,
as described above.

## Providers

Codenine works with Codex and Claude Code. Open **Settings → Providers**, select the environment,
and enable the provider you want. Installation, login, and configuration belong to that
environment's machine, even when you connect from another computer.

| Provider | Install and authenticate                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex    | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude   | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |

Provider CLIs must be on the server's `PATH`. If Codenine cannot find one, set its **Binary path**
in provider settings, especially when using a version manager. Codex connected through ChatGPT
uses its managed runtime without a `PATH` entry.

Codenine warns when a provider version has known compatibility problems. Check
**Settings → Providers** on that environment for the recommended version or range. An unlisted
version is unverified.

When a provider CLI is behind its latest release, its provider card shows the available version.
**Update now** runs the installer that owns the CLI (Homebrew, mise, or a global npm, pnpm, Yarn,
Bun, Volta, or Vite+ install), or the CLI's own update command when Codenine cannot tell. Codenine
runs `mise upgrade` only for a tool your mise config requests as `latest` when the provider's
binary path is a mise shim or under the tool's `installs/<tool>/latest` link; update a pinned
version, or a path into one version's directory, through mise yourself. Homebrew and Chocolatey
installs compare against the version their package manager offers, which can trail the npm
release; update Claude installed with Chocolatey through Chocolatey.

Add another provider instance for a separate account or configuration. Each instance can have its
own environment variables, such as API keys or a custom base URL. Mark secret values as sensitive;
after saving, Codenine does not display their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md) and
[Claude](./providers-claude.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating Codenine](./updating.md): update providers and connected servers.
