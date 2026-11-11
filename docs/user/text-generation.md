# Text generation models

Codenine writes some text for you: thread titles, commit messages, pull request titles and
descriptions, and branch names. Pick the model for this in
**Settings → Threads → Text generation model**. **Settings → Source control** can pick a different
one.

By default, a coding agent such as Codex or Claude writes this text, starting a session for each
request. A **text generator** — a model API that only writes text — is usually faster and cheaper.

## Add a text generator

Go to **Settings → Providers → Text generators** and choose **Add generator**:

- **OpenAI** or **Anthropic** — enter an API key.
- **OpenRouter** — enter an OpenRouter key to use any model it serves.
- **Custom (OpenAI-compatible)** — enter the base URL of any other endpoint, such as Ollama at
  `http://localhost:11434/v1` or LM Studio. Local endpoints usually need no key. The environment's
  server makes the requests, so on a remote environment `localhost` means that machine, not yours.

Give it a name if you add more than one from the same service. Your key is stored on the
environment.

Codenine lists the service's models to check the connection, then shows the model picker for each
text task so you can switch any of them to the new generator, or keep what they use. **Test** next
to a picker has the chosen model answer a tiny prompt, which proves the key works; some services
list their models without checking it. **Show models** in the generator's menu lists its models
and refreshes the list after the service adds some.

Each request sends the API what the task needs, such as the staged diff for a commit message.

Turning a generator off or removing it sends its work back to the environment's text generation
model.
