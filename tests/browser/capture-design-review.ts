import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";
import {parseArgs} from "node:util";

import {AxeBuilder} from "@axe-core/playwright";
import {chromium, type Page} from "@playwright/test";

import {reviewUrl, startDesignReviewWorld, type DesignReviewWorld} from "./design-review-seed.js";
import {removeTestInstallation} from "../support/runtime-harness.js";

// The design review's capture matrix: every surface and state, at three widths,
// in both themes, on a fresh synthetic world per theme and width so states that
// write (sending, opening composers) cannot leak into other cells. The same
// script captures the before and the after state.
// Usage: pnpm build && tsx tests/browser/capture-design-review.ts --out <dir> [--only <regex>]

const {values} = parseArgs({options: {
  out: {type: "string", default: "test-results/design-review/matrix"},
  only: {type: "string"},
  themes: {type: "string", default: "dawn,moon"},
  widths: {type: "string", default: "1440,1024,390"},
}});
const outputDirectory = path.resolve(values.out);
const only = values.only === undefined ? null : new RegExp(values.only, "u");
const heightFor = (width: number): number => width <= 390 ? 844 : width <= 1024 ? 768 : 900;

interface Scenario {
  readonly surface: string;
  readonly state: string;
  readonly widths?: readonly number[];
  run(page: Page, world: DesignReviewWorld, width: number): Promise<void>;
}

interface Cell {
  readonly axeViolations: readonly {readonly id: string; readonly impact: string | null; readonly nodes: number}[];
  readonly error: string | null;
  readonly id: string;
  readonly path: string | null;
  readonly state: string;
  readonly surface: string;
  readonly theme: string;
  readonly width: number;
}

const frame = (page: Page) => page.frameLocator(".as-artifact-frame");
const preview = (page: Page) => frame(page).frameLocator("iframe");
const dashboard = (world: DesignReviewWorld) => world.dashboard[2] ?? world.proposal;

async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function openArtifact(page: Page, url: string, width: number, heading: string): Promise<void> {
  await open(page, url);
  await preview(page).getByRole("heading", {name: heading}).first().waitFor();
  if (width < 600) {
    const collapse = page.getByRole("button", {name: "Collapse artifact catalog", exact: true});
    if (await collapse.isVisible()) await collapse.click();
  }
}

async function inspectorTab(page: Page, name: string): Promise<void> {
  const tab = page.getByRole("tab", {name: new RegExp(`^${name}`, "u")});
  if (!await tab.isVisible()) {
    await page.getByRole("button", {name: "Open inspector", exact: true}).click();
  }
  await tab.click();
}

async function comments(page: Page, world: DesignReviewWorld, width: number, published = dashboard(world), heading = "Release readiness — version 3"): Promise<void> {
  await openArtifact(page, reviewUrl(world, published), width, heading);
  await inspectorTab(page, "Comments");
  await page.locator(".as-comment-card, .as-comment-list, [aria-label='Add a comment']").first().waitFor();
}

