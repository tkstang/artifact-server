# Design review plan (October 2026)

Run of the `design-review` skill in implement mode, driven by [`HANDOFF.md`](./HANDOFF.md).
The handoff wins where the skill differs.

- **Branch:** `feat/design-review-2026-10`, from `main` at `a20a64c`.
- **Direction:** calm, document-first and approachable, like Notion or Google Docs,
  while staying fast and precise for agent workflows.
- **Data:** synthetic only. The harness (`tests/support/runtime-harness.ts`) starts a
  temporary installation with a temporary data directory for every capture and every
  reviewer. No real instance is touched, so no guard proxy is needed.
- **Operator checkpoint:** the operator asked to see the direction and inline mockups
  after `DIRECTION.md`, before any product code changes (option A).

## Surfaces and states

| Surface | States |
| --- | --- |
| Sign-in / gate | unauthenticated landing, bad or expired token |
| Catalog | empty project, populated, long titles and many tags, collapsed |
| Workspace header | default, narrow |
| Renderer: HTML | populated, focus mode |
| Renderer: Markdown | showcase document, table, code, image, Mermaid, long document, focus mode |
| Inspector | details, tags, files, versions, activity, comparison |
| Comments panel | none, several open, composer open, reply composer, resolved, agent reply, many (20+) |
| Send to agent | send-all control, send dialog, toast, agent replying, presence avatar and popover |
| Sharing | share dialog, public link on and off |
| Settings | projects, project detail, MCP, WebMCP, members, API keys, public links, not found |
| Empty, error and gate | artifact not found, version unavailable, server offline |

Widths: 1440, 1024 and 390. Themes: dawn (light) and moon (dark).

## Capture matrix

- Script: `tests/browser/capture-design-review.ts`, extending the patterns in
  `capture-frontend-mvp.ts` and `capture-markdown-review.ts`.
- Per cell: screenshot, accessibility snapshot, axe WCAG 2 A/AA violations, and an
  `index.json` row (`id`, `surface`, `state`, `width`, `theme`, `path`).
- Baseline output goes to the ignored scratch area. Committed before/after pairs are
  selected from the matrix into `project/evidence/design-review-2026-10/`.
- The same script runs unchanged for the after state.

## Reviewer roster

| Lens | Family A | Family B |
| --- | --- | --- |
| UX researcher | Claude Opus 5.5, high | GPT-6.1-Sol, high |
| UI designer | Claude Opus 5.5, high | GPT-6.1-Sol, high |
| Product manager | Claude Opus 5.5, high | GPT-6.1-Sol, high |

Reviewer slugs are family-neutral (`ux-a`, `ux-b`, …); the mapping lives in local
scratch only. Later roles run on the family opposite the author: the fact-checker on
GPT-6.1-Sol (the orchestrator writes the synthesis on Claude), one acceptance reviewer
on each family, and the code reviewer on GPT-6.1-Sol.

## Artifact paths

| What | Where | Tracked |
| --- | --- | --- |
| Plan, synthesis, direction, `clusters.json`, `run.json`, acceptance report | `project/research/design-review-2026-10/` | yes |
| Before/after PNGs and `index.json` | `project/evidence/design-review-2026-10/` | yes |
| Baseline and after matrices, lens folders, probe logs, mockup renders | `test-results/design-review/` | no (gitignored) |

## Commands

```bash
pnpm install && pnpm exec playwright install chromium && pnpm build
tsx tests/browser/capture-design-review.ts --out test-results/design-review/before
node test-results/design-review/tools/check-clusters.mjs   # one-cluster rule
pnpm check && pnpm test:web                                # after every slice
tsx tests/browser/capture-design-review.ts --out test-results/design-review/after
pnpm verify:iteration                                      # final gate (Docker available)
```

After the reviewers finish, and after every implementer lane, compare the working tree
with `test-results/design-review/baseline-snapshot.txt`; nothing may change outside
the ignored area except the lane's own files.
