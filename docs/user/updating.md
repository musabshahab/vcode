# Updating Codenine

No Codenine releases are published yet, so Codenine does not check for updates of itself. Update a
source checkout by hand. Provider updates work as described below.

## Update a source checkout

On the machine that runs the server:

```sh
git pull
vp i
```

Then restart what you run. For a built server or desktop app, run `vp run build` first.

The app you use and the server running your agents can be on different machines. Update the
checkout on each machine, so they stay on the same version.

## Before you update

Restarting a server drops its connections and can interrupt active agents and
terminal commands. Saved threads, settings, and project files remain.

**Settings → Maintenance → Continue threads after restarts** is on by default.
It resumes supported active threads after an update, crash, or machine
restart. Changes are saved to the connected environments selected at the top of Settings. An
environment that was offline keeps its previous value; set it again after it connects.
Codenine must start again on that machine;
the setting does not enable automatic startup. Terminal commands may still be
interrupted, and threads without saved provider resume state need a new message.
A thread that finished its turn to wait on a subagent, a background task, or a
command or monitor the agent said it was waiting on is woken and told that this work
stopped. Other background shells and monitors, such as a dev server and its
watchdog, do not wake it; the thread learns about them with your next message.
A thread is not resumed while it waits for your approval, answer, or secret, or
while it is archived, snoozed, or done. After three automatic resumes in a row,
the thread waits for your next message.

Threads created by a much older version keep their transcripts but not every kind of runtime
history. Read [Threads from an older database](./thread-migration.md) before continuing an
important older thread.

## When versions don't match

A client and server must speak the same orchestration protocol. If they do not, the connection is
refused rather than running half-upgraded:

- An app newer than the server is blocked before connecting, with a notice telling you to update
  Codenine on the machine named in the notice.
- A server newer than your app refuses the connection with an update message.

Update the side the notice names, then reconnect.

Only one server can use a Codenine home directory at a time. If startup reports that
another server owns it, stop that server before retrying, or use a separate home
directory and pair with the running server.

## Update providers

**Settings → Providers** shows provider updates for the selected environment.
**Update all** updates every outdated provider on every connected environment
at once. Hover it to see which providers it will update. A provider is left out
when any of its enabled, outdated instances offers only a manual update command,
or when its instances use different update commands, such as two instances that
run different CLI installs. Update those by hand, or point every instance of the
provider at the same CLI.

After a successful provider CLI update, Codenine refreshes model discovery for
every enabled instance of that provider using its own configuration. Connected
clients receive the refreshed catalogs automatically.

Provider updates do not restart running chats. An existing session can keep
using the previous CLI until it ends. If discovery fails, check the provider
status and refresh it again.

Providers installed with npm are checked through the server machine's own npm, so the checks use
npm's configured registry, authentication, and proxy settings. Providers installed with Homebrew
or pnpm check through those tools.

## Updates from releases

Codenine can also update itself from releases: an update button at the bottom of the sidebar,
**Settings → Environments** actions for a server that is behind your app, the desktop app's own
updater, and `codenine update` on a command-line host. All of these stay idle until whoever builds
or runs Codenine names where releases come from. See [Releases](../operations/release.md) for the
settings.
