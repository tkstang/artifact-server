# Review guide

Review is the web app at `/review`, where people read published artifacts,
comment on them, and send comments to connected agents.

## Header

The header names the artifact and its version chip: "Version N" for the current
version, or "Version N of M" for an older one, followed by when it was saved.

- **Commenting/Reading** toggle, shown for HTML and Markdown when you can
  comment. In Commenting, click an element or select text to comment on it. In
  Reading, links and controls in the document work normally; selecting text
  still lets you comment.
- **Share** opens the sharing options described below.
- **Full screen** (F) hides the catalog and inspector. Press ⌘ or Ctrl + \ to
  show hidden viewer controls again.
- **More actions** holds **Open raw artifact** and **Download**.

## Share

**Copy review link** copies the exact review link: it stays pinned to the version
you are looking at and opens it in full screen. People with access to this
server can open it and comment. **Manage access** switches the artifact between
Private and Public link.

**More ways to share** has the other options:

- **Latest** link: moves when a new version is published.
- **Raw** link: the exact version without Review controls.
- **Copy review prompt**: one complete prompt for an AI agent, with a
  **Connect MCP** shortcut.

## Comments

The Comments tab lists comments on the selected version. Each comment is in one
of three states, and the filters show them as follows:

| State | Shown under |
| --- | --- |
| Open | Open and All |
| Sent to an agent | Sent, with its delivery status (Queued, Claimed, Delivered, Addressed, Failed or Canceled) |
| Resolved | Resolved and All |

Sent comments are not counted as open. **Send all open (N) to &lt;agent&gt;** sends
every open comment at once; the counts line shows how many are with each agent.

## Connected agents

**Settings → MCP → Connected agents** lists the agents that can receive comments,
with each one's status and working directory. Connected agents come first.
[MCP and AI agents](./mcp.md) explains how to connect one.

## Theme

On a first visit, Review follows the operating system's light or dark setting and
falls back to light. Choosing a theme with the theme button saves that choice in
the browser, and a saved choice wins over the operating system.

## Empty project

A project with no artifacts shows, in the catalog, the command that publishes to
it, with its own project ID filled in:

```sh
artifactserver publish report.html --project <project-id>
```

You can also connect an agent in Settings → MCP and ask it to publish there. See
[Command-line interface](./cli.md) for publishing options.
