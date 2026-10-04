# Local Markdown review evidence

Execution host: `tstang-mini.local` (Mac mini). Worktree:
`/Users/tstang/Code/worktrees/artifact-server/markdown-review`.
Branch: `feat/markdown-review`. Base/current HEAD:
`5af28ac3e52228e7f1781270ead712148fb583cc` (implementation is an uncommitted patch).
Node `v25.9.0`; pnpm `10.34.3`.

This is the bounded native child `/root/artifact_markdown_implementation` of the
parent T3 Code conversation. It is not a standalone Codex App sidebar task.
Observed runtime `CODEX_THREAD_ID`: `01a104ab-8966-7a13-9e53-7cc065a06710`;
its association with a separate persisted child session is unverified. Root
explicitly dispatched this child as **gpt-6.1-sol with high reasoning**. The shell
does not expose a model identifier; that limits runtime observation, not the
dispatch record. T3 `preview_status` reported unavailable and `preview_open` failed, so no
interactive T3 preview was verified.

## Proven locally

- `pnpm typecheck`: pass (root, web and all integrations).
- `pnpm --filter @artifact-server/web typecheck`: pass after final SVG hardening.
- `pnpm lint`: pass.
- `pnpm build`: pass (Vite emits its existing large-chunk warning).
- `pnpm exec playwright test tests/browser/review-markdown.spec.ts tests/browser/review-sandbox.spec.ts --output=/tmp/artifact-markdown-final-tests --reporter=line,json`: 4 passed; final raw proof is [focused-playwright.json](markdown-review/focused-playwright.json).
- `pnpm exec playwright test tests/browser/review-markdown.spec.ts --output=/tmp/artifact-markdown-navigation-tests --reporter=line`: 2 passed after adding actual section navigation and Annotate/Interact coverage.
- The final `pnpm verify:iteration` run passed its `check` stage: root tests
  101 files / 329 tests, Cloudflare tests 10 files / 37 tests, lint/typechecks,
  web/server and site builds, site validation, release-version validation and
  conformance validation.
- Its original browser stage passed all 29 tests, including the initial Markdown tests,
  hostile HTML containment, exact-version comments/history, HTML resources, and
  image/video preview regression coverage.
- After the visual/Mermaid pass, `pnpm test:web:prebuilt`: all 30 passed
  (2.3 minutes), including Markdown/Mermaid, existing media and HTML/history
  regressions. Full proof is [full-browser.json](markdown-review/full-browser.json).
- `pnpm exec tsx tests/browser/capture-markdown-review.ts`: pass.
- Local mocked Pulumi plans: AWS 4 passed, GCP 3 passed. These are local tests,
  not authenticated cloud deployment acceptance.
- `pnpm conformance:validate` and `pnpm conformance:tests` passed after attaching
  local MDN-001/002/003 proof. The Markdown requirements are behavior-verified locally;
  hosted deployment proof remains unverified.

The focused Markdown assertions extracted from the official full-browser report
are in [browser.json](markdown-review/browser.json). They exercise real staged
publication and HTTP comment services, actual rendered UI feedback, original CRLF
byte equality after revision, and historical feedback inspection. CLI/MCP
publication production paths were unchanged; a separate new Markdown-specific
CLI/MCP transport case was not added.

The representative screenshot set is in [design/](markdown-review/design/).
Desktop embedded (1280 x 960), desktop focus (1440 x 960), narrow focus and
embedded (390 x 844) were captured in **light and dark** and actually inspected.
The embedded narrow capture waits for the native catalog collapse to finish.
Representative views:

- [Light reading](markdown-review/design/desktop-embedded-light.png) /
  [dark reading](markdown-review/design/desktop-embedded-dark.png).
- [Light table/quote/tasks](markdown-review/design/desktop-focus-light-table.png) /
  [dark code](markdown-review/design/desktop-focus-dark-code.png).
- [Light Mermaid](markdown-review/design/desktop-embedded-light-mermaid.png) /
  [dark Mermaid](markdown-review/design/desktop-embedded-dark-mermaid.png).
- [Narrow light](markdown-review/design/narrow-focus-light.png) /
  [narrow dark](markdown-review/design/narrow-focus-dark.png).
- [Narrow light Mermaid](markdown-review/design/narrow-focus-light-mermaid.png) /
  [narrow dark Mermaid](markdown-review/design/narrow-focus-dark-mermaid.png).

[observations.json](markdown-review/design/observations.json) records actual
regular body weight 400 and no document overflow in either theme. Gutters,
hierarchy, subtle tables, single task markers, source-image captions, accessible
syntax colors, collapsed outline and a toolbar-safe focus inset were refined
against screenshots. Mermaid uses flat quiet nodes, theme-aware text and no
clickable links. Generated CSS is kept out of diagram comment quotes.
The older desktop.png/narrow-focus.png retain the initial pre-polish evidence.

