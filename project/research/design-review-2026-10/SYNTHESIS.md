# Design review synthesis (October 2026)

Run `design-review-2026-10-17-as01` at `a20a64c`. Clusters: [`clusters.json`](./clusters.json).
Provenance: [`run.json`](./run.json). Plan: [`PLAN.md`](./PLAN.md).

## 1. What was done

- **Baseline:** 268 cells (47 surface states × 3 widths × 2 themes, minus states that
  only exist at some widths) captured by `tests/browser/capture-design-review.ts` on a
  synthetic world from `tests/browser/design-review-seed.ts`. Each cell has a screenshot,
  an accessibility snapshot and WCAG 2 A/AA axe results. Axe excludes the artifact frame,
  so document content and the in-document composer are not audited by it. No real data was used; every
  backend was a temporary installation.
- **Reviewers:** six, independent: UX researcher, UI designer and product manager, each
  on two model families (family A: Claude Opus 5.5, high; family B: GPT-6.1-Sol, high).
  Each ran its own seeded backend and browser probe. The working tree outside the
  ignored scratch area was unchanged after all six.
- **Findings:** 253 (52 high, 151 medium, 50 low): ux-a 45, ux-b 37, ui-a 41, ui-b 50,
  pm-a 48, pm-b 32.
- **Clusters:** 51, enforced one-cluster-per-finding by script: **25 bugs**, **20 themes**,
  **6 fixture gaps**.

## 2. Headline

The product is close to the requested direction in one place — the Markdown reader's
measure, warm paper and heading rhythm — and far from it everywhere around the document.
The chrome speaks in monospace, uppercase and 10–12px type inside square, bordered boxes;
dawn (light) is currently the weaker theme because of two one-line bugs that hide the
primary button label and the in-document comment markers.

The bigger problem is trust at the core loop. All six reviewers independently found that
the app tells reviewers untrue things at the moments that matter: every whole-version
comment is flagged as a broken location (B03, 6 of 6), an empty Open list after a send says
everything is resolved (B02, 5 of 6), sent comments vanish from "All" (B05, 4 of 6), and
counts change meaning between places (B17, 4 of 6). Fixing those is
cheap and comes first.

The strongest design themes are: open on the conversation, not on metadata (T08, 6 of 6);
keep the document's identity visible (T10, 6 of 6); one composer language (T06, 6 of 6);
and Google Docs-style thread cards (T05, 5 of 6).

## 3. Bugs

| Id | Bug | Severity | Effort | Reviewers | Evidence |
| --- | --- | --- | --- | --- | --- |
| B01 | Primary button labels fail contrast in dawn (2.44:1, 38 cells) | high | S | 4/6 | `review.css:60-65` unlayered reset |
| B02 | An empty Open list says all comments are resolved while sent ones are queued | high | S | 5/6 | `review-comments.tsx:739-748` |
| B03 | Open whole-version comments are flagged as broken locations | high | S | 6/6 | `review-comments.tsx:782` |
| B04 | An artifact link on a phone opens behind the catalog | high | S | 5/6 | `review-app.tsx:560` |
| B07 | Comment markers and highlights near-invisible in dawn | high | S | 2/6 | `review-preview.tsx:537` |
| B08 | Annotate mode hijacks the Markdown Contents toggle | high | S | 2/6 | reproduced by both |
| B17 | Comment counts disagree between catalog, tab and send button | high | M | 4/6 | `review-app.tsx:1520`, `:1961` |
| B12 | Retrying a comment after a lost response duplicates it | high | M | 1/6 | `review-comments.tsx:313` |
| B14 | Reload does not recover a failed HTML preview | high | M | 1/6 | `review-app.tsx:1924-1929` |
| B13, B15, B16 | Phone Show in page hidden; failed inline save loses anchor; failed first read shown as empty | high | S–M | 1/6 each | reviewer report |
| B05 | The All filter omits sent threads | medium | S | 4/6 | `review-comments.tsx:639-644` |
| B06 | Inspector tab strip overflows and clips at 1440 | medium | S | 3/6 | `review.css:2280-2287` |
| B09 | Remaining contrast failures (public pill, Delete, error red, renderer pairs) | medium | S | 4/6 | baseline axe |
| B10 | Activity scroll area has no keyboard entry | medium | S | 1/6 | baseline axe |
| B11 | Narrow Markdown tables break words mid-letter | medium | S | 1/6 | `markdown.css:45` |
| B18, B19 | Escape misses the phone inspector; tabs ignore arrow keys | medium | S | 1/6 each | reviewer report |
| B22, B24, B25 | Raw clipboard error; WebMCP shows enabled when unavailable; offline presence still "connected" | medium | S | 1–2/6 | reviewer reports |
| B21, B23, B26 | Undefined CSS tokens; Escape discards the one-time API key; stray menu divider (a leftover top border) | low | S | 1/6 each | code / baseline |

