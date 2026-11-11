# Prompt links

A prompt link opens Codenine with a prompt ready to send. Use one to share a prompt, or to put a
one-click fix in a pull request comment.

A link never runs anything. It opens a draft. You read the prompt, then press Send. A link cannot
change your permission mode, branch, or worktree. Your own defaults apply.

## Make a link

Open the command palette and choose **Copy prompt link**. It copies the draft in the composer. The link is a
`codenine://new?…` link that opens the desktop app.
When the project is on GitHub, **Copy prompt link with repo and model** also adds the repository
and the model you picked. Sent messages have a **Copy prompt link** button too.

You can also write a link by hand:

```
codenine://new?prompt=Summarize%20this%20repository
codenine://new?prompt=Fix%20the%20build&repo=owner/name&provider=codex&model=gpt-5.5
codenine://new?pr=owner/name/123&prompt=Fix%20the%20failing%20check
```

| Parameter  | Meaning                                                                       |
| ---------- | ----------------------------------------------------------------------------- |
| `prompt`   | The prompt. Required, except on pull request links. At most 8,000 characters. |
| `repo`     | A GitHub repository, as `owner/name` or its URL.                              |
| `provider` | A provider such as `codex` or `claude`.                                       |
| `model`    | A model of that provider, by its id or name.                                  |
| `pr`       | A GitHub pull request, as `owner/name/123` or its URL.                        |

Encode the prompt for a URL. In JavaScript, use `encodeURIComponent`.

## Open a link

- **No `repo`**: the draft opens without a project, on the machine you used last.
- **`repo`**: the draft opens in your most recently used project for that repository. A fork
  counts only for its own owner. When you do not have the repository, choose **Clone** or **Use
  without project**.
- **`provider` and `model`**: used when you have that provider set up. Otherwise your default
  model is used, and Codenine tells you.
- **`pr`**: opens the thread linked to that pull request on any connected machine, with the prompt
  in its composer. When no thread is linked, the draft goes on the pull request branch in a new
  worktree. Codenine checks the code out only after you confirm, because the checkout runs your
  setup script on it.

A thread link with a prompt puts the prompt in that thread's composer. If you already typed a draft there, Codenine asks
before it replaces it.

Codenine removes characters you cannot see, such as zero-width and hidden tag characters, because
they can hide instructions for the agent. When a prompt had them, Codenine warns you that it may be
malicious.

## Share a thread

**Copy thread** copies a `codenine-thread://` link. Paste it anywhere, such as Slack, a GitHub
comment, or your notes. Only someone connected to the machine that runs the thread can see it. In
Codenine, a thread link in a message opens the thread in the app.

A build that names its own hosted web app with `CODENINE_HOSTED_APP_URL` copies `https://` links
to that app instead, for both prompts and threads.