## Complete gate status

`pnpm verify:iteration` did **not** finish. It stalled while Docker attempted to
pull the absent pinned image
`pgsty/silo@sha256:b616a0cf8cb281e7e6bb3c9b1fb53875b4016a2878223925541c18f82d6c5ca3`
at `verify:object-storage` / `test:storage-s3`. Only the owned Docker CLI PID
97226 was stopped (SIGTERM ignored; SIGKILL ended it). Its parent script's cleanup
trap completed; exec session 88252 ended with exit 137. Exact-prefix checks found
no remaining container or volume for `artifact-server-minio-97197` and no parent
script PID 97197. No Docker, network, or global configuration was changed.

The remaining storage, coverage, local-package, performance, compose, Helm and
OIDC stages were never reached and remain unverified. The prior local log is
`/tmp/artifact-markdown-verify-complete.log`. The full infrastructure gate was not
repeated for this visual pass.

No remote fork, push, PR, deployment, paid-provider evaluation, service
configuration changes, or credential setup was performed.

See [design and limits](../../docs/markdown-review.md) and
[contracts](../spec/markdown-review-spec.md). Mermaid is a static isolated SVG with readable source fallback;
source locations describe primary blocks rather than exact character selections;
external links remain constrained by the existing iframe sandbox.

## Current scope and limits

Runtime additions are pinned `markdown-it` 15.0.2, `highlight.js` 11.12.0 and
`@mermaid-js/tiny` 12.1.0. The Mermaid chunk is optional (2.83 MB / 763 kB gzip),
loaded only for a Mermaid document. Invalid input and unsupported configuration,
HTML, links, styles, images/icons or resource URLs stay readable as source.
Tiny excludes mindmap/architecture/KaTeX/ELK; no authenticated cloud proof or new
standalone CLI/MCP transport test was run. Diagram anchors cover the figure/fence,
not individual nodes. Cross-version reanchoring and precise inline source spans
remain unsupported. The existing sandbox still constrains external-link popups.

No local commit was created: the coherent patch remains available for root visual
and code review on `feat/markdown-review`, HEAD unchanged from the base above.

## P2 statement-policy review fix

The independent reviewer found that line-start-only matching missed valid
semicolon statements. `classDef default fill:red`, `style A fill:red`,
`linkStyle 0 stroke:red`, and a protocol-relative `click` were tested separately,
with no HTML, JavaScript/HTTP scheme or CSS resource trigger to mask the defect.
The original runtime rendered all four instead of showing source fallback:
[before proof](markdown-review/statement-regression-before.json).

A simple quote scanner was insufficient. Separate pre-fix probes confirmed
suppression via a literal backslash before a closing quote, bare backticks,
percent signs inside node text, and quotes in accessibility/direction text modes:
[quoting](markdown-review/statement-quoting-before.json),
[comments](markdown-review/statement-comments-before.json),
[metadata/direction](markdown-review/statement-metadata-before.json).

`mermaid-runtime.ts` now inspects the pinned parser's actual directive tokens
before producing SVG. Normal quoted labels and whole-line comments stay valid;
unsupported statements become readable source without losing the linked node's
text in SVG cleanup. The new browser regression contains ten independent rejected
sources and a normal quoted-label/comment control. It verifies retained source,
actual labels, no tracking request and the unchanged opaque `allow-scripts` sandbox.
The existing source-aware comment/revision and hostile HTML tests remain intact.

Final commands:

- `pnpm lint`: passed.
- `pnpm --filter @artifact-server/web typecheck`: passed.
- `pnpm build`: passed, with the existing large-chunk warning.
- `PLAYWRIGHT_JSON_OUTPUT_FILE=project/evidence/markdown-review/statement-regression-after.json pnpm exec playwright test tests/browser/review-markdown.spec.ts tests/browser/review-sandbox.spec.ts --output=/tmp/artifact-markdown-statement-after --reporter=line,json`: **5 passed**.
- `git diff --check`: passed.

[After proof](markdown-review/statement-regression-after.json) is the native
Playwright report. The earlier 30-test result predates this bounded review fix;
it was not rerun. The full infrastructure gate remains incomplete as described
above. No commit or publication was performed, and branch/base/HEAD remain unchanged.

Limitation: the robust flowchart check uses Mermaid 12.1.0's internal parser lexer
and symbol table; upgrades require revalidation and a missing flowchart lexer
fails closed. Non-Jison types retain conservative statement screening, not a full
grammar proof for all diagram types. No CSP, sandbox, permission, source-storage,
comment-lifecycle or dependency changes were made in this continuation.