## 4. Themes, ranked

| Rank | Id | Theme | Reviewers | Families |
| --- | --- | --- | --- | --- |
| 1 | T08 | The inspector opens on technical metadata instead of the conversation | 6/6 | A, B |
| 2 | T10 | The reader loses the document's identity: title, version, mode | 6/6 | A, B |
| 3 | T05 | Comment threads are dense, small and button-heavy, with no quoted passage | 5/6 | A, B |
| 4 | T13 | Version comparison names files but never shows the change | 5/6 | A, B |
| 5 | T07 | Open has no summary of work with the agent and no finish line | 4/6 | A, B |
| 6 | T19 | No keyboard path to anchor prose; click-to-comment surprises readers | 4/6 | A, B |
| 7 | T11 | A first-time reviewer is not told who is asking or what is wanted | 3/6 | A, B |
| 8 | T01 | Typography reads as a terminal | 2/6 (both UI) | A, B |
| 9 | T02 | Hard square chrome and a cool palette compete with a warm document | 2/6 (both UI) | A, B |
| 10 | T06 | Two composers speak different languages | 6/6 | A, B |
| 11 | T15 | Sharing mixes links, audiences and agent setup in one cramped panel | 6/6 | A, B |
| 12 | T16 | Settings and agent setup cannot confirm success and do not fit phones | 6/6 | A, B |
| 13 | T14 | Activity reads as an audit log of opaque IDs | 6/6 | A, B |
| 14 | T09 | Engineering vocabulary on reviewer surfaces | 5/6 | A, B |
| 15 | T12 | Empty, error and home states are contradictory or dead ends | 5/6 | A, B |
| 16 | T03 | Components have many variants | 2/6 (both UI) | A, B |
| 17 | T17 | Busy reviews have no way to find, order or narrow feedback | 4/6 | A, B |
| 18 | T04 | Dark is the first-visit default and ignores the OS | 3/6 | A, B |
| 19 | T20 | Panels overlay the document at 1024 and 390 | 3/6 | A, B |
| 20 | T18 | The catalog shows storage facts, not what needs attention | 2/6 | A |

T01–T03 rank on severity rather than convergence: they are the UI lens's core subject,
both UI reviewers raised them independently, and the direction asks for exactly this
change. Their convergence counts are low only because the UX and PM lenses were asked
not to judge visual language.

## 5. Suggested order

1. **Trust pass (bugs):** B01, B07 (dawn is unusable without them), B02, B03, B05, B17
   (honest state and counts), B04, B06, B08, B09–B11, then the smaller ones.
2. **Loop-defining themes:** T08 (Comments first), T05 and T06 (threads and composers),
   T07 (visible agent state, within the SND/DSP contracts), T10 (identity).
3. **Foundations reused everywhere:** T01, T02, T03, T04 — one token layer and primitive
   set, then the dawn default.
4. **The rest:** T09, T12, T14, T15, T20 in this pass where they are copy and layout;
   T11, T13, T16, T17, T18, T19 need product or backend decisions and are candidates to
   defer.

## 6. Where the reviewers disagreed

