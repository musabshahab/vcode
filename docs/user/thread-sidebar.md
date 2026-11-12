# Working with threads

Use a new thread for a separate task. Choose **New worktree** when its code changes
need a separate branch and working directory.

## Start a thread

**New chat** opens the project picker when you have more than one
open project. Archived projects don't count. **Shift-click** to start in
the current project, or use a project's own **New chat** button. A new thread carries
your model and mode selections, unless the destination project has its own model default.
Its branch and workspace mode come from your configured defaults. To continue in
the worktree you used last, choose **Previous worktree** in the workspace menu.

When you change a new thread's project, Codenine stays in the current environment
if that project exists there. Otherwise it selects an environment that has it.

### Start without a project

A thread does not need a project. To start one without a project, click **or
start without a project** under a new thread's heading, pick **No project** from
the project menu in that heading or from **New chat in...** in the command
palette, or press `mod+alt+n`. It starts on your current machine; before sending, pick another machine
from the machine menu to move it there. To move a draft into a project, pick the
project in the heading.

Each thread without a project works in its own folder under `~/.codenine/scratch` (the
`scratch` folder of your Codenine data directory), named after its date, the first words
of its first message, and a short id, like
`2026-09-25-convert-these-pngs-to-webp-a1b2c3d4`. Deleting a thread keeps its
folder, so the files the agent wrote stay until you delete them. Branch, worktree, and diff controls stay hidden because
these folders are not Git repositories. This is unavailable when the data
directory itself sits inside a Git checkout.

When the work grows into something real, pick **Turn into project** from the
thread's menu. The thread's folder becomes a project where it is, so nothing
moves and the agent keeps working in the same place. Other threads in that folder
move with it. Rename the project in its settings, and use **Initialize Git** to
get branch and diff controls.

### Start in the background

Press `Cmd+Enter` on macOS or `Ctrl+Enter`
on Windows and Linux to start a new thread and immediately open another draft. The
next draft keeps the workspace mode and base branch you selected. With **New
worktree**, each background submission creates its own worktree.

To send the same prompt to several models, **Shift-click** models
in a new thread's model picker to add or remove them. A regular click returns to a
single model. Choose a base branch and send. Each selection starts a separate thread
and worktree while you stay in the new thread composer. This requires a Git project.

## Group chats by project

By default, the sidebar groups chats by project. From the top it shows:

- **Needs you**: every thread waiting for an approval or an answer, a team waiting for your
  approval, and a team that failed, across projects. An entry leaves once you act on it, mark the
  thread done, or snooze it. This section is hidden while you search.
- Your unsent drafts, then **Pinned** threads.
- A folder for each project, pinned projects first. Threads without a project are in **Chats
  without a project**.
- **Snoozed** and **Done**.

A project with no active threads has no folder unless it is pinned or you pick it in the project
filter. An archived project's folder comes last and shows only while it has active threads. Click a
folder to open or close it. A closed folder shows how many threads it holds, and a dot when one of
them needs you. Use a folder's **New chat** button, or right-click it, to start a thread in that
project. You can drag a thread onto the composer to mention it, but not within the sidebar.

To show each thread on two lines, with its branch, pull request, and agent under the title, turn on
**Settings → Labs → Two-line chat rows**.