const scenarios: readonly Scenario[] = [
  {surface: "gate", state: "unavailable", async run(page, world) {
    await page.route("**/api/v1/projects", (route) => route.fulfill({
      body: JSON.stringify({error: {code: "INTERNAL_ERROR", message: "Project storage is temporarily unavailable."}}),
      contentType: "application/json", status: 500,
    }));
    await open(page, `${world.server.baseUrl}/review`);
    await page.getByRole("heading", {name: "Artifact Server unavailable"}).waitFor();
  }},
  {surface: "gate", state: "sign-in", async run(page, world) {
    await page.route("**/auth/context", (route) => route.fulfill({json: {accessMode: "private_team", login: {kind: "oidc"}}}));
    await page.route("**/api/v1/session", (route) => route.fulfill({json: {error: {code: "AUTHENTICATION_REQUIRED", message: "Sign in to continue."}}, status: 401}));
    await open(page, `${world.server.baseUrl}/review`);
    await page.getByRole("heading", {name: "Sign in required"}).waitFor();
  }},
  {surface: "catalog", state: "empty-project", async run(page, world) {
    await open(page, `${world.server.baseUrl}/review?project=${world.emptyProjectId}`);
    await page.getByText("No artifacts yet").waitFor();
  }},
  {surface: "catalog", state: "populated", async run(page, world) {
    await open(page, `${world.server.baseUrl}/review?project=prj_default`);
    await page.locator(".as-artifact-card").first().waitFor();
  }},
  {surface: "catalog", state: "filter-open", async run(page, world) {
    await open(page, `${world.server.baseUrl}/review?project=prj_default`);
    await page.getByRole("button", {name: /Filter artifacts/u}).click();
    await page.locator(".as-catalog-filter-popover[data-open]").waitFor();
  }},
  {surface: "catalog", state: "search-no-results", async run(page, world) {
    await open(page, `${world.server.baseUrl}/review?project=prj_default`);
    await page.getByRole("searchbox", {name: "Search artifacts"}).fill("zebra crossing");
    await page.getByText("No matching artifacts").waitFor();
  }},
  {surface: "catalog", state: "home-overlay", async run(page, world) {
    await open(page, `${world.server.baseUrl}/review?project=prj_default`);
    await page.getByRole("link", {name: "Artifact Server"}).click();
    await page.getByRole("dialog", {name: "Artifact Server home"}).waitFor();
  }},
  {surface: "renderer-html", state: "default", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, dashboard(world)), width, "Release readiness — version 3");
  }},
  {surface: "renderer-html", state: "long-title", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, world.longTitle), width, "Quarterly planning notes");
  }},
  {surface: "renderer-markdown", state: "top", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, world.proposal), width, "A calmer review workflow");
  }},
  {surface: "renderer-markdown", state: "table", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, world.proposal), width, "A calmer review workflow");
    await preview(page).getByRole("heading", {name: "A rhythm that respects attention"}).scrollIntoViewIfNeeded();
  }},
  {surface: "renderer-markdown", state: "code", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, world.proposal), width, "A calmer review workflow");
    await preview(page).getByRole("heading", {name: "A little structure, underneath"}).scrollIntoViewIfNeeded();
  }},
  {surface: "renderer-markdown", state: "mermaid", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, world.proposal), width, "A calmer review workflow");
    await preview(page).locator('.md-mermaid[data-diagram-state="rendered"]').waitFor();
    await preview(page).locator(".md-mermaid").scrollIntoViewIfNeeded();
  }},
  {surface: "focus", state: "markdown", async run(page, world) {
    await open(page, reviewUrl(world, world.proposal, "&view=focus"));
    await preview(page).getByRole("heading", {name: "A calmer review workflow"}).waitFor();
  }},
  {surface: "focus", state: "comments-drawer", async run(page, world) {
    await open(page, reviewUrl(world, dashboard(world), "&view=focus"));
    await preview(page).getByRole("heading", {name: "Release readiness — version 3"}).waitFor();
    await page.getByRole("button", {name: /Comments/u}).first().click();
    await page.getByRole("complementary", {name: "Comments"}).waitFor();
  }},
  {surface: "shell", state: "catalog-collapsed", widths: [1440, 1024], async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, world.proposal), width, "A calmer review workflow");
    await page.getByRole("button", {name: "Collapse artifact catalog", exact: true}).click();
    await page.locator(".as-catalog").waitFor({state: "detached"});
  }},
  {surface: "shell", state: "keyboard-shortcuts", widths: [1440], async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, world.proposal), width, "A calmer review workflow");
    await page.getByRole("button", {name: "Keyboard shortcuts"}).click();
    await page.locator(".as-keyboard-shortcuts[data-open]").waitFor();
  }},
  {surface: "inspector", state: "details", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, dashboard(world)), width, "Release readiness — version 3");
    await inspectorTab(page, "Details");
  }},
  {surface: "inspector", state: "files", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, world.bundle), width, "Brand refresh starter kit");
    await inspectorTab(page, "Files");
    await page.locator(".as-file-list").waitFor();
  }},
  {surface: "inspector", state: "versions", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, dashboard(world)), width, "Release readiness — version 3");
    await inspectorTab(page, "Versions");
    await page.locator(".as-version-list li").first().waitFor();
  }},
  {surface: "inspector", state: "activity", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, dashboard(world)), width, "Release readiness — version 3");
    await inspectorTab(page, "Activity");
  }},
  {surface: "inspector", state: "compare", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, dashboard(world)), width, "Release readiness — version 3");
    await inspectorTab(page, "Versions");
    await page.getByRole("button", {name: "Compare", exact: true}).click();
    await page.getByRole("tabpanel", {name: "Compare"}).waitFor();
  }},
  {surface: "comments", state: "open-anchored", async run(page, world, width) {
    await comments(page, world, width);
  }},
  {surface: "comments", state: "markdown-page-threads", async run(page, world, width) {
    await comments(page, world, width, world.proposal, "A calmer review workflow");
  }},
  {surface: "comments", state: "none", async run(page, world, width) {
    await comments(page, world, width, world.uncommented, "Incident review: search latency");
  }},
  {surface: "comments", state: "many", async run(page, world, width) {
    await comments(page, world, width, world.checklist, "Customer onboarding checklist");
  }},
  {surface: "comments", state: "resolved", async run(page, world, width) {
    await comments(page, world, width);
    await page.getByRole("button", {name: "Resolved", exact: true}).click();
    await page.locator('[data-state="resolved"]').first().waitFor();
  }},
  {surface: "comments", state: "reply-composer", async run(page, world, width) {
    await comments(page, world, width);
    await page.locator(".as-comment-card").nth(1).getByRole("button", {name: "Reply", exact: true}).click();
    await page.getByLabel("Reply", {exact: true}).fill("Agreed — I will add the dates by Friday.");
  }},
  {surface: "comments", state: "frame-composer", widths: [1440, 1024], async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, dashboard(world)), width, "Release readiness — version 3");
    const target = preview(page).locator("#changes");
    await target.hover();
    await preview(page).locator("[data-plannotator-pinpoint-box]").first().waitFor();
    await target.click();
    await frame(page).getByPlaceholder("Add a comment...").fill("Can this section link to the changelog?");
  }},
  {surface: "comments", state: "selection-composer", widths: [1440], async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, world.proposal), width, "A calmer review workflow");
    const paragraph = preview(page).getByText("Start with the decision you want to make.", {exact: false}).first();
    const box = await paragraph.boundingBox();
    if (box === null) throw new Error("The paragraph has no box.");
    await page.mouse.move(box.x + 4, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + Math.min(box.width - 4, 320), box.y + 10, {steps: 8});
    await page.mouse.up();
    await frame(page).getByPlaceholder("Add a comment...").fill("Could this open with the question we want answered?");
  }},
  {surface: "send", state: "presence-popover", async run(page, world, width) {
    await comments(page, world, width);
    await page.getByRole("button", {name: /^Pi — /u}).first().hover();
    await page.getByText("Working directory").waitFor();
  }},
  {surface: "send", state: "agent-menu", async run(page, world, width) {
    await comments(page, world, width);
    await page.getByRole("button", {name: "Choose agent or send with a note"}).first().click();
    await page.getByText("Send with a note…").waitFor();
  }},
  {surface: "send", state: "note-dialog", async run(page, world, width) {
    await comments(page, world, width);
    await page.getByRole("button", {name: "Choose agent or send with a note"}).first().click();
    await page.getByText("Send with a note…").click();
    await page.getByRole("dialog").waitFor();
    await page.getByLabel("Note for the agent").fill("Please keep the tone friendly and short.");
  }},
  {surface: "send", state: "sent-toast", async run(page, world, width) {
    await comments(page, world, width);
    await page.getByRole("button", {name: /^Send all open \(\d+\) to Pi$/u}).click();
    await page.getByRole("status").filter({hasText: /^Sent /u}).first().waitFor();
  }},
  {surface: "share", state: "overview", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, dashboard(world)), width, "Release readiness — version 3");
    await page.getByRole("button", {name: "Share", exact: true}).first().click();
    await page.locator(".as-share-popover[data-open]").waitFor();
  }},
  {surface: "share", state: "access", async run(page, world, width) {
    await openArtifact(page, reviewUrl(world, dashboard(world)), width, "Release readiness — version 3");
    await page.getByRole("button", {name: "Share", exact: true}).first().click();
    await page.getByRole("button", {name: "Manage access"}).click();
    await page.getByRole("heading", {name: "Artifact access"}).waitFor();
  }},
  ...([
    ["projects", "/review/settings/projects", "Projects"],
    ["project-detail", "/review/settings/projects/prj_default", "Project identity"],
    ["mcp", "/review/settings/mcp", "Connect agents with MCP"],
    ["webmcp", "/review/settings/webmcp", "WebMCP"],
    ["members", "/review/settings/members", "Members"],
    ["api-keys", "/review/settings/api-keys", "API keys"],
    ["public-links", "/review/settings/public-links", "Public links"],
    ["not-found", "/review/settings/nope", "Page not found"],
  ] as const).map(([state, route, heading]): Scenario => ({surface: "settings", state, async run(page, world) {
    await open(page, `${world.server.baseUrl}${route}`);
    await page.getByRole("heading", {name: heading}).first().waitFor();
  }})),
  {surface: "settings", state: "issue-key-dialog", widths: [1440, 390], async run(page, world) {
    await open(page, `${world.server.baseUrl}/review/settings/api-keys`);
    await page.getByRole("button", {name: "Issue API key"}).first().click();
    await page.getByRole("dialog").waitFor();
  }},
  {surface: "error", state: "artifact-not-found", async run(page, world) {
    await open(page, `${world.server.baseUrl}/review?project=prj_default&artifact=art_missing`);
    await page.getByRole("heading", {name: "Review target unavailable"}).waitFor();
  }},
  {surface: "error", state: "file-not-found", async run(page, world, width) {
    await open(page, reviewUrl(world, world.bundle, "&path=missing/not-in-manifest.png"));
    await page.getByText("File not found").first().waitFor();
    if (width < 600) {
      const collapse = page.getByRole("button", {name: "Collapse artifact catalog", exact: true});
      if (await collapse.isVisible()) await collapse.click();
    }
  }},
];

