# Markdown review slice

Markdown is published as source through the existing CLI, MCP, and staged HTTP
publication paths. The CLI already declares `.md` as `text/markdown`; this slice
changes only the review presentation and additive client-owned anchor metadata.
No generated HTML is saved as a replacement artifact. Exact saved version IDs,
manifest paths, authorization, content leases, and immutable original bytes remain
owned by the existing services.

## Review presentation

`ReviewPreview` recognizes `text/markdown` (including MIME parameters), and `.md`
files declared as `text/plain`. It reads the exact version file, obtains that
version's existing content-domain preview lease, and derives a complete HTML
review document with `renderMarkdown`. Markdown uses the same Annotate/Interact controls and focus layout as HTML.
The same HtmlViewer used for HTML renders it in an opaque-origin iframe with `sandbox="allow-scripts"`. The viewer injects its existing trusted annotation bridge. Documents containing
Mermaid also include a trusted, self-contained diagram runtime; neither script
is part of the stored original artifact.

All image and external-link URLs are resolved before rendering. A static
`about:srcdoc` base keeps heading fragments inside this review document rather
than navigating to the raw source on the content domain. The presentation opts
into the viewer's host theme tokens. It has a bounded
reading width, responsive typography, headings and anchors, section navigation,
lists and disabled task checkboxes, tables, block quotes, fenced code highlighting,
and safe manifest images. `markdown-it` is a new pinned runtime dependency because
its CommonMark parser supplies block source ranges and escapes HTML; `highlight.js`
is a pinned runtime dependency for syntax styling without scripts inside the
artifact. The parser supplies its own TypeScript declarations. No unrelated package upgrades
are intended.

Markdown HTML is disabled: scripts, event attributes, iframes, SVG, and authored
HTML remain visible text rather than elements. Images must resolve exactly to a
manifest-listed `image/*` URL under the selected version's preview lease. Remote,
data, app-origin, non-manifest, traversal escaping the version, and malformed image
URLs are never emitted as requests. No credential-bearing app media endpoint is
introduced into the sandbox. Links accept HTTP(S), mailto, and document fragments;
external links have no-referrer/noopener/noreferrer metadata. Navigation remains
subject to the existing viewer sandbox restrictions; this slice does not grant
popups or top-level navigation. CSP, permissions, and service composition are
unchanged.

## Comment correspondence

The existing quote and HTML anchor remain present and retain their original
meaning. On submission, the host resolves the primary selector against its own
derived, inert document and adds `markdownSource` to the opaque stored anchor:

- `startLine` / `endLine`: one-based inclusive parser-derived block bounds.
- `section`: nearest preceding heading, limited to 512 characters.
- `sourceText`: original Markdown block text, normalized to LF and capped at 2,000
  characters; `truncated` explicitly reports the cap.

The rendered quote can differ from Markdown syntax (for example, bold punctuation
is absent). Source ranges describe blocks, not exact selected character spans;
inline nodes map to their closest source-bearing ancestor. Primary anchors get
source context; additional multi-target anchors keep the existing viewer contract.
Whole-document and unsupported selectors may have no source context. Agents can
retrieve the original exact source bytes using the saved version/path together
with the comment API or MCP output. There is no cross-version reanchoring. Version
2 has its own view and feedback; version 1 and its original feedback remain
inspectable using its existing historical review route.

## Reading design

A document-specific warm paper / charcoal surface follows the host light/dark
state, with deliberate fallback colors. Regular-weight system text, a restrained
title, clear section levels, and generous paragraph spacing create a quiet
reading rhythm. Gutters adapt to the preview pane rather than the whole screen.
Tables use quiet headers and horizontal overflow; tasks have one checkbox marker.
Code uses distinct, readable syntax colors in both themes. Ordinary quotes remain
simple left-rule quotations; image titles become escaped captions. No remote
fonts or style-only dependencies were added. Contents is collapsed initially.
Markdown focus mode reserves space above the viewer for the existing toolbar,
including its two-row narrow layout. The application palette remains unchanged.

## Static Mermaid diagrams

A `mermaid` fence renders as SVG with pinned `@mermaid-js/tiny` 12.1.0. Its IIFE
bundle is loaded lazily only when needed and serialized into the existing opaque
viewer, where it renders without an app API client or credentials. Strict security
and non-HTML labels are fixed by the integration. Authored configuration, HTML,
click/link directives, custom style directives, image/icon definitions and resource
URLs are outside this static diagram contract and produce a readable source
fallback. Invalid syntax also falls back without breaking the document. Sources
are bounded to 20,000 characters and 200 edges by the renderer. Generated SVG
loses active/link/resource elements and event attributes; its styles are checked
for external resource syntax. No diagram callback is bound. Theme changes rerender
the diagram in the isolated viewer. Wide diagrams scroll within their figure to
preserve labels; source remains available in a disclosure.