For one list without folders, turn off **Settings → General → Sidebar → Group chats by project**.
The single list has no **Needs you** section; instead you can drag threads between sections and
reorder them, and [working threads fold away](#fold-working-threads-beta). Each device keeps its
own choice.

## Pin and reorder threads

Pin a thread from its menu to keep it above your active work.

Unpinning, marking done, snoozing, and archiving a thread each show
a notification with **Undo** for five seconds. Undo restores the thread's previous
state, including its pinned position, and reopens an archived thread you were
viewing. Discarding an unsent draft from the sidebar works the same way: Undo brings
back its text and attachments. `mod+z` triggers the most recent Undo, even from the composer; see
[Keybindings](./keybindings.md#commands-with-special-behavior).

You can also drag files from your computer onto any thread row:
the thread opens and the files are attached in its composer, ready for
your next message. The same per-message file limits apply as when attaching
files directly; see [Attach files](./composer.md#attach-files).

Pinning or unpinning a thread keeps the sidebar at your current
scroll position instead of following the thread to its new place in the list.

Pinning does not stop a thread from being marked done automatically. Marking a thread done
removes its pin.

In the single list, drag a thread between sections to change its state. Drag a thread up into
the pinned section to pin it at the spot you drop it; drag a pinned thread down into the active
list to unpin it. Dragging a thread onto the **Done** header marks it done, and dragging a done
thread into the active list marks it not done. A snoozed thread can be dragged out of the snoozed
shelf, which wakes it, but threads cannot be dragged into the shelf because snoozing needs a wake
time. Dragging a pinned thread out of the pinned section does not ask for unpin confirmation.
Pinned and active boundary labels appear only while dragging, without moving the rows. The
other rows slide aside to show where the thread will land. When you cross into another section,
the dragged thread shows the action the drop performs, with its icon: **Pin**, **Unpin**,
**Done**, **Not done**, or **Wake**. Its status and hover actions hide during the drag. A pinned
thread keeps its pin only while it stays in the pinned section; once it leaves, the badge takes
over. Reordering within the same section shows no badge. When there are no pins, drag to the top
edge to pin a thread. Section labels stay readable for the whole drag, and the section the
thread is over takes the accent color. Section labels also
identify empty sections and a collapsed **Done** shelf.

Drag within the pinned or active section to change its order. Other rows slide aside to show the
spot where the thread will land. Drops into either section keep the position you choose. The server
saves the order, so it survives a refresh and appears on your other connected devices.

The list also animates section changes made with thread actions such as
**Pin**, **Mark done**, and **Snooze**. These transitions respect your system's reduced-motion
preference. While dragging, rows follow the insertion gap without replaying a second transition
after the drop.

New threads appear above the active threads you have arranged. Marking a thread done clears its
active position, so **Mark not done** returns it to the top. Pinning and snoozing preserve its
active position until you move it again. Thread activity does not change the order. The **Done**
shelf is ordered by when each thread was marked done.

If dragging is unavailable for one environment, update the Codenine server running in that
environment. Pinned and active reordering require server support. Threads from older servers keep
their default order until the server is updated.

To generate a fresh title from the conversation, open a thread's menu and choose
**Regenerate title**. The action is unavailable while title generation is in progress
or when the connected environment needs a server update.

To change how titles are written, add **Thread title instructions** in **Settings → Threads →
Text generation**, under Advanced, such as a length limit or an identifier to put first. They apply to new and
regenerated titles. Select a project to give it its own instructions.

Agents connected through Codenine can use the same server-owned metadata workflow to
rename a thread, regenerate its title, or link and unlink a pull request. These changes
appear on every connected client without requiring the originating browser to remain
open.

### Fold working threads (beta)

Threads that are working or waiting on work they will resume from move into a collapsed
**Working** section below the active list.
That includes subagents, watched pull requests, and background commands or monitors the agent
says it is waiting on. A dev server or other process an agent leaves running does not keep a thread
there. A thread returns to the top of the active list when it finishes, fails, or needs an approval or
answer. The Working section lists the thread you last sent work to first. Pinned threads stay in
the pinned section.

This applies only to the single list; chats grouped by project have no Working section. It is on
by default. Turn it off with **Settings → General → Sidebar → Working section**. Each device
keeps its own choice.

While this is on, the active list is ordered by when each thread last came back to you, so you
cannot drag or move threads within it. Your saved order returns when you turn it off.

## Mark finished work done

Choose **Mark done** from a thread's menu to move finished work out of the active list
into the **Done** shelf without deleting the conversation. **Mark not done** restores it to
active work and keeps it from being marked done automatically until new activity resumes the
usual rules. Marking an idle thread done by hand dismisses unanswered async questions without
sending an answer or restarting the agent. It also closes the thread's
terminals that wait at an idle prompt, and keeps their output. A terminal that
runs a command, such as a dev server, stays open unless its action has **Stop this action
when the thread is marked done** enabled in Settings > Projects > Actions. You can also set
`"stopOnSettle": true` on a `codenine.json` action and import it there. Start the command through
that action so Codenine can stop its terminal and child processes. Commands started through an
agent's own shell tools are managed by the provider.

To reclaim disk space from finished work, turn on **Run in the thread's worktree when the
thread is marked done** for one of the project's actions, or set `"runOnSettle": true` on a
`codenine.json` script, for example `cargo clean`. It runs each time a thread in its own
worktree is marked done, by hand or automatically, even if a terminal there still runs a
command such as a dev server. Threads in the project's main checkout skip it. Its terminal
closes when the command succeeds and stays open when it fails.

Press a thread's **Done** button and drag up or down to
mark every thread in that section done, between it and the one you release on.
The **Mark not done** and **Wake** buttons work the same way in their sections.
Press `Escape` while dragging to cancel.

By default, environments mark inactive threads done after seven days, and mark
threads done when their pull request merges. A closed pull request can also mark an idle
thread done. An empty thread's inactivity counts from when it was created.
Work in progress, pending questions or approvals, and background work the agent
is waiting on keep a thread from being marked done automatically. An open pull request does not
stop inactivity from marking it done unless you turn on **Keep threads with a PR** in
**Settings → Threads**, but an old closed or merged pull request does not mark work done that you
resumed after it closed. Only your own messages count as resuming. A turn that
finished background work or a pull request watch starts on its own does not.

To keep one thread out of the **Done** shelf no matter how long it sits idle, open its menu,
choose **Mark done automatically**, and pick **Never**. The current option is checked. Pick
**Follow settings** to return to the rules in **Settings → Threads**. While those rules are off,
a thread on **Follow settings** is not marked done automatically either. **Mark done**, snooze,
and archive still work while it is set to **Never**.

Change these rules in **Settings → Threads**.
They continue to run when your apps are closed. Choose an environment at the
top to change only its rules, or **All environments** to update connected environments together.
Mixed values show where the selected environments disagree. Offline environments
and older servers keep their previous values. Changing a rule does not reopen
threads already marked done.

## Link a pull request

The server finds the PR for each saved branch of a thread that is not done, even when your
apps are closed. Done threads keep their saved links. Update the server if
automatic branch links do not appear.

Right-click a pull request link in a thread and choose
**Link to thread** to select a different PR. Use **Unlink from thread** on the
same link to return to the branch PR, if one exists.
The linked pull request counts when Codenine marks the thread done automatically.

## Find and reference work

Open the command palette with `Cmd/Ctrl+K` to search threads
across connected environments by title, branch, pull request, or project.
Threads you open often or recently rank higher, and for three weeks the thread
you last picked for a query ranks higher when you type that query again.
Threads whose messages contain all your words appear below, under **In
messages**, and open at the matching message. Message search needs at least
one word of three or more letters, or two for Chinese, Japanese, and Korean.

Use **Settings → Keybindings** to find or customize shortcuts for searching files
and copying a thread reference. A copied reference uses the thread's pull request
link when available, otherwise a link to the thread, which opens it from anywhere
you paste it and pastes into a composer as a thread chip (see
[sharing a thread](./prompt-links.md#share-a-thread)). To copy the thread even
when it has a PR, choose **Copy → Thread** from its context menu.
**Thread ID** copies the bare ID for scripts and the `codenine` CLI. See
[keybindings](./keybindings.md) for custom configuration.

## Inspect agent work

**Limited** means the provider stopped on a usage or rate limit. The conversation
keeps the provider's explanation. Retry after the limit resets, or switch to
another provider instance.
Press **Resume** in an empty composer to continue a limited or interrupted turn
manually. Do this when the provider reports no reset time, because nothing
continues the turn on its own.
Queued messages stay saved while the limit blocks the thread. They run after
the continuation finishes. If the queue was held by a restart, resume it then.

When the provider reports a reset time, choose **Resume at reset** to schedule a
continuation. You can cancel it from the thread. Enable **Resume after
usage limits** in **Settings → Threads** to schedule limit stops by default.
The environment must be running when the reset arrives; it resumes overdue
continuations after a restart. Stopping the thread, sending a new message,
archiving, or marking it done prevents a pending continuation from starting.

Choose **Snooze until reset** to hide the thread until its allowance returns.
Snooze and auto-resume are independent: snooze alone wakes the thread without
sending a message; enabling both wakes and continues it. **Wake now** cancels
the snooze. Enable **Snooze until limits reset** in thread behavior settings to
snooze limit stops by default. Providers without a reset time offer manual
retry and the normal snooze choices.

Use **Agents** to follow work delegated to subagents.
Stop on a thread also stops the subagents it delegated to.

Subagent threads started by the agent can't take messages; message the parent
thread instead. When such a subagent needs an approval or an answer, the parent
thread asks for it.

Expand a tool call in the conversation to see its full command and output.
Summaries shorten shell wrappers and can still describe the latest call after it
finishes; the call's own result shows its status.

The thread details card, with the machine, editor, project commands, branch, Git actions and
changes, stays closed until you open it. Click the line under the thread title, which shows the
branch, its line changes and the machine, or press `mod+shift+b`. Each thread remembers whether
you left its card open.

To choose what the thread details card shows, right-click the card or open
**Settings → Appearance → Thread details**. Hidden rows keep their keyboard
shortcuts, such as Open in editor and project commands. **Reset to default** brings
back the standard rows.

## Run a team

A team splits one job across several agents, each on the model that fits its part, so a quick
model can do the routine work while a stronger one reviews. To ask for one, turn on
[**Team**](./composer.md#ask-for-a-team) in the composer before you send, or ask in your own words,
for example "propose a team for this: one agent writes the code, one tests it, one reviews". The
agent you asked, the lead, plans the team and starts nothing. The plan opens in the **Task** tab of
the right panel.

Nothing runs until you approve. In the Task tab you can change an agent's model or effort, add an
agent, remove one that has no tasks, move a task to another agent, remove a task, and edit a task's
brief. Your edits apply once you choose **Save** or **Approve and start**. If the team changes while
you edit, for example because the lead proposed a new one, the tab shows the new team and tells you
your changes were not applied. **Cancel team** drops the plan.

Each task runs in a thread of its own. A task starts once the tasks it follows are done, with at
most two running at a time on each provider. The Task tab shows each agent's status, model, and
result, which agent each result goes to, and a link to its thread. **View changes** opens the
Changes tab. When the Task tab is out of sight, or the window is too narrow for the right panel, the
**Team** line above the composer shows where the team stands and opens the tab. The right panel's
**+** menu also has **Task**.

When the team finishes or gets stuck on a failed task, the lead reads the results and goes on.
After a finished team, its reply shows as the **Task result**.

An agent's thread opens with **Assignment from the lead**: its brief and the results it received
from earlier agents. Its header links back to the lead and shows the agent's place in the team, its
model, and its status. A message you send there goes to that agent only; to change the plan, ask
the lead. When an agent needs an approval or an answer, the lead's thread shows that too.

In the sidebar, the lead's row shows a team icon and where the team stands: **Review**,
**Running 1/3**, **Done**, **Failed 1**, or **Cancelled**. The agents' threads appear under it,
and the team count on that row shows or hides them. A team waiting for your approval, or one that
failed, also appears under [**Needs you**](#group-chats-by-project). When the team finishes or is
cancelled, the agents' threads are marked done for you. After a failure they stay, so you can read
and retry them. The lead is never marked done for you.

- **Cancel team** stops the tasks that are running. Tasks that have not started never start.
- **Retry** runs a failed or cancelled task again in a new thread. To retry on a different model,
  such as a stronger one, choose another agent of the team under **Retry on**.
  A cancelled team cannot be retried; ask the lead for a new one.

## Side chats

A side chat lets you ask a question about a thread without adding to it. It starts
with what the thread knows, and the thread keeps working while you ask.

Start a message with `/side` or `/btw`, then your question.
You can also choose **Side chat** from the **+** menu in the right panel. The side
chat opens as a tab there, with its own composer. Side chats do not show in the
sidebar. Find one again under **Side chats** in thread details.

A side chat works in the same folder as the thread and starts with the permissions,
model, and reasoning level shown in the thread's composer, including for its first
reply. Change them for an individual side chat in its composer. Later changes to the
parent do not change existing side chats.

To use what you learned, choose **Bring back**. The thread gets the side chat with
your next message there. Bring back is available while the thread is idle.

Closing a side chat you never sent a message in deletes it. To delete one you used,
choose **Delete** at the top of the side chat. Deleting a thread also deletes its
side chats.

## Snooze until later

To change the choices in the snooze menu, open **Settings → Threads → Snooze options**.
Each option is a duration, such as 3 hours, or a time on a day, such as 9:00 PM
tomorrow. A weekday means the next one after today. Menus list the options soonest
first and hide a today option after its time passes. Saved with **All environments**
selected, the options apply to every connected environment.

Choose **Snooze → Custom…** from a thread's menu to pick a date and time in your
local time zone, or a duration in minutes, hours, or days. Durations start when
you confirm; one day means 24 hours. You can also snooze
several selected threads together. Choose **Wake thread** to bring a thread back early.

A snoozed thread keeps working and stays hidden until its wake time, even while
its agent wakes itself for background work. It comes back early for an approval,
a new question, a failed run, or a message or answer you send. You can snooze an existing
question and answer when the thread wakes; the question stays unanswered.
