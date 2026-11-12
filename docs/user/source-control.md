# Source control

Codenine integrates with GitHub to clone and publish repositories, create pull requests, and track
their status.

## Review turn changes

A turn's changed files and diff show only the turn's own work. When a turn pulls, merges, or
rebases, the files Git brought in are left out. A file stays in the list when the turn edited it,
committed it, or fixed a conflict in it. Use the branch comparison to review everything that changed
against your base branch. Restore still returns the complete saved workspace.

Open the Diff pane source picker and choose **Commits** to review one local
commit at a time. The list shows the newest 100 commits in the branch comparison. A merge commit
shows its changes against its first parent.

A GitHub commit link opens in the Diff pane when the thread's repository has
that commit locally, on any branch. Command/Ctrl+Click always
opens the link in your browser. Pull request links open on GitHub.

## Connect an account

Install Git and configure authentication on the machine running your Codenine server. For a remote
environment, do this on the remote machine. After signing in, open **Settings → Source control**
and choose **Rescan**.

### GitHub

Codenine talks to GitHub's API directly and only needs a token. Any of these works, in this
order of precedence:

1. A token saved in **Settings → Source control → GitHub**. It is kept in the server's secret
   store, and works without the GitHub CLI.
2. `GH_TOKEN` (`GH_ENTERPRISE_TOKEN` with `GH_HOST` for GitHub Enterprise Server) in the
   server's environment.
3. [GitHub CLI](https://cli.github.com/) 2.81.0 or newer, signed in with `gh auth login`.

If `gh` is signed in to several accounts or hosts, expand **GitHub** in the same place to pick
the account each host uses or turn a host off. A saved token or `GH_TOKEN` takes precedence
over that choice; a host turned off stays off either way.

For GitHub Enterprise, sign in with `gh auth login --hostname YOUR_HOST`. Codenine treats a
custom server name as GitHub once it has a credential for that host.

## Start, clone, or publish a project

To start from nothing, click **New project** in the sidebar or the command palette (`Cmd/Ctrl+K`)
and type a name. Codenine makes a Git
repository in `~/.codenine/projects` (the `projects` folder of your Codenine data directory) with a README,
an icon, and a first commit, then opens a new thread in it. Until the project has a thread, new
threads work in its folder, even when your default is a new worktree. The folder is named after the project,
like `pinball-stats` for "Pinball Stats". Turn on **Create private repository** to also
publish it on GitHub. If Git has no name or email on that machine, the project is created without the
first commit.

To clone a repository, choose **Add existing project** under **New project** or in the command
palette. Choose GitHub
or paste a Git URL, then choose where to save it. The project opens right away while the
clone runs in the background: you can write your first prompt, and sending waits until the files
are in place. A toast tracks progress and lets you cancel; if the clone fails, retry it from the
toast or from the banner above the composer. When the host refuses the machine's SSH key, Codenine
clones over HTTPS with Git's credentials for that host instead, and the project's remote uses the
HTTPS URL.

To lay clones out like [ghq](https://github.com/x-motemen/ghq), turn on **Clone into host folders**
under **Settings → Threads**. Clones then default to
`<host>/<owner>/<repo>` under **Add project starts in**, so set that to `~/ghq` to share ghq's
folders. You can still change the destination before cloning.

For a local Git repository without a remote, **Publish Repository** creates a GitHub repository,
adds it as `origin`, and pushes your commits. If there are no commits yet, it creates the remote;
make your first commit before pushing.

## Create a pull request

Use a thread's Git actions to commit, push, and create a pull request. Codenine can generate commit
messages, pull request titles, and descriptions from your changes. Descriptions also draw on the work in
the thread, including the checks it ran.

An existing fork PR can appear beside the branch even if you pushed without setting an upstream.
If its badge is missing because several remotes hold that branch, set the branch's upstream to
the intended remote with `git branch --set-upstream-to=<remote>/<branch>`.

Choose the writing style and model in **Settings → Source control**. **Repository conventions**
uses the project's instructions and recent commit subjects.

## Troubleshooting

- **Not authenticated:** run `gh auth login` on the server or save a token in Settings → Source
  control, then rescan.
- **GitHub sign-in cannot be verified:** update GitHub CLI to at least 2.81.0, or save a token in Settings → Source control.
- **Push fails despite a connected account:** check the Git remote's credentials. SSH and HTTPS
  remotes can require separate setup from GitHub API access.
- **A pull request's status does not update:** open it on GitHub while resolving
  connectivity, permissions, or rate limits.

## Linked pull requests

A thread can hold several pull requests, including pull requests from another repository on the
same host. Use **Link pull request** in the command palette, or right-click a pull request link in
the conversation. Creating a pull request from Git actions links it automatically, and so does an
agent creating one with `gh pr create`. Agents can link other pull requests with the
`link_pull_request` tool.

The thread header and sidebar row show each linked pull request's state (open, draft, merged or
closed). Thread badges show a stack's layer count or the current pull request number with a count
of additional links; hover a badge to see every linked pull request.

Open linked pull requests refresh on the server; closed ones refresh periodically so reopening one
on the host is detected. A done thread's pull requests stop refreshing until you mark it not done.
With **Mark merged threads done** enabled, a thread can be marked done after every linked pull
request is terminal. An open or unsynced link keeps it active.

Ask the agent to watch, monitor, or babysit a pull request and it calls `watch_pull_request`. While
the thread is active, the server checks the pull request every two minutes and wakes the agent when a
check fails, the required checks pass, someone else comments or reviews, or the branch starts to
conflict. Threads in a project that watch the same pull request share one check. A check
first asks whether anything changed and reads the pull request only when it did, which keeps
watching inside GitHub's rate limit. Comments from your own account do not wake it. Watching ends
when the pull request merges or closes, after 10 wakes in a row that bring only comments, after 8
failed reads in a row, or when you press Stop on the thread. A rate limit only pauses watching.
Marking a thread done or archiving it also ends all its watches. Mark the thread not done before
starting a new watch. Watching a pull request again does not repeat check or conflict news its last
watch already reported; unlinking the pull request clears that. Subagents cannot watch pull
requests; the thread that delegated to them does. In the thread details card, a watched pull
request shows an eye; click it to stop watching.

A watched thread counts as working between wakes, so it is not marked done automatically, and in
the single sidebar list it stays in the **Working** section. Agents stop watching when they hand the
work back to you, and the thread then returns to your inbox.

Cross-repository links use a project on the same host.

Pull request sharing is off by default. In Settings → Environments → Pull request sharing, choose
**Read PRs** for each environment you trust to share its source control access. Linked pull request
status can then be read through another connected environment signed in to the same account on the
same host. Credentials stay on their machines.
