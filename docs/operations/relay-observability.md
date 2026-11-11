# Relay observability

> For maintainers of a relay deployment. Using Codenine? See [docs/user](../user/).

This page applies to a Codenine Connect relay you deployed from
[`infra/relay`](../../infra/relay/README.md). Nobody runs a shared relay, so every dataset, token
and dashboard named here lives in your own Axiom organization.

## Traces

The relay Alchemy stack provisions a trace setup in Axiom for each stage:

- `codenine-relay-traces-<stage>`, the OpenTelemetry trace dataset shared by the Worker and the
  relay clients (server, web and desktop)
- `codenine-relay-otel-ingest-<stage>`, the dataset-scoped Worker ingest token
- `codenine-relay-client-otel-ingest-<stage>`, the dataset-scoped relay-client ingest token
- `codenine-relay-recent-spans-<stage>`, a view of recent request and endpoint spans

Deploy from `infra/relay` with the normal Alchemy workflow:

```sh
vp run deploy
```

Alchemy resolves account-level Axiom deployment credentials through its provider. At runtime, the
Worker receives only its scoped ingest token. Relay clients use their own separately provisioned
scoped ingest token.

The Worker emits Effect's built-in HTTP server spans plus endpoint and database child spans.
Effect's OpenTelemetry exporter stores semantic HTTP attributes below the `attributes.` prefix.
For example, for the `prod` stage:

```apl
['codenine-relay-traces-prod']
| where kind == 'server'
| extend endpoint = column_ifexists('attributes.http.route', ''),
    customAttributes = column_ifexists('attributes.custom', dynamic({}))
| project _time, name, trace_id, duration,
    ['attributes.http.request.method'],
    ['attributes.url.path'],
    ['attributes.http.response.status_code'],
    endpoint,
    relayOperation = customAttributes['relay']['operation']
| order by _time desc
| limit 200
```

The provisioned view also reads the endpoint from `attributes.http.route`. Relay-specific span
annotations are stored under `attributes.custom`; `relay.operation` is one of the emitted custom
attributes.

Prefer the provisioned view or APL queries for completed incidents instead of tailing the
Cloudflare Worker. The stack does not provision a separate query token. Scripted query access uses
the account-level `AXIOM_TOKEN` together with `AXIOM_ORG_ID`; scoped ingest tokens remain
write-only credentials for their producers.

DPoP proof failures include the stable `relay.dpop.failure_code` span attribute. A `time_window`
failure means that a signed proof was too old or too far in the future for the relay's allowed
window. It can point to a date or time problem on either device, but it can also result from a
delayed request. The client uses this category, and the absence of a category from an older relay,
to decide whether clock skew is confirmed or only one possible cause.

## Alerts

The stack provisions threshold monitors and a `codenine-relay-health` dashboard from
[`infra/relay/src/monitoring.ts`](../../infra/relay/src/monitoring.ts) when the deployment sets
`RELAY_ALERT_NOTIFIER_ID`. Paging monitors go to that notifier and need two failing runs in a row.
Warnings go to `RELAY_WARNING_NOTIFIER_ID` when it is set and are otherwise only visible in Axiom.
Each monitor's description gives its healthy baseline. The thresholds were measured on another
deployment's traffic, so revisit them against your own.

Monitors count HTTP status codes, not span errors. A request the relay cuts off at its 9 s deadline
ends as an interrupted span without an error flag, but still answers 504. `/connect` 502s are
normal: offline hosts produce most of them, retried by their clients every few seconds.

The dashboard's "Connecting" charts show connections as users see them. Web and desktop
export a root `relay.connection.attempt` span per attempt, which lasts until initial sync finishes, in
the same trace as the relay's and the host's spans. Most reconnects reuse a cached relay token and go
straight to the host, so relay latency only affects cold connects. A slow total with fast phases
usually means the client waited out an unreachable direct (LAN) route before falling back to the relay.

**Links failing / tunnel recovery failing.** Open the dashboard's "Link failures by reason" table.
`provisioning: ensure-tunnel` or `configure-tunnel` with Cloudflare 429s on the "Cloudflare API calls
by status" chart means the account hit its Cloudflare API rate limit. Ask Cloudflare to
raise it, and check whether something is calling the API in a loop (tunnel recovery from hosts is the
largest caller). Slow Postgres instead points at the database or Hyperdrive.

**Environments unreachable.** Clients reach fewer hosts than usual. Check Cloudflare Tunnel status and
recent relay deploys before suspecting hosts: a host-side problem does not move this many
environments at once.

**Cloudflare API rate limited / near its limit.** The warning fires on sustained 429s; the page fires
when they are frequent enough to stall provisioning. Compare the call volume on the dashboard with
your account's limit.

**Traffic dropped.** The Worker is down, a deploy broke it, or spans stopped reaching Axiom. Check
your relay's `/health` endpoint first.

**Tunnel cleanup stopped / tunnel deletions failing.** Warnings for the five-minute reaper that deletes
idle Cloudflare tunnels. "Stopped" counts sweeps that finished, so it also fires when every sweep
fails; a sweep fails when listing tunnels does, usually behind Cloudflare 429s. Idle tunnels are
billed until the reaper catches up, which the "Idle tunnels in Cloudflare" chart shows. A failed
sweep records no counts, so while sweeps fail the chart stops at the last good one; check the tunnel
list in the Cloudflare dashboard for current numbers. For failed
deletions, read the relay's "Failed to delete an inactive managed tunnel" warnings. To pause cleanup,
deploy with `RELAY_TUNNEL_CLEANUP_MODE=off`; see
[idle tunnels](../internals/codenine-connect.md#idle-tunnels-are-reclaimed-and-recovered).

**Links degraded / database slow.** Warnings for slow degradation. Link failures above 20% over six
hours usually mean provisioning is running into the 9 s deadline, with Postgres latency as the
usual cause.
