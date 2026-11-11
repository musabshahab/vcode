# Diagnostics data

Codenine does not send product usage events, and a build from this repository sends no
diagnostics by default. This page lists what can leave your machine once you configure it, and
how to turn it off.

## Relay connection diagnostics

This applies only to a build configured for a Codenine Connect relay with relay tracing set up.
Such a build sends relay connection traces to that deployment's trace store to diagnose
Codenine Connect connectivity. Traces can include connection timings, environment identifiers and
the connected machine's name. Failed spans can include error messages and stack traces; error text
can quote a value the app was handling.

To disable relay tracing from the server, set
`CODENINE_TELEMETRY_ENABLED=false` in its environment before starting it. Relay tracing also stops
when `CODENINE_OTEL_SDK_DISABLED` or `OTEL_SDK_DISABLED` turns OpenTelemetry export off.

The desktop app reads `CODENINE_TELEMETRY_ENABLED` from your shell profile (for example `~/.zshrc`) on macOS and
Linux, so export it there and restart the app. On Windows, set it as a user environment variable.

The web app in a browser, including one the `codenine` CLI opens, does not read these environment
variables. When its build has relay tracing configured, it sends its own connection traces even
if the server has opted out. The browser app has no relay tracing toggle.

## Agent activity

When **Publish agent activity** is enabled on a host linked to Codenine Connect, the host sends
project and thread titles, model names, activity status, and environment and thread identifiers to
that relay. This is separate from relay diagnostics, and the telemetry opt-out does not disable it.

To stop publishing, turn off **Publish agent activity** under **Settings > Sharing & access** on
the host.

## Export diagnostics to your own receiver

To send traces, metrics, or logs to an OpenTelemetry receiver, open
**Settings > Maintenance > Diagnostics**, select an environment, and enter each signal's OTLP HTTP
endpoint under **OpenTelemetry export** (for example `http://localhost:4318/v1/traces`). Save, then
restart that environment's server. The receiver must be reachable from the server's machine.
**Test** sends an empty export from the server to check an endpoint before or after you save it;
saved endpoints are checked when the section opens. Checks send authentication headers only to
the signal's currently running endpoint and do not follow redirects. To check a new endpoint
that requires authentication, save it and restart the server first.

`CODENINE_OTLP_*_URL` and standard `OTEL_EXPORTER_OTLP_*` environment variables override the saved
settings. An overridden signal shows **Set by environment** and names the variable that set it, and its
**Test** checks the running endpoint instead of the field. For endpoints saved here or set with `CODENINE_OTLP_*_URL`, set `CODENINE_OTLP_HEADERS` for
receivers that need authentication and `CODENINE_OTLP_PROTOCOL=http/protobuf` for receivers that do
not accept JSON. An endpoint set with `OTEL_EXPORTER_OTLP_*` takes its headers and protocol from
`OTEL_EXPORTER_OTLP_HEADERS` and `OTEL_EXPORTER_OTLP_PROTOCOL` instead.
