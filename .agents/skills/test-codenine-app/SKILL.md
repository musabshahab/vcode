---
name: test-codenine-app
description: Test Codenine's web and desktop UI in a browser against isolated development state. Use for browser verification of a UI change, browser pairing recovery, and test fixtures.
---

# Test Codenine web and desktop

Verify user-visible changes in the running app, not only in tests. Codenine has no
built-in browser panel, so drive the app with the browser automation your own
harness provides. Web and desktop share one UI, so the web app covers most
changes; use `vp run dev:desktop` only for Electron-specific behavior. There is
no mobile app.

## Start the app

Reuse this task's healthy dev server. Otherwise run `vp run dev` from the
repository root and retain its terminal session. Use the worktree's ignored
`.codenine` state and read the actual ports and pairing URL from the dev-runner output.
Never run against `~/.codenine/userdata` or set `VITE_HTTP_URL` or `VITE_WS_URL`.

Test with meaningful project and thread data. Read
[references/sqlite-fixtures.md](references/sqlite-fixtures.md) only when
inspecting or seeding SQLite. Stop the test server before direct fixture writes.

## Agent turns cost money

There is no free provider. To show a state without running a model, seed it:
copy real data into the worktree (see Test data in `AGENTS.md`) or write a
projection fixture as the SQLite reference describes. When the test needs a real
turn, use the provider's cheapest model, such as Haiku for Claude or Luna for
Codex. You can start one from the terminal against the dev server's state:

```sh
node apps/server/src/bin.ts thread start --base-dir .codenine --provider <instance> --model <model> <project> "go"
```

## Open the app in a browser

Navigate your browser tool to the complete startup pairing URL once. The bare
origin does not sign in a new browser. If the token was consumed or expired, run
`node apps/server/src/bin.ts pair` for a fresh one. Keep using the same tab.

If your harness has no browser automation, say so and stop: do not install or
switch to another automation system without asking.

## Verify and retain

Exercise the affected flow and capture the state that proves it works. Keep
the server and its state available while the user inspects or iterates.
An assistant turn ending is not teardown. Stop only processes you started,
using retained terminal sessions or captured PIDs.

When sharing is requested, start with `vp run dev --share` and give the user
a fresh complete pairing URL that you have not consumed. Keep other credentials
out of screenshots, commits, and replies.