- **Accent colour.** ui-a proposes a softer violet action (#5b4ec8) and purple selection;
  ui-b keeps the brand indigo (#4338ca) for actions and adds an amber annotation colour
  for comments. Settled in `DIRECTION.md`.
- **Document font.** ui-b wants the bundled Atkinson face inside documents; ui-a keeps the
  renderer's system sans. (The frame's CSP already allows fonts, `font-src * data:`; this is
  a style choice, not a security constraint.)
- **How a reviewer enters.** pm-a would make focus view the default for shared links;
  pm-b adds trusted identity to focus view and reorders the inspector; ux-a notes that
  leaving focus mode today drops a reviewer into the full shell.
- **The All filter.** ux-a and pm-a would include sent threads in All; pm-b would rename
  the filters first and keep the data semantics, to stay clearly inside SND-001.
- **Inspector structure.** pm-a proposes three tabs (Comments / History / Info); pm-b makes
  Compare a task inside version history; ui-b folds Activity and Compare into Details and
  Versions.
- **Density.** ui-a asks whether operators need a compact option once threads become
  roomier.

## 7. Model differences

Both families converged on every top theme, so the ranking does not depend on one
model's taste.

- **Family B (GPT-6.1-Sol)** did failure injection — lost save responses, a 503 comment
  read, offline polling, a failed preview lease — and found every failure-path bug that
  only one reviewer reported (B12–B16, B25). It also measured more contrast pairs.
- **Family A (Claude Opus 5.5)** read the stylesheet and frame wiring more closely: the
  unlayered reset behind B01, the token mapping behind B07, undefined tokens (B21), the
  stray menu divider (B26), and the five type families on one screen. Its claim that the
  composer's icon buttons lack names was wrong (they are named by `title`); that finding
  now sits in T06 without a bug.
- Both PM reviewers produced compatible next bets: close the loop, a reviewer-first front
  door, show what changed.

## 8. Fixture plan

| Id | Gap | Addition |
| --- | --- | --- |
| F01 | The agent never completes the loop; its replies claim edits no version contains | Script claim → deliver → reply → publish version 4 → resolve, and leave one thread "with Pi" |
| F02 | All events share a compressed afternoon | Advance the clock between comments and replies |
| F03 | No members, external reviewer, publisher or second agent | Seed members and a second, disconnected agent |
| F04 | Busy and Markdown threads are page-level clones | Anchored threads across sections, varied lengths |
| F05 | Filler pages are unstyled stubs | A minimal stylesheet |
| F06 | The empty project wins the bare URL | Keep Default first |

## 9. Strengths to keep

- The Markdown reader: 740px measure, 16/1.7 rhythm, warm paper, restrained heading
  scale, code and Mermaid treatment, local images, and a section outline.
- Atkinson Hyperlegible Next as the UI face (already bundled locally).
- Send-all as the leading primary in the comments panel (Post comment is a second filled
  button), with a caret for agent choice and a note; one-click send and Undo.
- The presence avatar's branded ring, worded status and motion only on live states.
- Exact-version sharing that says which version the link pins.
- Public links' responsive card layout, which settings can reuse.

## 10. Questions for the operator

1. Make light (dawn) the first-visit default, following the OS preference?
2. Keep the brand indigo as the action colour and add a warm amber for comments, or move
   to a single softer violet?
3. Serve the bundled Atkinson face to documents (no CSP change needed), or keep the
   renderer's system sans?

## 11. Method and limits

- Synthetic data only; no guard proxy was needed. The fixed server clock advances during
  publication and then freezes for comments, replies and presence (F02).
- Not exercised: real OIDC sign-in and non-owner permission gates (single local owner),
  the live agent lifecycle beyond "queued" (F01), multiple agents, OS-level shortcuts.
- The handoff described the Markdown colours as fixed; they already follow light and dark
  (`markdown.css:1-29`), mixed with app tokens. This synthesis corrects that.
- The fact-check is recorded in section 12.

## 12. Fact-check

A fresh reviewer on the other model family (GPT-6.1-Sol, high) checked every claim in this
document and `clusters.json` against the code, the baseline and the contracts: **222 claims —
162 confirmed, 7 wrong, 49 partly right, 4 unverifiable** (about one in four needed a fix).
All corrections are applied above and in `clusters.json`. The material ones:

- B20 was not a bug: the composer's expand and close buttons are named by `title`. Removed;
  its finding moved to T06. 25 bugs remain.
- The content frame's CSP already allows fonts (`font-src * data:`); the document-font choice
  is a style decision, not a security one.
- CMT-015 keeps comments closed on review routes (focus view): "Comments first" applies to
  the workspace inspector only. At narrow widths panels must overlay, not push, the artifact.
- DSP-004 excludes dispatched threads from every default listing, so "All" cannot simply
  include them; the fix is honest copy and a link to Sent.
- Counts and line references corrected: 47 states; 38 cells for B01; B12 at line 313; B21 and
  B24 references; B26's divider is a leftover top border; T07's Sent view already shows
  dispatch states (the gap is in Open).

Raw output: `test-results/design-review/factcheck/` (local only).