async function captureCell(page: Page, cell: Omit<Cell, "axeViolations" | "error" | "path">, scenario: Scenario, world: DesignReviewWorld): Promise<Cell> {
  const file = path.join(outputDirectory, `${cell.id}.png`);
  try {
    await scenario.run(page, world, cell.width);
    await page.waitForTimeout(400);
    await page.screenshot({animations: "disabled", path: file});
    const aria = await page.locator("body").ariaSnapshot().catch(() => "aria snapshot failed");
    await writeFile(path.join(outputDirectory, "aria", `${cell.id}.yml`), aria);
    const axe = await new AxeBuilder({page})
      .exclude(".as-artifact-frame")
      .exclude("[data-base-ui-focus-guard]")
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    await writeFile(path.join(outputDirectory, "axe", `${cell.id}.json`), `${JSON.stringify(axe.violations, null, 2)}\n`);
    return {...cell, axeViolations: axe.violations.map((violation) => ({id: violation.id, impact: violation.impact ?? null, nodes: violation.nodes.length})), error: null, path: path.relative(outputDirectory, file)};
  } catch (error) {
    await page.screenshot({animations: "disabled", path: file}).catch(() => undefined);
    return {...cell, axeViolations: [], error: String(error).split("\n")[0] ?? "unknown", path: path.relative(outputDirectory, file)};
  }
}

