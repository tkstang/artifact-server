# Mermaid through Pele

The same synthetic diagram document (`renderer-markdown--mermaid`), captured by
`tests/browser/capture-design-review.ts` with `@mermaid-js/tiny` 12.1.0 (the design
pass's after state) and with Pele 1.8.0. Axe (WCAG 2 A/AA) reports no violations in
the application around the diagram in any of the six Pele cells (1440, 1024 and
390 px; dawn and moon). The capture excludes the content frame
(`.as-artifact-frame`) from axe, so this does not cover the diagram itself.

| Cell | Mermaid tiny | Pele |
| --- | --- | --- |
| 1440, dawn | [before](mermaid--1440--dawn-mermaid-tiny.png) | [after](mermaid--1440--dawn-pele.png) |
| 390, moon | [before](mermaid--390--moon-mermaid-tiny.png) | [after](mermaid--390--moon-pele.png) |
