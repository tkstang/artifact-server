import {expect, test} from "@playwright/test";
import {z} from "zod";

import {publishNew, publishVersion, createStagedUpload, uploadEveryStagedFile, commitStagedUpload} from "../support/publishing.js";
import {localLogin, startBrowserFixture, stopBrowserFixture} from "./browser-fixture.js";
import {listThreadsOverApi} from "./comment-api.js";

const markdown = [
  "# Release plan",
  "",
  "A **reviewable** proposal with exact source provenance.",
  "",
  "## Delivery",
  "",
  "Keep the original version available for reviewers.",
  "",
  "- [x] Source preserved",
  "- [ ] Feedback addressed",
  "",
  "| Stage | Owner |",
  "| --- | --- |",
  "| Review | Human |",
  "| Revision | Agent |",
  "",
  "```typescript",
  "const version = 1;",
  "```",
  "",
  "> Saved feedback belongs to its revision.",
  "",
  "[Delivery section](#delivery)",
  "",
  '![Local diagram](diagram.png "Published together with the saved source.")',
  "",
  "## Safety",
  "",
  '<script>window.parent.document.title = "COMPROMISED"</script>',
  "",
  '<img src="/api/v1/session" onerror="alert(1)">',
  "",
  "![Remote tracking](https://tracking.invalid/pixel.png)",
  "![App credentials](http://localhost/api/v1/session)",
  "[Unsafe](javascript:alert(1))",
  "",
].join("\r\n");

