# Design direction (October 2026)

Status: **approved by the operator on 2026-10-20** with every recommendation accepted, plus
one addition: the connected-agents list in Settings moves into this pass.
Fact-check corrections ([`SYNTHESIS.md` §12](./SYNTHESIS.md)) are applied.
Inputs: [`SYNTHESIS.md`](./SYNTHESIS.md), [`clusters.json`](./clusters.json). Mockups were
rendered on the real app with a prototype override layer and synthetic data.

## Principles

1. **The document is the hero; chrome recedes.** Panels sit quietly on a warm canvas.
   Borders appear only where panes meet and around inputs. One filled button per region.
2. **Tell the truth about state.** Every count, empty state and status line says exactly
   what is true: open, with the agent, replied, resolved. No red warnings for normal things.
3. **Conversation first.** Opening an artifact shows the comments. Threads read like a
   conversation between named people and an agent, anchored to a quoted passage.
4. **Plain words and one voice.** Sans-serif sentence case for the interface; monospace
   only for code, paths and IDs; technical fields behind disclosure.
5. **Light by default, both themes equal.** Follow the OS; dawn when unknown. Every
   colour pair is chosen and tested in both themes.
6. **Change the skin, not the contract.** Tokens, an override layer and new files over
   rewrites of upstream-owned files; every conformance requirement keeps its meaning.

## Decision: the default theme becomes light

**First visit follows `prefers-color-scheme`, falling back to dawn.** A saved choice still
wins. Rationale: most authored HTML is a white page; non-technical readers expect a light
document; four of six reviewers recommended it and none argued for dark. Dawn's two
blocking bugs (B01, B07) are fixed first. This changes `main.tsx` theme initialisation only.

## Decision: fonts

**No new font.** Atkinson Hyperlegible Next (already bundled locally) becomes the only UI
face; Atkinson Hyperlegible Mono is kept for code, paths, IDs and URLs only. Noto Sans
(`--font-heading` in `index.css`) is replaced by Atkinson for headings. The renderer keeps
its system sans stack. This is a style choice, not a security constraint: the content
frame's CSP already allows fonts (`font-src * data:`), so documents could use Atkinson
with an `@font-face` and a reachable font URL. The reader is already the strongest surface,
and a native document face keeps documents looking like documents rather than like the app.

## Token plan

Implemented as a new override file, `apps/web/src/review/review-calm.css`, imported last,
plus edits to `theme-tokens.css`. Values below were rendered in the mockups.

| Token | Role | Before (dawn / moon) | After (dawn / moon) |
| --- | --- | --- | --- |
| `--as-canvas` | app background | `#ffffff`-ish oklch(1 0 0) / oklch(0.145 0.008 326) | `#f7f6f3` / `#191919` |
| `--as-surface` | panels, cards | same as canvas | `#ffffff` / `#1f1f1f` |
| `--as-surface-raised`, `--as-hover` | wells, hover | oklch(0.967 …) / oklch(0.274 …) | `#f1f0ec` / `#262626` |
| `--as-selected` | selected row | (undefined) | `#ecebe7` / `#2c2c2c` + 2px accent bar |
| `--as-text` | ink | oklch(0.145 0.008 326) / oklch(0.985 0 0) | `#37352f` (12.3:1) / `#e6e4df` (13.8:1) |
| `--as-muted` | secondary text | oklch(0.542 0.034 322) / oklch(0.711 …) | `#6b6963` (5.5:1) / `#a3a19b` (6.8:1) |
| `--as-border` | pane dividers | oklch(0.922 …) / white 10% | `#e7e5df` / `#303030` |
| `--as-border-strong` | inputs | (undefined) | `#c9c6be` / `#55534e` |
| `--as-action` | primary fill | oklch(0.457 0.24 277) ≈ `#432dd7` | `#4338ca` (white 7.9:1) / `#5b5bd6` (white 5.4:1) |
| `--as-iris` | accent text, focus, selection | sidebar-primary | `#4338ca` / `#a5b4fc` (8.8:1) |
| `--as-iris-soft` | accent wash | 12–14% mix | `#eef0ff` / `#2a2b45` |
| `--as-annotation` | comment markers, highlights, quotes | surface colour (bug B07) | `#b45309` (white numeral 5.0:1) / `#f59e0b` |
| `--as-love` | danger | destructive | `#b42318` (6.6:1) / `#f97066` (6.3:1) |
| `--as-radius` | controls | `0` | `6px`; cards/popovers/dialogs `10px`; pills full |
| Shadows | elevation | none / blur scrims | three levels; scrim 28% black dawn, 50% moon, no blur |
| Focus | ring | 1px outline | 2px ring, 2px offset, accent |

