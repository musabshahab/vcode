# Codenine docs

Codenine is early. These pages describe what the code does today: Codex and Claude threads,
delegation to subagents, teams that a lead agent proposes and you approve, checkpoints and diffs,
the terminal, worktrees, and pull requests.

## Using Codenine

- [Install Codenine](./user/install.md)
- [Welcome page](./user/welcome-page.md)
- [FAQ](./user/faq.md)
- [Working with threads](./user/thread-sidebar.md)
- [Messages and context](./user/composer.md)
- [Files in question answers](./user/question-attachments.md)
- [Activity log](./user/activity-log.md)
- [Permission modes](./user/permission-modes.md)
- [Secrets](./user/secrets.md)
- [Terminal history](./user/terminal.md)
- [Source control](./user/source-control.md)
- [Prompt links](./user/prompt-links.md)
- [Settings and project overrides](./user/project-settings.md)
- [Appearance and themes](./user/appearance.md)
- [Keyboard shortcuts](./user/keybindings.md)
- [Keyboard focus](./user/keyboard-focus.md)
- [Text generation models](./user/text-generation.md)
- [Usage and limits](./user/usage.md)
- [Context in portable handoffs](./user/portable-handoffs.md)
- [Diagnostics data](./user/telemetry.md)
- [Remote access](./user/remote-access.md)
- [Codenine Connect troubleshooting](./user/codenine-connect-troubleshooting.md)
- [Outside agents (MCP)](./user/outside-agents.md)
- [Running in the background](./user/background-service.md)
- [Updating Codenine](./user/updating.md)
- [Threads from an older database](./user/thread-migration.md)
- [Open source licenses](./user/open-source-licenses.md)
- Provider guides: [Codex](./user/providers-codex.md) · [Claude](./user/providers-claude.md)

---

## Working on Codenine

Start with the [development runbook](./operations/development.md) and the
[contribution guide](../CONTRIBUTING.md).

Internal notes preserve architectural decisions, constraints, and implementation traps that the
source alone does not explain. Most code changes do not need an internal documentation update. Follow the
[documentation rules](../AGENTS.md#documentation) before adding one.

- [Architecture overview](./internals/overview.md)
- [Glossary](./internals/glossary.md)
- [Effect services](./internals/effect-services.md)
- [Testing](./internals/testing.md)
- [Web UI](./internals/web-ui.md)
- [Connection runtime](./internals/connection-runtime.md)
- [Providers](./internals/providers.md)
- [Adding a provider](./internals/adding-a-provider.md)
- [Model classification](./internals/model-manifest.md)
- [Context handoffs](./internals/context-handoffs.md)
- [Team tasks](./internals/team-tasks.md)
- [Remote environments](./internals/remote.md)
- [Server updates](./internals/server-updates.md)
- [Environment auth](./internals/environment-auth.md)
- [Codenine Connect](./internals/codenine-connect.md)
- [Composer context references](./internals/composer-context-references.md)
- [Composer editors](./internals/composer-editors.md)
- [Assistant citations](./internals/assistant-citations.md)
- [Terminal runtime](./internals/terminal-runtime.md)
- [Performance regressions](./internals/performance-regressions.md)
- [Action names](./internals/consistency-action-names.md)
- [Legacy orchestration migration](./internals/legacy-orchestration-migration.md)
- [Open source license notices](./internals/open-source-licenses.md)
- [Dev container](./internals/devcontainer.md)
- [Orchestration V2 design notes](./orchestration-v2/README.md)

### Runbooks

- [Development and local builds](./operations/development.md)
- [Observability](./operations/observability.md)
- [Live background-work verification](./operations/background-verification.md)
- [Releases](./operations/release.md)
- [Codenine Connect setup](./operations/connect-setup.md)
- [Relay observability](./operations/relay-observability.md)
