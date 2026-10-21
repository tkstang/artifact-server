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
review document with `renderMarkdown`. Markdown uses the same Commenting/Reading toggle and focus layout as HTML.
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
including its two-row narrow layout. The application shares the same warm
neutral palette, and documents follow its light or dark theme.

## Static Mermaid diagrams

A `mermaid` fence renders as SVG with pinned [Pele](https://pele.run) 1.8.0
(MIT, `pele` on npm), a dependency-free renderer for Mermaid syntax. Its global
bundle (702 kB, 265 kB gzip) loads lazily, only for documents with a diagram, and is
serialized into the existing opaque viewer, where it renders without an app API
client or credentials. Ordinary Markdown never loads it.

The review fixes every renderer option; diagram authors never supply options or
config. Front matter and `%%{init}%%` directives would override those settings, so
a diagram that carries them keeps its source instead. Pele's own defaults decide the
rest, per its [security guidance](https://pele.run/security):

- Labels are escaped text. Pele emits no scripts, event handlers, HTML labels or
  `foreignObject`; HTML in a label is stripped.
- Links keep Pele's default schemes (`http`, `https`, `mailto`, `tel` and relative
  URLs). `javascript:`, `data:`, `vbscript:`, network paths and click callbacks are
  dropped. A surviving link opens like a Markdown link: a new tab, `noopener
  noreferrer`, no referrer.
- `style`, `classDef` and `linkStyle` apply through Pele's style filter; a style it
  can't accept, such as `url(...)`, is a syntax error.
- The frame's policy allows remote images, so a diagram that would load one (an
  `img:` shape) keeps its source, as Markdown images do. No icon or math resolver is
  installed, so `fa:` icons and TeX stay text.
- Sources are bounded to 20,000 characters and 5,000 edges.

There is no extra SVG sanitizer or worker: Pele filters the output and the opaque
sandbox stays in place. Invalid syntax, unsupported diagram types and size limits
also fall back without breaking the document. The fallback states why in text (for
example, the syntax error's line and column, with Pele's snippet) and shows the
original source. Error messages can quote diagram text, so they are only ever set
as text.

Colours come from CSS variables (`--pele-*` on `.md-mermaid`), mapped to the
document palette in each theme, so a theme change restyles the same SVG without
redrawing it. A width change redraws it, because Pele can wrap labels or turn a wide
flowchart vertical on narrow screens. Wide diagrams scroll within their figure, and
the source stays available in a disclosure.

The Mermaid figure retains the fence's stable source-bearing ID. Pinpoint comments
on the figure preserve the rendered labels as quoted text plus the exact fence
block's source lines/section and saved version/path. This is block-level diagram
feedback, not per-node provenance. Pele's styles are inline on the SVG, so CSS
does not pollute the quote.

Pele replaced `@mermaid-js/tiny` 12.1.0 (2.83 MB, 763 kB gzip). That integration
needed a post-render SVG sanitizer and a check of Mermaid's internal parser tokens
to refuse styles and click directives; both are gone. No CSP, sandbox or permission
grants were changed.

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

Open the returned review link. Contents links move through the document in
either mode; switch to Reading to use other links and controls, and to
Commenting to add comments. The data path is gitignored and local to this worktree.
The automated synthetic v1/comment/v2 demonstration remains in the browser test.

To regenerate the visual evidence using only the local harness:

```sh
pnpm build
pnpm exec tsx tests/browser/capture-markdown-review.ts
```
