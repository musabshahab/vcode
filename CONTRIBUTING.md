# Contributing

Codenine is early and changes quickly. Small, focused changes are the easiest to review.

## Set up

Install [Vite+](https://viteplus.dev/guide/) (`vp`), then from the repository root:

```sh
vp i
vp run dev
```

Open the pairing URL the dev runner prints. The [development runbook](docs/operations/development.md)
covers the desktop app, ports, state directories and desktop builds. [AGENTS.md](AGENTS.md) holds
the working rules for this repository; they apply to people as well as to coding agents.

## Before you start

- Report bugs in [issues](https://github.com/musabshahab/codenine/issues). Search for an existing
  report first.
- Propose features and behavior changes in
  [discussions](https://github.com/musabshahab/codenine/discussions) before you build them. A small fix
  for an obvious bug does not need one.
- Report security problems privately. See [SECURITY.md](.github/SECURITY.md).

## Check your change

Run the fast checks for the files you changed:

```sh
vp run check:changed
```

While you iterate, run single checks:

```sh
vp test run <files>
vp lint <files>
vp run --filter <package> typecheck
```

Do not run the repo-wide suites locally; CI runs them. Backend behavior changes need a focused
test. [Testing](docs/internals/testing.md) says what to test and what to leave out.

## Open a pull request

- Solve one problem per pull request. Include the contract, server, client, test and documentation
  changes that problem needs, and leave unrelated cleanup for another pull request.
- Use a conventional commit title in plain language, such as
  `fix(web): new threads no longer spike CPU`.
- In the description, state the problem in a sentence or two, then how you fixed it.
- Say how you checked the change and what you saw. "Tests pass" alone is not enough. Say what you
  could not check.
- UI changes need before and after screenshots. Add a short recording when motion or timing
  matters. Attach them to the pull request; do not commit them.
- If an agent wrote the change, end the description with the model and harness that did the work.
- Follow the [documentation rules](AGENTS.md#documentation). Update a user guide when how to use a
  feature changes.

Opening a pull request does not guarantee that it is reviewed or merged.
