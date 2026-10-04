# Markdown review

This local extension gives saved Markdown artifacts a derived, readable review
view using the existing publication, version, comment, and permission contracts.
See [design and limits](../../docs/markdown-review.md).

## Conformance requirements

- **MDN-001**: Review renders `text/markdown`, and `.md` declared as `text/plain`,
  with readable typography, headings/navigation, lists/tasks, tables, fenced code,
  links, and manifest-listed local images. It stores the original source bytes,
  creates feedback for the exact version/path, and exposes the rendered quote plus
  available block source-line/section context through the existing comment API.
  Publishing a new version does not change the historical source or its feedback.
- **MDN-002**: Authored Markdown HTML cannot become executable artifact content.
  Unsafe links and non-manifest/remote/app-origin image requests are rejected by
  rendering; local images use the selected version's existing content lease.
  The opaque-origin viewer sandbox and current authorization remain intact.

- **MDN-003**: Mermaid fences render static, theme-aware diagrams inside the same
  opaque viewer, with diagram block source/version/path available on comments.
  Invalid syntax, authored active content/configuration/resource requests produce
  readable source fallback without breaking the document. V1 source and diagram
  feedback remain available after v2 publication.

Source positions are block bounds, not exact character spans. Original quote and
HTML restoration metadata remain available. Cross-version comment mapping and per-node diagram anchors are outside this slice.
