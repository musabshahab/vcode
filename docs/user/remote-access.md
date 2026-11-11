# Remote access

Connect a browser or another desktop app to Codenine running on a different
machine. That machine must stay running and reachable while you work.

Pairing over a [LAN or private network](#pair-over-a-lan-or-private-network),
[Tailscale](#tailscale-https), and [SSH](#desktop-managed-ssh) need no account or relay.

## Codenine Connect

Codenine Connect makes an environment available to your other devices without setting
up router forwarding. It needs a relay, and nobody runs one for you: Codenine Connect is off, and
`codenine connect` reports that it is unavailable, unless the build was configured for a relay you
deployed. See [Codenine Connect setup](../operations/connect-setup.md). The rest of this section
applies to such a build.

In the desktop app on the host, open **Settings →
Sharing & access**, sign in, and enable **Codenine Connect** for that environment.

For a command-line host, run:

```bash
codenine up
```

It asks how your other devices reach the machine: Codenine Connect, the local network,
or both. Choose Codenine Connect and follow the sign-in instructions. On Linux and
macOS, it then runs Codenine as a [background service](./background-service.md).
`codenine connect` is the same as `codenine up --connect`. Run `codenine up` again to change your
choice, and `codenine status` to see it.

The background service is not available on Windows, so there `codenine up` prints the
`codenine serve` command to keep running in a terminal. You can also keep the desktop
app running with its local environment enabled. Closing the desktop app's last
window stops its local server. Saving your sign-in alone does not start a server
or make the machine reachable.

On your other device, sign in to the same Codenine Connect account and choose the
environment. Over SSH, the CLI prints a
browser link and a short code. Open the link on any device, confirm the code
matches, and approve. The CLI continues on its own, so you do not need to forward
an OAuth callback port.

Codenine Connect renews access credentials when needed without disconnecting a healthy
connection. Provider settings keep working after the
previous credential expires. A failed renewal affects that request; it does not
disconnect an otherwise healthy conversation.

### Scripts and agents

`codenine up` asks nothing when you name a choice: `--connect`, `--lan`, or their
`--no-` forms. Choices you do not name keep their settings, and `--yes` takes
the defaults. Without a terminal:

- Codenine Connect sign-in prints a URL and a code. Approve it on any device.
- A needed restart runs without asking, and stops running agent turns.
- With nothing set up and no choice named, `codenine up` stops and names the flags.

`codenine status --json` prints the settings. `codenine up --help` lists every flag with
examples.

## Pair over a LAN or private network

Use direct pairing when the other device can reach the host's network address.

On a desktop host, open **Settings → Sharing & access**, enable **Network access**,
then create a pairing link using an address the other device can reach. Changing
network access restarts the desktop app. You can turn it off in the same place.

For a command-line host, choose the local network in `codenine up`, or run:

```bash
codenine up --lan
```

For a server in a terminal, run `codenine serve --lan`. Use this from a source
checkout: on Linux and macOS `codenine up` also installs the
[background service](./background-service.md), which needs release archives.
Either way, Codenine then
accepts connections from your local network and tailnet, so a pairing code is
all that keeps other devices on them out.

If a server is already running, generate a fresh link without restarting it:

```bash
codenine pair
```

Paste the pairing URL into **Add environment** in the receiving app. Connection
settings are under **Settings → Environments**. A loopback address
such as `127.0.0.1` reaches only the device opening the link.

On a computer with the desktop app, you can open the printed `codenine://pair`
app link instead. The desktop app asks you to confirm the server address, then
adds it.

Pairing authorizes that device for future connections. Use a fresh one-time link
for each new device; you do not need the original token to reconnect. Links
created in Settings can only be copied from the client that created them while
its Sharing & access page stays open. If you leave or reload that page, create
another link to share.

### Reach one machine several ways

A machine can have more than one route: LAN, Tailscale, another VPN, a public
URL, SSH, or Codenine Connect. Tailscale shares its `100.64.0.0/10` address range with
other VPNs such as Cloudflare WARP, so an address in that range shows as VPN
unless the machine confirms it is on Tailscale. To add a route, choose **Add
route** in the machine's route list, or next to it in the Codenine Connect list.
A pairing link for a saved machine is refused when it comes from an address
that machine does not have yet; add that address with **Add route** instead.
Pairing again over an address the machine already has still works. A new route
is placed by speed, in that order, and you can reorder routes at any time.

While connected through Codenine Connect or a paired address, Codenine also learns the
machine's current LAN and Tailscale addresses and adds them as routes, so
pairing once through Codenine Connect is enough to use the LAN at home. When the
machine's LAN address changes, for example after it joins another Wi-Fi network,
the learned route follows it. The machine must allow network access for its LAN
address to be learned: **Network access** in the desktop app, or the
[local network](./background-service.md#local-network-access) choice in `codenine up`.
You can reorder a learned route, but not remove it; it
goes away with the route it was learned through, or when the machine stops
reporting that address.

Codenine connects over the first route that answers. Away from home, a LAN
address that does not answer is checked briefly and skipped. It is only tried
again, after the other routes, if none of them connect. While connected over a
later route, Codenine checks the earlier ones when your network changes, when you
return to the app, and every minute, and moves back as soon as one works.

Select the route count under the machine's name in
**Settings → Environments** to see its routes. Drag a route to change the order,
or remove it. Signing out of Codenine Connect removes only that route; a machine
you can still reach another way stays saved.

Open **Permissions** next to **Routes** to see what your current connection can do on that
environment. For a remote environment, this is in its route details. Permissions
shown there apply only to the route marked **In use**; other routes are not
checked. Direct pairing and Codenine Connect have separate sessions and may grant
different permissions.

### Balance new threads across machines

Auto balance is off by default. Enable it in
**Settings → Environments → Load balancing** to automatically choose a machine for
new threads in projects grouped across connected environments. The section
appears once two or more machines are switched on.
Each machine starts at **Normal**. Choose **Prefer** to favor it when it has CPU and
memory available, **Less often** to reduce its share, or **Manual only** to exclude
it from automatic selection. These are preferences, not fixed traffic percentages.
Preferences are saved separately in each client.

The composer checks eligible machines when choosing a draft's environment, then keeps
that choice stable. Choose **Auto balance** again to check current resources, or choose
a specific machine to override it. Choosing a branch or worktree also keeps the draft
on that machine. Existing threads stay where they started. If resource checks are
unavailable or all eligible machines are full, choose a machine manually to continue.

### Tailscale HTTPS

Join both devices to the same tailnet. In the desktop app, enable **Tailscale
HTTPS** in **Settings → Sharing & access**. Turn it off there to remove that route.

To start a command-line server with Tailscale HTTPS:

```bash
codenine serve --tailscale-serve
```

For an already-running server:

```bash
codenine pair --tailscale
```

The pairing link uses an address such as `https://machine.tailnet.ts.net/`.
The mapping created by `pair --tailscale` persists across restarts. Remove its
default-port mapping with:

```bash
tailscale serve --https=443 --set-path=/ off
```

If that port is already in use, choose another with
`--tailscale-serve-port`. See `codenine pair --help` for other pairing options.

## Desktop-managed SSH

In the desktop app, open **Settings → Environments → Add environment**, choose
**SSH**, and enter a host or SSH alias such as `user@example.com`. Codenine starts
or reuses a server there and opens the port forward for you. Projects, provider
credentials, and agent work stay on the remote machine.

The remote host must be Linux or an Apple Silicon Mac with `curl` or `wget`,
`tar`, `sha256sum` or `shasum`, and [provider setup](./install.md#providers).
When the host has no `codenine` installed, the first launch downloads Codenine's server to
`~/.codenine/runtime` on the host from a release archive. No releases are published yet, so this
works only with [release archives you host](../operations/release.md).
Provider CLIs must be on the `PATH` of a non-interactive login shell there;
check with:

```bash
ssh user@example.com 'sh -lc "command -v claude codex"'
```

If SSH reconnecting fails after an app update, retry the launch once. Removing
the connection stops a server that Codenine launched; a server that was already
running is left alone.

Each desktop app keeps one session on the host for its SSH connection and reuses
it when it reconnects. Revoke sessions you no longer use in **Settings →
Sharing & access** on the host, or on a headless host with `codenine auth session list` and
`codenine auth session revoke <id>`. A desktop that can still sign in over SSH pairs
again on its next connect.

## Connect an outside agent

Claude Code, Codex and other agents Codenine did not start can drive
threads on an environment through its MCP server. See
[outside agents](./outside-agents.md) for setup.

## Manage or revoke access

On the host, **Settings → Sharing & access** lets authorized administrators create
pairing links and revoke client sessions. Revoking an unused link prevents new
pairings; revoke a device's session to remove its existing access. Command-line
management is available through `codenine auth --help`.

When the app connects to more than one environment, choose one at the top of the
page. A desktop app with **Local environment** off can manage a background
service on the same machine this way, including its Codenine Connect link.

A session with an open connection stays listed after its access credential
expires.

To choose a token's permissions, pass `--scope` once for each scope you want:

```sh
codenine pair --scope orchestration:read --scope relay:read
```

The selected scopes replace the default permissions. The same option works with
`codenine auth pairing create` and `codenine auth session issue`; each command's
`--help` lists the available scopes. Without `--scope`, pairing tokens and issued
bearer sessions get every permission, including managing access and Codenine Connect.
A terminal or a full-access agent on the host can reach those as well, so a
client that should not manage access also needs to go without `terminal:operate`
and `orchestration:operate`.

To change an existing client's permissions, create a fresh pairing link with the
scopes it needs. In a browser opened directly on the environment, open that link
to replace the browser's current grant. For a saved remote environment,
use **Add Environment** with the fresh link or code; pairing
the same environment replaces its saved grant. Reconnecting alone does not change
permissions.

Grouping checkouts does not combine their permissions. Shared project settings
require `orchestration:operate` on every member environment; actions on one
checkout use that checkout's permissions.

`source-control:write` covers direct Git and pull request changes made from the
client: pushing, switching or creating branches, cloning, and removing
worktrees. It does not restrict what a task does. Starting a task in a new
worktree still creates that branch and worktree with `orchestration:operate`,
and the agent it runs can use Git however the environment allows.

Settings changes, provider management, environment maintenance, access
management, and Codenine Connect management can each be granted separately. New
pairings without `--scope` include all of them. Existing clients keep the
permissions they paired with and can stay connected after an update, but newly
separated features may require pairing again with the permissions they need.
Older clients may show controls that the server denies. Create a fresh pairing
link to change a client's permissions.

`filesystem:read` allows browsing host files, opening workspace files, and viewing
local changes. Add `filesystem:write` to allow editing files or saving plans to
the workspace. These scopes control direct file access from the client.

To remove an environment from Codenine Connect, open your account menu's **Codenine Connect**
page and choose **Deregister**. This
revokes its cloud access and frees its host space even when the environment is
offline or has been wiped. When Codenine Connect rejects a host's link, the host
shows that it was removed from Codenine Connect. To link it again, turn on
**Codenine Connect** in **Settings → Sharing & access** on a desktop host, or run
`codenine connect link` on a command-line host and then restart Codenine there. A
command-line host that released its tunnel when it last stopped may link itself
again on its next start; run `codenine connect unlink` on that host to keep it off.
Removing an environment from a device's connection settings only forgets it on
that device and doesn't change your Codenine Connect account. A device keeps a saved
environment after it's deregistered until you remove it from that device.

When idle tunnel cleanup is enabled, Codenine Connect removes a linked environment's
tunnel after it stays offline for several minutes. The environment stays linked
and keeps the same address. When the host starts again or wakes, Codenine Connect
creates a replacement tunnel on its own. You do not need to pair again. Cleanup
usually runs five to ten minutes after the tunnel goes down.

Codenine Connect also removes the tunnel of an environment running an older version of
Codenine once it has been offline for seven days. That environment shows a message
asking you to update. Start Codenine on that computer and update it to the latest
version; it reconnects at the same address without pairing again.

On a command-line host, `codenine connect unlink` disables exposure while retaining
your login; `codenine connect logout` also clears that login. Background-service
[removal](./background-service.md#manage-the-service) is separate.

Treat pairing URLs and authorization codes as passwords. Do not include them in
screenshots, logs, or bug reports.

## Codenine Connect troubleshooting

When a Codenine Connect connection fails, see
[Codenine Connect troubleshooting](./codenine-connect-troubleshooting.md). It explains each
error, where the problem is, and how to fix it.

## Using the Desktop App as a Remote Only

If a computer should only drive work running elsewhere, turn off its local environment. In the
desktop app, open **Settings → Environments** and switch off **Local
environment**. Codenine restarts without a local server: no local agents or terminals run, WSL
backends stay off, and other devices can no longer connect to this computer. Your projects,
history, and saved connections are kept, and you keep working through pairing, Codenine Connect, or SSH.

Switch **Local environment** back on in the same place to restart with your previous local
settings.