The Mermaid figure retains the fence's stable source-bearing ID. Pinpoint comments
on the figure preserve the rendered labels as quoted text plus the exact fence
block's source lines/section and saved version/path. This is block-level diagram
feedback, not per-node provenance. Diagram styles are outside the figure so CSS
does not pollute its quote. The tiny distribution excludes mindmap, architecture,
KaTeX and ELK features; unsupported syntax remains readable as source. Its optional
2.83 MB (763 kB gzip) bundle is a tradeoff, not loaded for ordinary Markdown.

The upstream [Mermaid usage/security documentation](https://mermaid.js.org/config/usage.html)
describes the tiny IIFE and strict security mode. Authored HTML remains disabled
independently of Mermaid, and no CSP/sandbox/permission grants were changed.

### Statement policy after review

Unsupported `style`, `classDef`, `linkStyle` and `click` statements must fall back
regardless of newline or semicolon placement. Mermaid 12.1.0's Jison parser tokens
are checked before SVG rendering using the pinned `mermaidAPI.getDiagramFromText`
result. This distinguishes actual directives from quoted labels, comments and
special text modes (accessibility titles/descriptions and direction statements).
The checker uses the parsed/preprocessed text and the parser's own context and
symbol table; it does not invent a second complete Mermaid grammar. Token scanning
has an input-derived completion bound, and a missing expected flowchart lexer
fails closed. Parsing and policy checking still run only in the opaque viewer.

This deliberately couples policy to the pinned parser's internal lexer/symbol
shape. Mermaid upgrades must retain the focused normal/hostile browser checks.
Non-Jison diagram types retain conservative source screening; this is not a
comprehensive grammar proof for every Mermaid diagram type. That fallback detects
newline/semicolon statement boundaries while preserving double-quoted label text
and applying the pinned whole-line comment preprocessing. It does not interpret
literal backslashes as quote escapes or bare backticks as string delimiters.

The pin-specific behavior is backed by the [flowchart grammar](https://github.com/mermaid-js/mermaid/blob/mermaid%4012.1.0/packages/mermaid/src/diagrams/flowchart/parser/flow.jison),
[comment preprocessing](https://github.com/mermaid-js/mermaid/blob/mermaid%4012.1.0/packages/mermaid/src/diagram-api/comments.ts)
and [parsed diagram API](https://github.com/mermaid-js/mermaid/blob/mermaid%4012.1.0/packages/mermaid/src/Diagram.ts).

## Deferred

Guest identities, share authorization, lifecycle changes, editor behavior,
per-character source spans, cross-version reanchoring and a new history model are
outside this slice. GFM alert callouts currently render as ordinary safe quotes.

## Evidence

`tests/browser/review-markdown.spec.ts` publishes a CRLF Markdown + local PNG bundle,
checks rendered structure and hostile-content boundaries, makes a real UI comment,
reads the stored quote/source/version/path through the agent HTTP API, publishes
version 2, and compares the downloaded version-1 bytes literally. It then revisits
both versions and verifies historical feedback stays on version 1. The same suite
also checks `.md` declared as plain text. The Mermaid test proves real SVG,
light-theme switching, invalid/hostile fallback, source-aware diagram comments,
byte-preserved v1 and historical feedback after v2 publication.

The suite writes `markdown-desktop.png` and `markdown-narrow.png` into its normal
Playwright test-results folder. Existing `review-sandbox.spec.ts` independently
checks hostile executable HTML containment. The final local validation results
are recorded in `project/evidence/markdown-review-local.md`.

At narrow widths, the existing catalog/inspector shell is wider than the screen.
The existing focus review route (`view=focus`) provides the readable narrow
Markdown view tested at 390 CSS pixels. The catalog/inspector can also be collapsed for embedded narrow reading. Only
Markdown focus mode has a scoped toolbar inset; broader mobile shell changes are
outside this slice.

`tests/browser/capture-markdown-review.ts` publishes the representative
`tests/browser/fixtures/markdown-showcase.md` plus its local SVG illustration and
captures desktop embedded/focus and narrow embedded/focus views in both themes.
Screenshots and body/overflow observations live in
`project/evidence/markdown-review/design/`. These images were visually inspected;
the hostile fixture stays separate from this aesthetic showcase.

## Local manual review

From this worktree, after `pnpm build`, start an isolated loopback installation:

```sh
pnpm artifactserver start --data .artifact-server/markdown-review-demo --port 8799
```

In another terminal, publish this design note as a Markdown artifact:

```sh
pnpm artifactserver publish docs/markdown-review.md --data .artifact-server/markdown-review-demo --server http://127.0.0.1:8799 --name "Markdown review demo"
```

Open the returned review link. Use Interact mode for document navigation and
Annotate mode for comments. The data path is gitignored and local to this worktree.
The automated synthetic v1/comment/v2 demonstration remains in the browser test.

To regenerate the visual evidence using only the local harness:

```sh
pnpm build
pnpm exec tsx tests/browser/capture-markdown-review.ts
```