test.describe("Markdown review", () => {
  test("MDN-001-B MDN-001-F MDN-002-B MDN-002-F: Markdown renders safely and preserves source and anchored feedback after revision", async ({browser}, testInfo) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const files = [
        {path: "plan.md", mediaType: "text/markdown; charset=utf-8", bytes: Buffer.from(markdown)},
        {path: "diagram.png", mediaType: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII=", "base64")},
      ];
      const upload = await createStagedUpload(fixture.server, fixture.installation, "plan.md", files);
      const deliveries = await uploadEveryStagedFile(fixture.installation, upload.body, files);
      expect(deliveries.every((response) => response.ok)).toBe(true);
      const first = await commitStagedUpload(fixture.installation, upload.body, "markdown-review-version-one", {
        accessSetting: "account_required", kind: "new_artifact", name: "Markdown release plan", tags: [],
      });
      await localLogin(fixture);
      const url = `${fixture.server.baseUrl}/review?project=prj_default&artifact=${first.body.artifact.id}&version=${first.body.version.id}`;
      await fixture.page.goto(url);
      const review = fixture.page.frameLocator(".as-artifact-frame");
      const preview = review.frameLocator("iframe");
      await expect(preview.getByRole("heading", {name: "Release plan"})).toBeVisible();
      await expect(preview.locator("strong")).toHaveText("reviewable");
      await expect(preview.getByRole("columnheader", {name: "Stage"})).toBeVisible();
      await expect(preview.getByRole("checkbox").first()).toBeChecked();
      await expect(preview.getByRole("checkbox").last()).not.toBeChecked();
      await expect(preview.getByRole("checkbox").first()).toBeDisabled();
      await expect(preview.locator("pre code .hljs-keyword")).toHaveText("const");
      await expect(preview.getByRole("navigation", {name: "Document sections"})).toBeVisible();
      await expect(preview.getByRole("link", {name: "Delivery section"})).toHaveAttribute("href", "#md-4-delivery");
      await fixture.page.getByRole("button", {name: "Commenting", exact: true}).click();
      await preview.getByRole("link", {name: "Delivery section"}).click();
      await expect(preview.getByRole("heading", {name: "Delivery", exact: true})).toBeVisible();
      await expect(preview.getByRole("heading", {name: "Release plan"})).toHaveCount(1);
      expect(await preview.getByRole("heading", {name: "Delivery", exact: true}).evaluate((element) => element.getBoundingClientRect().top)).toBeLessThan(100);
      await fixture.page.getByRole("button", {name: "Reading", exact: true}).click();
      await expect(review.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
      await expect(preview.locator("img")).toHaveCount(1);
      await preview.getByRole("img", {name: "Local diagram"}).scrollIntoViewIfNeeded();
      await expect(preview.getByRole("img", {name: "Local diagram"})).toHaveJSProperty("naturalWidth", 1);
      await expect(preview.getByText("Published together with the saved source.", {exact: true})).toBeVisible();
      await expect(preview.locator("body")).toContainText('<script>window.parent.document.title = "COMPROMISED"</script>');
      // Only trusted scripts run: the annotation bridge and the outline's
      // pointer isolation. Author-supplied script stays inert text.
      await expect(preview.locator("script")).toHaveCount(2);
      await expect(preview.locator("script", {hasText: "COMPROMISED"})).toHaveCount(0);
      await expect(preview.locator('a[href^="javascript:"]')).toHaveCount(0);
      await expect(preview.locator(".md-image-unavailable")).toHaveCount(2);

      await preview.getByRole("heading", {name: "Release plan"}).scrollIntoViewIfNeeded();
      await fixture.page.screenshot({path: testInfo.outputPath("markdown-desktop.png"), fullPage: true});
      await preview.getByText("Keep the original version available for reviewers.", {exact: true}).click();
      await review.getByPlaceholder("Add a comment...").fill("Please retain historical feedback during revision.");
      await review.getByRole("button", {name: "Save", exact: true}).click();
      await expect(fixture.page.getByText("Please retain historical feedback during revision.", {exact: true})).toBeVisible();
      const threads = await listThreadsOverApi(fixture, first.body.artifact.id);
      expect(threads).toHaveLength(1);
      expect(threads[0]?.versionId).toBe(first.body.version.id);
      expect(threads[0]?.path).toBe("plan.md");
      const anchor = z.object({
        originalText: z.string(),
        markdownSource: z.object({startLine: z.number(), endLine: z.number(), section: z.string(), sourceText: z.string(), truncated: z.boolean()}),
      }).parse(threads[0]?.anchor);
      expect(anchor.originalText).toBe("Keep the original version available for reviewers.");
      expect(anchor.markdownSource).toEqual({
        startLine: 7, endLine: 7, section: "Delivery", sourceText: "Keep the original version available for reviewers.", truncated: false,
      });

      const second = await publishVersion(fixture.server, fixture.installation, {
        artifactId: first.body.artifact.id, expectedCurrentVersionId: first.body.version.id,
        content: "# Release plan revised\n\nHistorical feedback is retained.\n", path: "plan.md", mediaType: "text/markdown", idempotencyKey: "markdown-review-version-two",
      });
      const sourceUrl = `${fixture.server.baseUrl}/api/v1/artifacts/${first.body.artifact.id}/versions/${first.body.version.id}/file?projectId=prj_default&path=plan.md`;
      const source = await fixture.context.request.get(sourceUrl);
      expect(Buffer.compare(await source.body(), Buffer.from(markdown))).toBe(0);
      await fixture.page.goto(`${fixture.server.baseUrl}/review?project=prj_default&artifact=${first.body.artifact.id}&version=${second.body.version.id}`);
      await expect(preview.getByRole("heading", {name: "Release plan revised"})).toBeVisible();
      await expect(fixture.page.getByText("Please retain historical feedback during revision.", {exact: true})).toHaveCount(0);
      await fixture.page.goto(url);
      await expect(preview.getByRole("heading", {name: "Release plan"})).toBeVisible();
      await fixture.page.getByRole("tab", {name: /Comments/u}).click();
      await expect(fixture.page.getByText("Please retain historical feedback during revision.", {exact: true})).toBeVisible();
      expect((await listThreadsOverApi(fixture, first.body.artifact.id))[0]?.versionId).toBe(first.body.version.id);
      await fixture.page.setViewportSize({width: 390, height: 844});
      await fixture.page.goto(`${url}&view=focus`);
      await expect(preview.getByRole("heading", {name: "Release plan"})).toBeVisible();
      // The generated outline is navigation even in annotate mode (the default).
      await preview.getByText("Contents", {exact: true}).click();
      await expect(review.locator('[data-comment-popover="true"]')).toHaveCount(0);
      await preview.getByRole("navigation", {name: "Document sections"}).getByRole("link", {name: "Delivery", exact: true}).click();
      await expect(preview.getByRole("heading", {name: "Delivery", exact: true})).toBeVisible();
      await preview.getByRole("heading", {name: "Release plan"}).scrollIntoViewIfNeeded();
      await fixture.page.screenshot({path: testInfo.outputPath("markdown-narrow.png"), fullPage: true});
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("MDN-003-B MDN-003-F: static Mermaid diagrams render with source-aware comments while invalid or active content remains readable and inert", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    const diagramSource = "flowchart TD\n  Draft[Publish draft] --> Feedback[Read feedback]\n  Feedback --> Revision[Revise source]";
    const source = `# Diagram review\n\n## Workflow\n\n\`\`\`mermaid\n${diagramSource}\n\`\`\`\n\n\`\`\`mermaid\nthis is not a valid diagram\n\`\`\`\n\n\`\`\`mermaid\nflowchart TD\n A[Hostile] --> B[Link]\n click A "javascript:alert(1)"\n\`\`\`\n\n\`\`\`mermaid\nflowchart TD\n A["<img src='https://tracking.invalid/pixel' onerror='alert(1)'>"]\n\`\`\`\n\n\`\`\`mermaid\n---\nconfig:\n  theme: dark\n---\nflowchart TD\n A --> B\n\`\`\`\n\n\`\`\`mermaid\nflowchart TD\n A@{ img: "https://tracking.invalid/pixel.png", label: "Pixel" }\n\`\`\`\n`;
    const requested: string[] = [];
    fixture.page.on("request", (request) => { if (request.url().includes("tracking.invalid")) requested.push(request.url()); });
    try {
      const first = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required", content: source, path: "workflow.md", mediaType: "text/markdown", idempotencyKey: "markdown-mermaid-one",
      });
      // Start dark so the theme switch below is observable; a first visit
      // otherwise follows the OS colour scheme.
      await fixture.page.emulateMedia({colorScheme: "dark"});
      await localLogin(fixture);
      const url = `${fixture.server.baseUrl}/review?project=prj_default&artifact=${first.body.artifact.id}&version=${first.body.version.id}`;
      await fixture.page.goto(url);
      const review = fixture.page.frameLocator(".as-artifact-frame");
      const preview = review.frameLocator("iframe");
      // Pele drops the scripted click and strips the HTML label, so both draw
      // inertly; invalid syntax, author settings and image loads keep their source.
      await expect(preview.locator('.md-mermaid[data-diagram-state="rendered"]')).toHaveCount(3);
      await expect(preview.locator('.md-mermaid svg[aria-label="Mermaid diagram"]').first()).toBeVisible();
      await expect(preview.locator('.md-mermaid[data-diagram-state="unavailable"]')).toHaveCount(3);
      await expect(preview.locator("svg a, svg foreignObject, svg image, svg script, .md-mermaid img")).toHaveCount(0);
      await expect(preview.locator(".md-mermaid").nth(1)).toContainText("Diagram unavailable: this diagram type isn't supported.");
      await expect(preview.locator(".md-mermaid").nth(1).locator(".md-diagram-source")).toHaveText("this is not a valid diagram");
      await expect(preview.locator(".md-mermaid").nth(4)).toContainText("Diagram unavailable: diagram settings");
      await expect(preview.locator(".md-mermaid").nth(5)).toContainText("Diagram unavailable: diagrams that load images aren't drawn in review.");
      expect(requested).toEqual([]);
      await expect(review.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
      // Colours come from CSS variables, so the theme switch restyles the same SVG.
      const node = preview.locator(".md-mermaid svg .pele-node rect").first();
      const darkFill = await node.evaluate((element) => getComputedStyle(element).fill);
      await fixture.page.getByRole("button", {name: "Use light theme", exact: true}).click();
      await expect.poll(() => node.evaluate((element) => getComputedStyle(element).fill)).not.toBe(darkFill);
      await expect(preview.locator('.md-mermaid svg[aria-label="Mermaid diagram"]').first()).toBeVisible();
      await preview.locator('.md-mermaid').first().click({position: {x: 30, y: 30}});
      await review.getByPlaceholder("Add a comment...").fill("Keep this diagram with its source revision.");
      await review.getByRole("button", {name: "Save", exact: true}).click();
      await expect(fixture.page.getByText("Keep this diagram with its source revision.", {exact: true})).toBeVisible();
      const threads = await listThreadsOverApi(fixture, first.body.artifact.id);
      expect(threads).toHaveLength(1);
      expect(threads[0]?.versionId).toBe(first.body.version.id);
      expect(threads[0]?.path).toBe("workflow.md");
      const anchor = z.object({originalText: z.string(), markdownSource: z.object({startLine: z.number(), endLine: z.number(), section: z.string(), sourceText: z.string()})}).parse(threads[0]?.anchor);
      expect(anchor.originalText).toContain("Publish draft");
      expect(anchor.originalText).not.toContain(".node");
      expect(anchor.markdownSource).toMatchObject({startLine: 5, endLine: 9, section: "Workflow", sourceText: `\`\`\`mermaid\n${diagramSource}\n\`\`\``});
      const second = await publishVersion(fixture.server, fixture.installation, {
        artifactId: first.body.artifact.id, expectedCurrentVersionId: first.body.version.id,
        content: "# New workflow\n", path: "workflow.md", mediaType: "text/markdown", idempotencyKey: "markdown-mermaid-two",
      });
      const original = await fixture.context.request.get(`${fixture.server.baseUrl}/api/v1/artifacts/${first.body.artifact.id}/versions/${first.body.version.id}/file?projectId=prj_default&path=workflow.md`);
      expect(await original.text()).toBe(source);
      await fixture.page.goto(url.replace(first.body.version.id, second.body.version.id));
      await expect(preview.getByRole("heading", {name: "New workflow"})).toBeVisible();
      expect((await listThreadsOverApi(fixture, first.body.artifact.id))[0]?.versionId).toBe(first.body.version.id);
      await fixture.page.goto(url);
      await expect(preview.locator('.md-mermaid[data-diagram-state="rendered"]')).toHaveCount(3);
      await fixture.page.getByRole("tab", {name: /Comments/u}).click();
      await expect(fixture.page.getByText("Keep this diagram with its source revision.", {exact: true})).toBeVisible();
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("Mermaid static contract: author styling and safe links draw, unsafe links are dropped, and settings or image loads keep their source", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    const drawn = [
      "flowchart TD",
      "  A[Styled]:::warm --> B[Linked] --> C[Script] --> D[Network]",
      "  classDef warm fill:#fde68a",
      "  style B stroke:#b45309",
      "  linkStyle 0 stroke:#b45309",
      '  click B "https://example.invalid/docs"',
      '  click C "javascript:alert(1)"',
      '  click D "//tracking.invalid/pixel"',
    ].join("\n");
    const wide = "flowchart LR\n  Draft --> Review --> Publish";
    const kept = [
      "%%{init: {'theme': 'dark', 'themeCSS': '.node rect { fill: url(https://tracking.invalid/pixel) }'}}%%\nflowchart TD\n  A --> B",
      "flowchart TD\n  A[Styled]\n  style A fill:url(https://tracking.invalid/pixel)",
      'flowchart TD\n  A@{ img: "https://tracking.invalid/pixel.png", label: "Pixel" }',
      'flowchart TD\n  A[<img src="https://tracking.invalid/error.png" onerror="alert(1)">] --> B[[[',
    ];
    const source = ["# Static diagrams", drawn, wide, ...kept].map((value, index) => index === 0 ? value : `\`\`\`mermaid\n${value}\n\`\`\``).join("\n\n");
    const requested: string[] = [];
    fixture.page.on("request", (request) => { if (request.url().includes("tracking.invalid")) requested.push(request.url()); });
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required", content: source, path: "static.md", mediaType: "text/markdown", idempotencyKey: "mermaid-static-policy",
      });
      await localLogin(fixture);
      await fixture.page.goto(`${fixture.server.baseUrl}/review?project=prj_default&artifact=${published.body.artifact.id}&version=${published.body.version.id}`);
      const review = fixture.page.frameLocator(".as-artifact-frame");
      const preview = review.frameLocator("iframe");
      await expect(preview.locator('.md-mermaid[data-diagram-state="rendered"]')).toHaveCount(2);
      await expect(preview.locator('.md-mermaid[data-diagram-state="unavailable"] .md-diagram-source code')).toHaveText(kept);
      const statuses = preview.locator('.md-mermaid[data-diagram-state="unavailable"] .md-diagram-status');
      await expect(statuses.nth(0)).toContainText("diagram settings");
      await expect(statuses.nth(1)).toContainText("syntax error on line 3");
      await expect(statuses.nth(2)).toContainText("diagrams that load images");
      // Pele's error snippet quotes the author's markup; it must stay text.
      await expect(statuses.nth(3)).toContainText("syntax error on line 2");
      // (Pele's preprocessing quotes the attributes with ' in its snippet.)
      await expect(preview.locator(".md-diagram-error").last()).toContainText(/A\[<img src=["']https:\/\/tracking\.invalid\/error\.png["'] onerror=/u);
      await expect(preview.locator(".md-mermaid img")).toHaveCount(0);
      const diagram = preview.locator('.md-mermaid[data-diagram-state="rendered"] svg').first();
      // Only the https link survives, and it opens like a Markdown link.
      await expect(diagram.locator("a")).toHaveCount(1);
      await expect(diagram.locator("a")).toHaveAttribute("href", "https://example.invalid/docs");
      await expect(diagram.locator("a")).toHaveAttribute("target", "_blank");
      await expect(diagram.locator("a")).toHaveAttribute("rel", "noopener noreferrer");
      await expect(diagram.locator("a")).toHaveAttribute("referrerpolicy", "no-referrer");
      await expect(diagram.locator('.pele-node[data-id="A"] rect')).toHaveCSS("fill", "rgb(253, 230, 138)");
      await expect(diagram).toContainText("Network");
      await expect(preview.locator("svg image, svg foreignObject, svg script")).toHaveCount(0);
      // A narrower figure redraws the layout: the wide flowchart turns vertical.
      const flow = preview.locator('.md-mermaid[data-diagram-state="rendered"] svg').nth(1);
      const aspect = async (): Promise<number> => Number(await flow.getAttribute("height")) / Number(await flow.getAttribute("width"));
      await expect.poll(aspect).toBeLessThan(1);
      await fixture.page.setViewportSize({width: 390, height: 844});
      await expect.poll(aspect).toBeGreaterThan(1);
      await expect(preview.locator(".md-mermaid").nth(1).locator("details")).toContainText("Diagram source");
      expect(requested).toEqual([]);
      await expect(review.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("Markdown compatibility: a plain-text .md publication renders as Markdown without modifying source", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required", content: "# Plain text Markdown\n", path: "note.md", mediaType: "text/plain", idempotencyKey: "markdown-plain-text",
      });
      await localLogin(fixture);
      await fixture.page.goto(`${fixture.server.baseUrl}/review?project=prj_default&artifact=${published.body.artifact.id}&version=${published.body.version.id}`);
      await expect(fixture.page.frameLocator(".as-artifact-frame").frameLocator("iframe").getByRole("heading", {name: "Plain text Markdown"})).toBeVisible();
    } finally {
      await stopBrowserFixture(fixture);
    }
  });
});
