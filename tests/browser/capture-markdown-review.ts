import {mkdir, readFile, writeFile} from "node:fs/promises";
import path from "node:path";

import {chromium} from "@playwright/test";

import {createTestInstallation, removeTestInstallation, startTestServer} from "../support/runtime-harness.js";
import {createStagedUpload, uploadEveryStagedFile, commitStagedUpload} from "../support/publishing.js";

// A representative document is needed to judge hierarchy, reading rhythm, code,
// tables and imagery; the short hostile-content fixture serves a different purpose.
const outputDirectory = path.resolve("project/evidence/markdown-review/design");
const installation = await createTestInstallation();
const server = await startTestServer(installation);
const browser = await chromium.launch({headless: true});
try {
  await mkdir(outputDirectory, {recursive: true});
  const files = await Promise.all([
    ["review-workflow.md", "text/markdown", "markdown-showcase.md"],
    ["review-loop.svg", "image/svg+xml", "review-loop.svg"],
  ].map(async ([publishedPath, mediaType, fixturePath]) => ({
    path: publishedPath ?? "", mediaType: mediaType ?? "",
    bytes: await readFile(path.join("tests/browser/fixtures", fixturePath ?? "")),
  })));
  const upload = await createStagedUpload(server, installation, "review-workflow.md", files);
  await uploadEveryStagedFile(installation, upload.body, files);
  const published = await commitStagedUpload(installation, upload.body, "markdown-design-showcase", {
    accessSetting: "account_required", kind: "new_artifact", name: "A calmer review workflow", tags: [],
  });
  const observations = await Promise.all((["dawn", "moon"] as const).map(async (theme) => {
    const context = await browser.newContext({viewport: {width: 1280, height: 960}});
    await context.addInitScript((chosen) => {
      window.localStorage.setItem("artifact-review-theme", chosen);
    }, theme);
    const page = await context.newPage();
    const url = `${server.baseUrl}/review?project=prj_default&artifact=${published.body.artifact.id}&version=${published.body.version.id}`;
    const preview = page.frameLocator(".as-artifact-frame").frameLocator("iframe");
    const color = theme === "dawn" ? "light" : "dark";
    await page.goto(server.baseUrl);
    const captureDesktop = async (mode: "embedded" | "focus"): Promise<void> => {
      await page.setViewportSize({width: mode === "focus" ? 1440 : 1280, height: 960});
      await page.goto(`${url}${mode === "focus" ? "&view=focus" : ""}`);
      await preview.getByRole("heading", {name: "A calmer review workflow"}).waitFor();
      await page.screenshot({path: path.join(outputDirectory, `desktop-${mode}-${color}.png`), animations: "disabled"});
      await preview.getByRole("heading", {name: "A rhythm that respects attention"}).scrollIntoViewIfNeeded();
      await page.screenshot({path: path.join(outputDirectory, `desktop-${mode}-${color}-table.png`), animations: "disabled"});
      await preview.getByRole("heading", {name: "A little structure, underneath"}).scrollIntoViewIfNeeded();
      await page.screenshot({path: path.join(outputDirectory, `desktop-${mode}-${color}-code.png`), animations: "disabled"});
      await preview.locator("img").scrollIntoViewIfNeeded();
      await preview.locator("img").evaluate(async (element) => {
        if (element instanceof HTMLImageElement) await element.decode();
      });
      await page.screenshot({path: path.join(outputDirectory, `desktop-${mode}-${color}-image.png`), animations: "disabled"});
      await preview.locator('.md-mermaid[data-diagram-state="rendered"]').waitFor();
      await preview.locator('.md-mermaid').scrollIntoViewIfNeeded();
      await page.screenshot({path: path.join(outputDirectory, `desktop-${mode}-${color}-mermaid.png`), animations: "disabled"});
    };
    await captureDesktop("embedded");
    await captureDesktop("focus");
    await page.setViewportSize({width: 390, height: 844});
    await page.goto(`${url}&view=focus`);
    await preview.getByRole("heading", {name: "A calmer review workflow"}).waitFor();
    await page.screenshot({path: path.join(outputDirectory, `narrow-focus-${color}.png`), animations: "disabled"});
    await preview.getByRole("heading", {name: "A little structure, underneath"}).scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(outputDirectory, `narrow-focus-${color}-code.png`), animations: "disabled"});
    await preview.locator('.md-mermaid[data-diagram-state="rendered"]').waitFor();
    await preview.locator('.md-mermaid').scrollIntoViewIfNeeded();
    await page.screenshot({path: path.join(outputDirectory, `narrow-focus-${color}-mermaid.png`), animations: "disabled"});
    await page.goto(url);
    await page.getByRole("button", {name: "Collapse artifact catalog", exact: true}).click();
    if (await page.getByRole("button", {name: "Close inspector", exact: true}).isVisible()) {
      await page.getByRole("button", {name: "Close inspector", exact: true}).click();
    }
    await page.locator(".as-catalog").waitFor({state: "detached"});
    await preview.getByRole("heading", {name: "A calmer review workflow"}).waitFor();
    await page.screenshot({path: path.join(outputDirectory, `narrow-embedded-${color}.png`), animations: "disabled"});
    const metrics = await preview.locator("body").evaluate((element) => ({
      bodyFont: getComputedStyle(element).fontFamily,
      bodyWeight: getComputedStyle(element).fontWeight,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    await context.close();
    return Object.assign({name: color}, metrics);
  }));
  await writeFile(path.join(outputDirectory, "observations.json"), `${JSON.stringify(observations, null, 2)}\n`);
} finally {
  await browser.close();
  await server.stop();
  await removeTestInstallation(installation);
}