**Type scale** (Atkinson Hyperlegible Next): 12 meta · 13 controls and labels · 14 comment
and panel body · 16 panel titles · 20 dialog/section titles · 28 page titles. Weights 400,
500, 600. Sentence case everywhere; no letter-spacing on UI text. Comment bodies go from
12.8px to 14px; actions from 10.6px to 13px.

**Two accents, two meanings:** indigo means *act* (buttons, links, focus, selection);
amber means *comment* (markers, highlights, the quote bar on a thread, the selected
thread's outline). This resolves the ui-a/ui-b disagreement in ui-b's favour: the brand
indigo stays, and comments get the warm highlight people know from Google Docs.

## Primitive consolidation

| Primitive | Rule |
| --- | --- |
| Buttons | Primary (accent fill, white, 600), secondary (surface + strong border), ghost (muted text, hover fill), danger (outline). Heights 28 / 32 / 40. 13px sentence case. One primary per region: Send all in comments, the page action in settings. Full screen becomes ghost. |
| Inputs | Boxed, 6px radius, strong border, 2px focus ring. No underline-only fields. |
| Tabs | Text tabs with a 2px underline; counts as small neutral pills, hidden at zero. |
| Badges | Pills: neutral, accent, status (success/warning/danger). 11–12px, sentence case. "Open" is implied and not shown. |
| Rows and cards | Catalog rows are rounded hover rows; selected = fill + 2px accent bar; titles may wrap to two lines. Cards: 10px radius, hairline + soft shadow. |
| Dialogs and popovers | 10px radius, one shadow, sentence-case 18–20px title, unblurred scrim. |
| Notices | One inline notice: icon + 13px text, neutral / warning / danger wash. Errors once per surface. |

## The comments experience (Google Docs as the reference)

- **Comments first in the workspace.** The workspace inspector opens on Comments (T08).
  Review routes (focus view) keep comments closed until requested, as CMT-015 requires.
  Details keeps human fields first (name, access, version, published, tags) and technical
  IDs behind a disclosure.
- **Thread card:** avatar (initials, stable colour) + name; the agent gets an "Agent" tag;
  a quoted passage with an amber bar for anchored comments; "General comment" in neutral
  text for whole-version ones (fixes B03); 14px body; replies under a hairline, same author
  treatment; quiet text actions (Show, Resolve, Reply, "Send to Pi"). Per-card send stays
  visible with its caret for choosing an agent or adding a note, and keeps its accessible
  name ("Send to Pi", or "Send…" with several agents); it loses only the filled styling and
  the repeated agent avatar, so Send all stays the one primary (PRS-004, SND-001).
- **Selection:** the selected card gets an amber outline matching its highlight in the
  document; the document highlight is amber in both themes.
- **Composer:** the sidebar composer collapses to a one-line "Comment on the whole
  document…" field and expands on focus. Both composers use the same words: placeholder
  "Add a comment…", button "Comment", Cmd/Ctrl+Enter. The in-document popover is themed
  through the tokens already sent to the frame (radius, font, colours); its placement stays
  upstream's (`@plannotator/ui` is not patched).
- **Agent as collaborator:** a state line on the thread — "With Pi", "Pi replied — check it
  and resolve" — derived from data the client already has (dispatch state and last reply
  author). The agents block becomes one line ("Pi is connected") above Send all.
- **Honest filters:** Open · All · Resolved · Sent keep their data semantics (DSP-004 keeps
  dispatched threads out of default listings). When threads are with an agent, Open and All
  say so ("3 comments are with Pi") with a link to Sent, instead of "all resolved" (B02, B05).
- **Resolve** shows a short inline "Resolved · Undo" acknowledgement in the card's place.

## Document identity (T10)

- Header: full title (wraps to two lines, tooltip when truncated), a version chip
  ("Version 3"), and "Published by Pi · today". Open raw and Download move into an
  overflow menu; Share stays visible; Full screen becomes a ghost icon; the annotate toggle
  gets a visible label ("Commenting" on, "Reading" off).
