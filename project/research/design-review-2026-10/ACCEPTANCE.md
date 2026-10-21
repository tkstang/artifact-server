# Acceptance (October 2026 design pass)

Two acceptance reviewers, one per model family, compared the 268-cell before matrix
with the after matrix against [`DIRECTION.md`](./DIRECTION.md) and the original
findings, and walked the journeys on their own synthetic backends. An independent code
reviewer on the other model family from the implementers reviewed the full diff.

| Review | Model | Result |
| --- | --- | --- |
| UI acceptance (`acc-ui`) | GPT-6.1-Sol, high | 44 targeted clusters: 36 resolved, 8 partly, 0 not; 1 low regression; 4 inconsistencies |
| UX acceptance (`acc-ux`) | Claude Opus 5.5, high | 44 targeted clusters: 35 resolved, 9 partly, 0 not; 5 regressions (1 medium, 4 low); 6 inconsistencies |
| Code review | GPT-6.1-Sol, high | 7 findings (2 high, 5 medium), all reproduced in a browser |

Deferred and rejected items (T19, keeping sent markers, inspector tab consolidation) were
confirmed not built, with no regression from leaving them.

## Code review: all fixed

| Id | Finding | Fix |
| --- | --- | --- |
| cr-01 (high) | A retried in-document comment with surrounding whitespace was stored twice | One canonical (trimmed) body and key per attempt |
| cr-02 (high) | A sidebar comment's retry key was lost when the composer remounted | The attempt's key is kept with the draft, for new comments and replies, across remounts and reloads |
| cr-03 (medium) | The lost-response test never committed its first save (origin check) | The test forwards browser mutation headers and asserts the first save is stored |
| cr-04 (medium) | Clearing Compare left no tab in the keyboard order | The inspector returns to Comments when its tab disappears |
| cr-05 (medium) | Agent tags matched display names, not identity | Matched by principal id |
| cr-06 (medium) | "Commenting"/"Reading" were not in the toggle's accessible name (WCAG 2.5.3) | The visible label names the button; instructions are its description |
| cr-07 (medium) | On phones the focus bar's identity rendered off-screen for HTML | The bar wraps for every preview kind |

## Acceptance: fixed after review

| Source | Item | Fix |
| --- | --- | --- |
| acc-ux reg-01 (medium) | The new scrim dimmed the document at laptop widths | Dimming only at ≤720px; above that a transparent catcher still closes the panel |
| acc-ui reg-01 | Send all and its caret differed in height | Both 32px |
| acc-ux reg-02 | The phone focus bar took three rows | Two rows: identity, then icon buttons with names and tooltips |
| acc-ux reg-05 | Escape closing a panel dropped focus to the page | Focus returns to the control that reopens the panel |
| T02 (both) | Indigo outline around the document in commenting mode | A hairline in the border colour |
| T03 (both) | Focus bar and header used different button styles; three error styles | One ghost-button treatment; one notice style |
| T09 (acc-ux) | "annotations" in the presence popover and an API-key capability; raw "Failed to fetch" | "comments"; network failures read as a plain sentence |
| Inconsistency (acc-ux) | Sent cards showed "Queued" and "With Pi" | The chip only |
| Inconsistency (acc-ux) | Unknown agent status kept a spinning "replying" ring | Static disconnected ring (PRS-006: motion only on live states) |
| B15 (acc-ux) | A restored anchored draft didn't show what it was anchored to | The quote is shown with the draft, and the failure notice beside it |
| T12 (both) | Empty project left a blank pane and an empty inspector | One quiet line pointing to the catalog; the inspector closes |
| Found during review | Background-less HTML showed the dark app theme through it in moon (pre-existing) | The document gets a white canvas, as in a browser tab |

## Acceptance: answered, not changed

| Item | Why |
| --- | --- |
| T10 / T11 publisher | The client has no publisher name, only a principal id. The header shows the version and when it was saved. Needs a server-side name lookup (deferred in DIRECTION.md). |
| T06 "Save" vs "Post comment" | "Save" is the `@plannotator/ui` composer's label; patching the package is out of scope. Placeholders and keys are aligned. |
| T17 HTML comment order | HTML anchors carry no document position the client can read; Markdown comments sort by source line. HTML stays in creation order. |
| B06 tabs with Compare open | Compare adds a sixth tab; the strip fades at its edge and scrolls the selected tab into view. Folding Compare into Versions is the deferred tab consolidation. |
| T12 Home overlay | Still the brand splash; a real home (needs attention, recent) is a product change outside this pass. |
| T20 focus comments drawer | The drawer sits beside the document on desktop; on phones it covers the document and closes with its button or Escape. No scrim added. |
| T03 filled reply/comment buttons (acc-ui) | The composer's submit stays the one primary inside that composer; Send all remains the panel's primary. |
| acc-ux reg-03 / reg-04 | Comment markers overlapping words on phones and a stale marker label after a send come from `@plannotator/ui`'s overlay; they are newly visible because markers are no longer invisible in dawn. Record upstream. |
| Fixture gaps F01, F02, F04 | The seeded agent never completes a live loop and comment timestamps tie, which limited some judgements. Listed as follow-ups. |

Raw reports stay local: `test-results/design-review/acceptance/` and
`test-results/design-review/code-review/`.
