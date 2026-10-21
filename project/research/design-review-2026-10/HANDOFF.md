# Handoff: design review and improvement pass (October 2026)

You are the **orchestrator** of a design, UI and UX improvement pass on this fork of
Artifact Server. You run multi-lens reviews on two model families, judge their
proposals yourself, then plan, design and **build** the improvements. You finish with
one PR that shows detailed before/after evidence and explains what changed and why
each change is an improvement. You decide the design: reviewer output is input, not
instructions.

This is the first real run of the `design-review` skill
([tkstang/personal-skills#98](https://github.com/tkstang/personal-skills/pull/98),
in implement mode). If that skill is installed on your host, read its `SKILL.md`
and references for detail. This handoff is self-contained and wins where they differ.
At the end, report any friction you had with the process, so the skill can improve.

## The goal

Today the product reads as an IDE or terminal tool. The operator wants it to feel
like **Notion or Google Docs**: calm, document-first and approachable for a broad,
non-technical audience, while staying fast and precise for the agent workflows it
serves.

Scope covers both halves of the product:

1. **The renderer:** the Markdown review document (`apps/web/src/review-frame/`,
   `markdown.ts`, `markdown.css`, the Mermaid runtime) and how HTML artifacts sit in
   the frame.
2. **The review and commenting frame around it.** That is the catalog, workspace
   header, inspector (details, tags, files, versions, activity, comparison), focus
   mode, comments panel and composers, the send-to-agent dialog and toasts, the
   presence avatar, sharing, settings, and every empty, error and gate state.

`reference-site-comments-panel.png` in this folder is the comments panel as the
marketing site shows it. It captures the aesthetic to move away from:

- monospace status text ("Pi · replying");
- square, saturated, numbered badges;
- hard 1px borders everywhere;
- a single heavy full-width button;
- a dark-first palette.

The marketing site (artifactserver.com) is not in scope.

## What already exists (reconnaissance, 2026-10-17; verify before relying on it)

- **The app.** `apps/web` is Vite, React 19, Tailwind 4 and shadcn (Base UI), with
  two entries: `review.html` (the trusted app) and `review-frame.html` (the isolated
  iframe using `HtmlViewer` from `@plannotator/ui`).
  - Main shell: `apps/web/src/review/review-app.tsx` (about 2,800 lines).
  - Comments: `review/review-comments.tsx` and `components/comments/*`.
  - Send: `components/dispatch/*`.
  - Settings: `review/settings-*`.
- **The app's real skin** is `apps/web/src/review/review.css` (about 4,000 lines),
  which uses the `--as-*` aliases. Shadcn tokens are in `apps/web/src/theme-tokens.css`.
  The terminal feel comes mostly from three things:
  - `--as-radius: 0` (`review.css:13`), plus hard-coded `border-radius: 0`;
  - about 30 `Atkinson Hyperlegible Mono` declarations and the `.as-mono` helper;
  - about 23 uppercase or letter-spacing rules.
- **Themes.** Dark ("moon") is the default and light is "dawn". The toggle is at
  `review-app.tsx:1429`, and the choice is saved in `localStorage`
  `artifact-review-theme`.
- **Markdown styling.** `markdown.css` already reads like a document: system sans,
  16/1.7, a 740px column. But its `--md-*` colours are fixed, so they don't follow
  the app theme (`reviewThemeTokens()` in `review-preview.tsx:533` copies only some
  tokens).
- **Annotation popovers** inside the frame come from `@plannotator/ui/styles.css`.
  Theme them through injected tokens. Patching that upstream package is out of
  scope unless you justify it in the PR.
- **Fork status.** `origin` is `tkstang/artifact-server`; there is no `upstream`
  remote, and upstream is `plannotator/artifact-server`. `main` is upstream v0.1.2
  plus one fork commit (Markdown/Mermaid). `review.css` is upstream's largest UI
  file, so a rewrite will conflict on every sync. Prefer token changes, override
  layers and new files over wholesale rewrites, and list the expected conflict areas
  in the PR.

## Operator decision: Mermaid through Pele

Replace the Markdown review's Mermaid runtime with Pele. Today the review uses `@mermaid-js/tiny` 12.1.0 (`apps/web/package.json`) through `review-frame/mermaid-runtime.ts`. Pele is at https://pele.run, published on npm as `pele`, and MIT-licensed; Obsidian uses it as its renderer. It outputs CSS-variable-themed SVG, so its theme can follow the new document design.

Read https://pele.run/security and https://pele.run/api before you start.

- Keep rendering inside the sandboxed content frame.
- Never let diagram authors supply `options` or `config`.
- Allow only Pele's default link and image schemes.
- Show errors as text. No extra SVG sanitizer or worker is needed: Pele already escapes and filters untrusted diagrams, and the frame's sandbox stays in place.
- Keep `.md-mermaid` and `MDN-*` conformance intact. Update `docs/markdown-review.md` to match.

Do this as its own slice, so the dependency swap is easy to review.

## Constraints you must keep

- Read `AGENTS.md`, `CONTRIBUTING.md` and `project/README.md` first, and follow
  them. Key points:
  - don't weaken TypeScript, Oxlint or anti-slop rules;
  - no module mocks;
  - test observable behaviour;
  - attach screenshots for interface changes;
  - a feature needs durable evidence.
- **The conformance ledger** (`project/spec/conformance.yml`, plus
  `project/spec/markdown-review-spec.md`) still holds. These browser specs must stay
  green:
  - `frontend-mvp.spec.ts`: CMT, PRV, ADM, AUTH and PUB IDs. It runs axe WCAG 2
    A/AA in both themes, so contrast regressions fail.
  - `review-markdown.spec.ts`: MDN-001..003.
  - `snd-send-all.spec.ts`: send-all stays the primary action.
  - `prs-004-one-click-send.spec.ts` and `prs-006-presence-avatar.spec.ts`. PRS-006
    requires a branded avatar ring, a popover that states status in words, and
    motion only on live states.
  - `drf-00*.spec.ts`, `wmc-00*.spec.ts`, `review-sandbox.spec.ts` and
    `review-wave-three.spec.ts`.
- **Tests rely on CSS class names and accessible names.** Examples: `.as-preview-panel`,
  `.as-comment-card`, `.presence-ring`, `.as-catalog`, `.md-mermaid`,
  `.as-artifact-frame`, and "Collapse artifact catalog". Keep them, or change the
  tests in the same commit with the reason.
- **Sandbox and security.** Keep the sandbox, CSP and the trust boundary between
  the app and the content frame unchanged. Add no remote fonts or CDN assets. Bundle
  any new font locally, with its licence noted.
- **Use synthetic data only.** This review needs no real user data. Use the test
  harness and fixtures: `tests/support/runtime-harness.ts`,
  `tests/support/publishing.ts` and `tests/browser/fixtures/markdown-showcase.md`.
  Add richer fixtures where states are missing: long documents, many comments,
  agent replies, resolved threads, multiple versions, empty and error cases.

## Setup

```bash
pnpm install
pnpm exec playwright install chromium
pnpm build
```

These were not installed at the time of reconnaissance.

- `pnpm dev` runs the backend on :8787 and Vite on :5173. It starts with no data,
  so publish your own through the harness helpers.
- `pnpm capture:web` runs `tests/browser/capture-frontend-mvp.ts`.
- `tsx tests/browser/capture-markdown-review.ts` (run after `pnpm build`) captures
  dawn and moon, embedded and focus views, and narrow widths.

Extend these scripts rather than starting over.

**Artifact locations:**
- **Durable** (committed in the PR): `project/research/design-review-2026-10/` for
  the synthesis, direction document, `clusters.json` and acceptance report;
  `project/evidence/design-review-2026-10/` for the before/after PNGs and
  `index.json`.
- **Local-only** scratch: raw lens output, probe logs and renders go under a
  gitignored path, such as `test-results/design-review/`.

## The process

### Phase 0: Plan (no approval gate; just record it)

Write `project/research/design-review-2026-10/PLAN.md`. It covers the surfaces and
states inventory, the capture matrix, the reviewer roster, the artifact paths, and
the commands you will run.

### Phase 1: Baseline capture (you, once)

Write one capture script, for example `tests/browser/capture-design-review.ts`,
that seeds synthetic data through the harness and captures a matrix:

- **Surfaces:** every one listed in "The goal".
- **States:** populated, empty, loading where it can be caught, error and gate,
  long content, many comments, an agent replying, resolved threads, the composer
  open, the send dialog, toasts, hover, focus and selected.
- **Widths:** 1440, 1024 and 390.
- **Themes:** dawn and moon.

For each cell save a screenshot, an accessibility snapshot and axe results, plus a
row in `index.json`. Reviewers start from this matrix. You'll rerun the same script
unchanged for the "after" state.

### Phase 2: Lens reviews (six in parallel)

Run three lenses, each on two models:

| Lens | Focus |
| ---- | ----- |
| UX researcher | Cognitive walkthroughs of the main journeys: publish, then open; read; comment and reply; send to an agent and watch the reply; resolve; compare versions; share; settings. Nielsen heuristics, a keyboard-only pass, and how honest every state is. The question throughout: can a non-technical reviewer succeed on their first visit? |
| UI designer | Hierarchy, type, spacing, colour roles and measured contrast, density, a component inventory showing inconsistencies side by side, and interaction states. Judge against the Notion/Google Docs direction. Output a component consistency table and a concrete token and rule set. |
| Product manager | Whether each surface earns its place; the mental model (project → artifact → version → comments); first-run and empty-state onboarding; the commenting and agent-reply loop as the core value; the gaps; the next bets ranked by impact × effort. |

Run each lens on both **Claude Opus 5.5 at high effort** and **GPT-6.1-Sol at high
effort**. Dispatch with whatever your host supports:

- **In T3 Code:** `delegate_task` with target
  `{providerInstanceId:"claudeAgent_claude_proxy", model:"claude-opus-5-5", options:{effort:"high"}}`
  and target
  `{providerInstanceId:"codex", model:"gpt-6.1-sol", options:{reasoningEffort:"high"}}`.
  If those IDs fail, check `orchestrator_capabilities`.
- **Elsewhere:** native subagents for your own family, and `codex exec -s read-only`
  or `claude -p` for the other family.

Don't silently fall back to a single family. If you have to, say so.

Every reviewer gets the same common brief: the goal, the users, this handoff's
constraints, the capture matrix path, and how to run its own synthetic instance on
its own port for interactions. Every reviewer:

- works independently, without seeing another reviewer's output;
- does not edit the repository, and writes only inside its own lens folder under the gitignored scratch area;
- writes `findings.json` with one object per finding: `id` (e.g. `ui-a-07`, with a family-neutral reviewer slug),
  `lens`, `category`, `title` (the problem, not the fix), `views`, `severity`,
  `evidence` (screenshot path or `file:line`), `observation`, `why_it_matters`,
  `proposal`, `alternatives`, `effort`, `confidence`;
- writes a `report.md`;
- returns the full report in its final message, in case its host blocks file writes.

Aim for 25–60 specific findings per reviewer. When the reviewers finish, and after every implementer lane, check that `git status` shows nothing outside the gitignored area. Reviewers need to run browsers and servers, so sandboxing won't enforce this for you. When `ui-ux-pro-max` is available, use
it as a guideline checklist only, not as a source of palettes.

### Phase 3: Synthesis (you)

- **Cluster.** Put every finding into exactly one cluster: a **bug** (one obvious
  correct behaviour), a **theme** (a design direction) or a **fixture gap**. Enforce
  this with a script that fails on unassigned or duplicate ids.
- **Rank** themes by severity, then by how many of the six reviewers raised them
  independently.
- **Record** where the reviewers disagreed and what each model family caught that
  the other missed.
- **Verify** every claim you'll rely on, either by reproducing it or by reading the
  code.

### Phase 4: Fact-check (mandatory)

A fresh reviewer, on the other model family from the one that made the claims,
checks every claim the synthesis makes about current behaviour or code. It cites
`file:line` for each. Apply its corrections. In the previous run of this process,
about one claim in six was wrong.

### Phase 5: Design direction (you decide)

Write `DIRECTION.md`. It contains:

- **Principles.** Three to six, for example "the document is the hero; chrome
  recedes".
- **The token plan,** with before and after values for:
  - type: a sans body; monospace only for code and identifiers;
  - sentence case instead of uppercase tracking;
  - radii;
  - spacing;
  - colour roles: a quiet neutral palette, one accent used for actions;
  - elevation, contrast pairs, and the light and dark themes.
- **Primitive consolidation.** Buttons, badges, inputs, cards, tabs, avatars and
  comment threads.
- **The comments experience,** designed with Google Docs in mind:
  - threads anchored in the margin, connected to their highlight;
  - avatars and readable names;
  - soft cards;
  - a clear Reply / Resolve flow;
  - agent replies that feel like a collaborator, not a log.
- **A verdict on every theme:** adopt, adapt or reject, each with a reason.

You also decide whether the default theme becomes light (dawn). Flag that decision
prominently in the PR.

When a decision would change a conformance requirement's meaning, don't change it
silently. Keep the requirement and note the tension, or stop and ask.

### Phase 6: Build in slices

1. Bugs, one commit each.
2. Foundations: tokens, fonts and primitives.
3. Surfaces: the renderer document, comments and composers, the shell and catalog,
   the inspector, dialogs and toasts, settings, then empty, error and gate states.

For each slice:

- Use Conventional Commits.
- Keep tests green, with selectors preserved.
- Rerun the capture for the cells the slice affects.
- Run `pnpm check` and `pnpm test:web`.

You may delegate a slice to a bounded implementer lane that owns non-overlapping
files, but you review and integrate it.

### Phase 7: Acceptance

- **Recapture the full matrix.**
- **Acceptance review.** A UI reviewer and a UX reviewer, one on each model family,
  get the before and after matrices, `DIRECTION.md` and the original findings. They
  mark each targeted finding resolved, partly resolved or not resolved, and list any
  regressions by cell id.
- **Code review.** An independent code reviewer on the other model family checks
  correctness, accessibility and contrast, test integrity, and the sandbox and
  security boundaries.
- **Respond to every finding.** Fix it, or answer it in the PR.
- **Run the gates.**
  - `pnpm verify:iteration` is the canonical gate. Some of its stages need Docker; if
    Docker isn't available, run every stage that doesn't need it (`pnpm check`,
    `pnpm test:web`, `pnpm smoke`) and report exactly which stages you couldn't run.
  - Record the axe results for both themes.

### Phase 8: PR

Open a **draft PR against this fork**:

```bash
gh pr create --repo tkstang/artifact-server --base main --draft
```

Never open it against `plannotator/artifact-server`. If your host has a
`link_pull_request` tool, call it.

The PR body includes:

- a summary;
- how the work was decided: reviewers and counts, fact-check corrections,
  acceptance results;
- the direction principles and the token table;
- **per surface:** before/after image pairs (same scenario, data, width and theme),
  then what changed, why it's better (the finding ids it resolves, the principle,
  and measured gains such as contrast, line length or density), and the states
  covered;
- the bugs fixed;
- what was rejected or deferred, and why;
- verification;
- upstream conflict areas and the selectors or names that changed.

Commit the images under `project/evidence/design-review-2026-10/`, each under about
500 KB, and embed them with branch raw URLs.

Run `pr-self-review` if it's installed, skipping any lens the acceptance and code
reviews already covered. **Do not merge.** The operator reviews and approves.

## Finish

Report back with:

- the PR URL;
- the counts (reviewers, findings, bugs, themes, slices);
- the top changes;
- the decisions the operator should check, especially the default theme and any
  font change;
- anything not done;
- the verification evidence;
- feedback on the process, for the `design-review` skill.