- Focus mode keeps a slim bar with title and version, as CMT-015 already requires ("the
  exact artifact and version in one compact bar"). Reviewers report the bar does not show
  them today; this pass restores it.
- Footer: "Version 3 of 3 · 1 file" instead of "10 / 11" and "1 file · STATIC"; catalog
  position stays in the arrow buttons' labels.

## Theme verdicts

| Id | Theme | Verdict | Reason |
| --- | --- | --- | --- |
| T01 | Typography reads as a terminal | **Adopt** | Core of the direction; token and selector work. |
| T02 | Hard square chrome, cool palette | **Adopt** | Warm neutral ramp shared with the renderer; soft radii; fewer borders. |
| T03 | Many component variants | **Adopt** | Primitive rules above; shadcn component class strings updated. |
| T04 | Dark default ignores the OS | **Adopt** | Decision above. |
| T05 | Dense, button-heavy threads | **Adopt** | Thread card above. |
| T06 | Two composer languages | **Adapt** | Same words, keys and tokens; popover placement stays upstream's. |
| T07 | Agent loop has no progress or finish | **Adapt** | State line, honest empty states, resolve acknowledgement. Keeping sent pins in the document is **rejected**: SND-001 requires pin removal. Notifications, version links in replies and a review-level outcome need backend work and are deferred. |
| T08 | Opens on metadata | **Adapt** | Comments default in the workspace only (CMT-015 keeps focus view closed); Details reordered with disclosure. Tab consolidation (History / Info) is deferred: it moves tests and accessible names for little visual gain. |
| T09 | Engineering vocabulary | **Adopt** | Copy changes on reviewer surfaces; one word, "comment", in the UI. |
| T10 | Lost document identity | **Adopt** | Above. |
| T11 | No reviewer context | **Adapt** | Publisher and time in the header now; a publish-time "review request" field needs API work and is deferred. |
| T12 | Contradictory empty and error states | **Adopt** | One state per screen with a next step; error shown once. |
| T13 | Compare shows no change | **Adapt** | Render the line-change regions the client already receives (`client.ts:420-432`) as a simple before/after list. A visual side-by-side diff is deferred. |
| T14 | Activity as audit log | **Adapt** | Plain verbs and readable layout now; resolving principal IDs to names needs a lookup the client lacks — deferred. |
| T15 | Cramped sharing | **Adapt** | Lead with Copy link and who can open it; secondary links and agent setup in disclosures. Inviting reviewers is deferred (needs membership work). |
| T16 | Settings cannot confirm success | **Adapt** | Visual consolidation, phone layout and a connected-agents list (the `/api/v1/agents` endpoint already exists) now; capability presets deferred. |
| T17 | Busy reviews | **Adapt** | Order threads by document position now; search and grouping deferred. |
| T18 | Catalog lacks attention signals | **Adapt** | Hide zero counts and calm the metadata; review-state chips deferred (need per-viewer state). |
| T19 | Mouse-only commenting | **Defer** | Lives in `@plannotator/ui`; record upstream. |
| T20 | Panels overlay the document | **Adapt** | Narrow panels keep overlaying the artifact (CMT-015) but gain a scrim and outside-click close; narrow header overflow menu. |

## Disagreement resolutions

- **Accent:** keep brand indigo for actions; add amber for comments (ui-b over ui-a).
- **Document font:** keep the renderer's system sans as a style choice (ui-a over ui-b); no CSP change is needed either way.
- **Reviewer entry:** keep the workspace and the existing focus links; restore the focus bar
  (pm-b and CMT-015 over pm-a's "focus by default").
- **All filter:** keep data semantics and add honest copy (pm-b over ux-a and pm-a), because
  DSP-004 forbids dispatched threads in default listings.
- **Inspector structure:** reorder now, consolidate later (deferred).
- **Density:** one comfortable density now; a compact preference only if operators ask.

## Bugs in this pass

All 25 bug clusters are in scope. B12 (a retried post reuses no idempotency key) is a
data-correctness fix rather than design; it gets its own commit with a test, or a deferral
note if it widens. Each bug lands in its own commit. (A reported B20, unnamed composer
buttons, was disproved by the fact-check: the buttons are named by `title`.)

## Out of scope

Marketing site; patching `@plannotator/ui`; sandbox, CSP and content-origin changes;
backend features (notifications, review requests, reviewer invitations,
principal-name lookup, per-viewer state); keyboard anchoring in documents (T19).

## Conformance tensions

- **SND-001** (sent threads lose their pins): kept; T07's "keep sent markers" rejected.
- **DSP-004** (no dispatched thread in a default listing): kept; All is not widened.
- **PRS-004 / SND send-all primary:** kept; per-card send stays visible as a quiet action with
  the same accessible name, and Send all remains the only filled button in the panel.
- **PRS-006** (branded ring, worded popover, motion only on live states): kept unchanged.
- **CMT-015** (review routes: comments closed by default, compact identity bar, narrow
  surfaces overlay): Comments-first applies to the workspace only; the focus bar's identity is
  restored; narrow panels keep overlaying.

## Expected upstream conflict areas

`review.css` (small: the B01 layer fix, the B11 wrap rule, the tab-strip rule), `main.tsx`
(theme default), `review-app.tsx` (inspector default tab, header markup, catalog initial
state), `review-comments.tsx` (thread card markup, empty states), `review-preview.tsx`
(annotation token mapping), `components/ui/*.tsx` (uppercase and radius classes),
`index.css` (`--font-heading`). New files: `review-calm.css` and the capture/seed scripts.