await mkdir(path.join(outputDirectory, "aria"), {recursive: true});
await mkdir(path.join(outputDirectory, "axe"), {recursive: true});
const browser = await chromium.launch({headless: true});
const cells: Cell[] = [];
try {
  for (const theme of values.themes.split(",")) {
    for (const width of values.widths.split(",").map(Number)) {
      // Fresh world per theme and width: sending and composing write state.
      // eslint-disable-next-line no-await-in-loop
      const world = await startDesignReviewWorld();
      try {
        for (const scenario of scenarios) {
          const id = `${scenario.surface}--${scenario.state}--${width}--${theme}`;
          if (scenario.widths !== undefined && !scenario.widths.includes(width)) continue;
          if (only !== null && !only.test(id)) continue;
          // A fresh context per cell keeps routes, popovers and storage independent.
          // eslint-disable-next-line no-await-in-loop
          const context = await browser.newContext({viewport: {height: heightFor(width), width}});
          // eslint-disable-next-line no-await-in-loop
          await context.addInitScript((chosen) => {
            try { window.localStorage.setItem("artifact-review-theme", chosen); } catch { /* sandboxed frames */ }
          }, theme);
          // eslint-disable-next-line no-await-in-loop
          const page = await context.newPage();
          // eslint-disable-next-line no-await-in-loop
          await open(page, world.server.baseUrl);
          // eslint-disable-next-line no-await-in-loop
          const cell = await captureCell(page, {id, state: scenario.state, surface: scenario.surface, theme, width}, scenario, world);
          cells.push(cell);
          console.log(`${cell.error === null ? "ok  " : "FAIL"} ${id}${cell.error === null ? ` axe=${cell.axeViolations.length}` : ` ${cell.error}`}`);
          // eslint-disable-next-line no-await-in-loop
          await context.close();
        }
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await world.server.stop();
        // eslint-disable-next-line no-await-in-loop
        await removeTestInstallation(world.installation);
      }
    }
  }
} finally {
  await browser.close();
  await writeFile(path.join(outputDirectory, "index.json"), `${JSON.stringify(cells, null, 2)}\n`);
}
