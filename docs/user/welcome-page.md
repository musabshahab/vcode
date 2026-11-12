# Welcome page

Codenine shows a Welcome page when you open a new installation. Existing
workspaces skip it. It sets up the computer you are using in three steps: its
**Agents**, a **Project** to work in, and your **First task**, which you write on
the project's start screen.

To see the page again, go to **Settings → About → Welcome page** and select
**Open**. Direct links, such as Settings, open normally before setup is done.

If Codenine cannot confirm the workspace during startup, it shows
**Still connecting** instead of opening the app. Select **Reload** to try again.

If Codenine cannot read your saved settings, it shows **Could not read settings**.
Select **Retry** after storage becomes available. Setup does not replace
unreadable settings with defaults.

## Agents

Codenine lists the agents it found on the computer first, ready ones on top.
When no agent is found, the list reads **Set up an agent** and opens by itself:

- **Turn on** enables an agent that is off on this computer, including one only
  some projects use. Codenine then checks whether it is installed and signed in.
- For Claude Code, **Install** or **Sign in** opens a terminal with the correct
  command ready to run. Install uses the vendor's own installer, which keeps
  **Update now** working in Settings.
- For Codex, **Set up** offers sign-in with your ChatGPT account or your own
  Codex CLI. **Use existing CLI** opens the terminal to install or sign in, and
  **Continue with ChatGPT** stays available until Codex is signed in.
- When Codenine knows an installed version does not work with it, **Update** opens
  the agent in **Settings → Providers**, which shows the version to use and updates it
  when it can.
- An agent that could not load opens its page in **Settings → Providers**.

On the desktop app, when the folder of the `codenine` command is not on your `PATH`,
**Add to PATH** adds one line to your shell's startup file.

The setup terminal uses the home directory and environment configured for the
provider instance. Sensitive values remain redacted in Settings and
terminal metadata while the terminal process can use them.

**Continue** waits for one ready agent. Select **Continue without an agent** to go
on without one.

## Project

A project is a folder on that computer that agents work in. Choose how to get one:

- **New project** creates an empty Git repository.
- **Open a folder** uses code already on that computer.
- **Clone a repository** downloads a GitHub or Git URL into a new folder.

See [Start, clone, or publish a project](./source-control.md#start-clone-or-publish-a-project)
for details. Your most recent projects on that computer are listed below these choices; pick one
to continue with it. **Skip for now and chat without a project** opens a chat
[without a project](./thread-sidebar.md#start-without-a-project). Setup is saved as done as soon as
you choose any of these.
