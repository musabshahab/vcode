# Welcome page

Codenine shows a Welcome page when you open a new installation. Existing
workspaces skip it. It shows what Codenine found on the computer you are using,
on one page: your agents and the phone app. Only an agent is needed to start
chatting.

To see the page again, go to **Settings → About → Welcome page** and select
**Open**. Direct links, such as Settings, open normally before setup is done.

The hosted app at app.t3.codes does not open the page. With no computer connected,
it asks you to sign in to Codenine Connect, then to install Codenine and run
`codenine connect` on your computer. From home, it adds compatible computers linked to your account and
opens the app. To add more computers later, use **Settings → Environments**.

If Codenine cannot confirm the workspace during startup, it shows
**Still connecting** instead of opening the app. Select **Reload** to try again.

If Codenine cannot read your saved settings, it shows **Could not read settings**.
Select **Retry** after storage becomes available. Setup does not replace
unreadable settings with defaults.

## Agents

Codenine lists the agents it found on the computer first, ready ones on top.
**Add more agents** lists every other agent Codenine supports, A to Z. When no agent
is found, it reads **Set up an agent** and opens by itself:

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
- Other agents, and agents that could not load, open their page in
  **Settings → Providers**.
- **Browse** opens the ACP Registry for more agents.

On the desktop app, when the folder of the `codenine` command is not on your `PATH`,
**Add to PATH** adds one line to your shell's startup file.

The setup terminal uses the home directory and environment configured for the
provider instance. Sensitive values remain redacted in Settings and
terminal metadata while the terminal process can use them.

**Start** waits for one ready agent. Select **Start without an agent** to finish
without one.

## Phone

Select **Set up** and scan the code with your phone. It opens the App Store on an
iPhone and Google Play on Android. Then select **Sign in to Codenine Connect** and allow
this computer when Codenine asks, so the app can reach it. Sign in to the app with
the same account. If you are signed in but this computer is not shared yet, select
**Set up Codenine Connect**. If Codenine Connect is on but the app cannot reach this computer,
select **Check Codenine Connect** to see why. The page leaves the phone out on builds
without Codenine Connect, or when your organization turns it off. You can still pair the
app with a code from **Settings → Sharing & access**.
