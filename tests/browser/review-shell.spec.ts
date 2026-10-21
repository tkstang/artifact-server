import {expect, test} from "@playwright/test";

import {ApiClient, issueApiKey, signInAdministrator} from "../support/agent-dispatch.js";
import {publishNew, publishVersion} from "../support/publishing.js";
import {
  localLogin,
  startBrowserFixture,
  stopBrowserFixture,
  type BrowserFixture,
} from "./browser-fixture.js";
import {
  createThreadOverApi,
  listThreadsOverApi,
  loseFirstCommittedCommentResponse,
} from "./comment-api.js";

const reviewDocument = "<!doctype html><html lang=\"en\"><title>Shell fixture</title><main><h1 id=\"shell-target\">Shell preview content</h1><p>Body text for the shell fixture.</p></main></html>";

async function publishShellFixture(fixture: BrowserFixture, name = "Shell fixture") {
  return publishNew(fixture.server, fixture.installation, {
    accessSetting: "account_required",
    content: reviewDocument,
    idempotencyKey: `review-shell-${name}`,
    name,
  });
}

function reviewUrl(fixture: BrowserFixture, artifactId: string, versionId?: string): string {
  const version = versionId === undefined ? "" : `&version=${versionId}`;
  return `${fixture.server.baseUrl}/review?project=prj_default&artifact=${artifactId}${version}`;
}

test.describe("Review shell", () => {
  test("CMT-015-F: a narrow link that names an artifact opens on the document, not behind the catalog", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishShellFixture(fixture);
      await fixture.page.setViewportSize({height: 844, width: 390});
      await localLogin(fixture);
      const catalog = fixture.page.getByRole("complementary", {name: "Artifact catalog"});
      // The bare review URL still starts on the catalog.
      await expect(catalog).toBeVisible();

      await fixture.page.goto(reviewUrl(fixture, published.body.artifact.id));
      const preview = fixture.page.frameLocator(".as-artifact-frame").frameLocator("iframe");
      await expect(preview.getByRole("heading", {name: "Shell preview content"})).toBeVisible();
      await expect(catalog).toHaveCount(0);
      await fixture.page.getByRole("button", {name: "Open artifact catalog"}).click();
      await expect(catalog).toBeVisible();
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("CMT-015-F: Show in page steps an overlaying inspector aside so the anchor is visible", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishShellFixture(fixture);
      await createThreadOverApi(fixture, {
        artifactId: published.body.artifact.id,
        body: "Check the heading.",
        idempotencyKey: "review-shell-show-in-page",
        path: "index.html",
        versionId: published.body.version.id,
      });
      await localLogin(fixture);
      const inspector = fixture.page.getByRole("complementary", {name: "Artifact inspector"});
      const showInPage = fixture.page.getByRole("button", {name: "Show in page"});

      // Docked beside the artifact, the inspector stays open.
      await fixture.page.setViewportSize({height: 800, width: 1440});
      await fixture.page.goto(reviewUrl(fixture, published.body.artifact.id));
      await fixture.page.getByRole("tab", {name: /^Comments/u}).click();
      await showInPage.click();
      await expect(inspector).toBeVisible();

      // Overlaying the artifact, it steps aside.
      await fixture.page.setViewportSize({height: 768, width: 1024});
      await showInPage.click();
      await expect(inspector).toBeHidden();
      await expect(fixture.page.getByRole("button", {name: "Open inspector"})).toBeVisible();
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("CMT-018-F: Reload recovers a preview whose lease failed", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishShellFixture(fixture);
      await localLogin(fixture);
      // The lease keeps failing until the reader asks for a reload.
      let leaseAvailable = false;
      await fixture.page.route(/\/preview-leases\?/u, async (route) => {
        if (leaseAvailable) {
          await route.continue();
          return;
        }
        await route.fulfill({
          contentType: "application/json",
          json: {error: {code: "INTERNAL_ERROR", message: "Preview storage is briefly unavailable."}},
          status: 503,
        });
      });
      await fixture.page.goto(reviewUrl(fixture, published.body.artifact.id, published.body.version.id));
      await expect(fixture.page.getByRole("heading", {name: "Preview unavailable"})).toBeVisible();

      leaseAvailable = true;
      await fixture.page.locator(".as-preview-footer").getByRole("button", {name: "Reload"}).click();
      const preview = fixture.page.frameLocator(".as-artifact-frame").frameLocator("iframe");
      await expect(preview.getByRole("heading", {name: "Shell preview content"})).toBeVisible();
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("DRF-001-F: a failed in-document comment keeps its anchor when it is retried from the comments panel", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishShellFixture(fixture);
      await localLogin(fixture);
      await fixture.page.setViewportSize({height: 900, width: 1440});
      // The first save reaches the server and is stored, but its response is
      // lost: the retry must reuse the key so the comment is not duplicated.
      const sent = await loseFirstCommittedCommentResponse(fixture.page);
      await fixture.page.goto(reviewUrl(fixture, published.body.artifact.id, published.body.version.id));
      const reviewFrame = fixture.page.frameLocator(".as-artifact-frame");
      const preview = reviewFrame.frameLocator("iframe");
      await preview.locator("#shell-target").hover();
      await preview.locator("#shell-target").click();
      await reviewFrame.getByPlaceholder("Add a comment...").fill("Name the owner of this heading.");
      await reviewFrame.getByRole("button", {name: "Save"}).click();

      const composer = fixture.page.getByLabel("Add a comment");
      await expect(composer).toHaveValue("Name the owner of this heading.");
      expect(await listThreadsOverApi(fixture, published.body.artifact.id)).toHaveLength(1);
      await fixture.page.getByRole("button", {name: "Post comment"}).click();
      await expect(composer).toHaveValue("");
      await expect(async () => {
        const stored = await listThreadsOverApi(fixture, published.body.artifact.id);
        expect(stored).toHaveLength(1);
        expect(stored[0]?.path).toBe("index.html");
        expect(stored[0]?.anchor).toMatchObject({originalText: "Shell preview content"});
      }).toPass();
      expect(sent.keys).toHaveLength(2);
      expect(sent.keys[1]).toBe(sent.keys[0]);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("DRF-001-F: a lost in-document save padded with whitespace is retried from the panel as the same request", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishShellFixture(fixture);
      await localLogin(fixture);
      await fixture.page.setViewportSize({height: 900, width: 1440});
      const sent = await loseFirstCommittedCommentResponse(fixture.page);
      await fixture.page.goto(reviewUrl(fixture, published.body.artifact.id, published.body.version.id));
      const reviewFrame = fixture.page.frameLocator(".as-artifact-frame");
      const preview = reviewFrame.frameLocator("iframe");
      await preview.locator("#shell-target").hover();
      await preview.locator("#shell-target").click();
      await reviewFrame.getByPlaceholder("Add a comment...").fill("  Spaced body  ");
      await reviewFrame.getByRole("button", {name: "Save"}).click();

      // The panel composer trims what it posts; the retry must still be the
      // request the server already stored, not a second comment.
      const composer = fixture.page.getByLabel("Add a comment");
      await expect(composer).toHaveValue(/Spaced body/u);
      expect(await listThreadsOverApi(fixture, published.body.artifact.id)).toHaveLength(1);
      await fixture.page.getByRole("button", {name: "Post comment"}).click();
      await expect(composer).toHaveValue("");
      const stored = await listThreadsOverApi(fixture, published.body.artifact.id);
      expect(stored.map((thread) => thread.body)).toEqual(["Spaced body"]);
      expect(sent.keys).toHaveLength(2);
      expect(sent.keys[1]).toBe(sent.keys[0]);
      expect(sent.bodies[1]).toBe(sent.bodies[0]);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("DSP-004-B: the catalog comment total keeps its scope while sent comments leave the open count", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishShellFixture(fixture);
      await Promise.all([1, 2].map((index) => createThreadOverApi(fixture, {
        artifactId: published.body.artifact.id,
        body: `Comment ${index}`,
        idempotencyKey: `review-shell-count-${index}`,
        versionId: published.body.version.id,
      })));
      const cookies = await signInAdministrator(fixture.server, fixture.installation);
      const agent = new ApiClient(
        fixture.server,
        await issueApiKey(fixture.server, cookies, ["agent:connect"], "counter key"),
      );
      await agent.registerAgent({
        agentSessionId: "session-counter",
        connectionKey: "review-shell-counter",
        displayName: "counter",
        workingDirectory: "/work/counter",
      });
      await localLogin(fixture);
      await fixture.page.setViewportSize({height: 900, width: 1440});
      await fixture.page.goto(reviewUrl(fixture, published.body.artifact.id, published.body.version.id));
      const card = fixture.page.locator(".as-artifact-card[data-selected='true']");
      await expect(card).toContainText("2 comments");
      await fixture.page.getByRole("tab", {name: /^Comments/u}).click();
      await expect(fixture.page.getByRole("tab", {name: /^Comments/u})).toHaveAccessibleName("Comments 2 open");

      await fixture.page.getByRole("button", {name: "Send all open (2) to counter"}).click();
      await expect(fixture.page.getByText("Sent 2 comments to counter")).toBeVisible();
      // Every comment still exists; sending moves it to the agent, not out of the total.
      await expect(card).toContainText("2 comments");
      await expect(fixture.page.getByRole("tab", {name: /^Comments/u})).toHaveAccessibleName("Comments");
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("CMT-015-F: Escape closes the panel that overlays the artifact", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishShellFixture(fixture);
      await fixture.page.setViewportSize({height: 768, width: 1024});
      await localLogin(fixture);
      await fixture.page.goto(reviewUrl(fixture, published.body.artifact.id, published.body.version.id));
      const inspector = fixture.page.getByRole("complementary", {name: "Artifact inspector"});
      await fixture.page.getByRole("button", {name: "Open inspector"}).click();
      await fixture.page.getByRole("tab", {name: "Details"}).focus();
      await fixture.page.keyboard.press("Escape");
      await expect(inspector).toBeHidden();
      await expect(fixture.page.locator("#review-preview")).toBeFocused();

      // The catalog stays open from the wider layout and now overlays the artifact.
      await fixture.page.setViewportSize({height: 844, width: 390});
      const catalog = fixture.page.getByRole("complementary", {name: "Artifact catalog"});
      await expect(catalog).toBeVisible();
      await fixture.page.keyboard.press("Escape");
      await expect(catalog).toHaveCount(0);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("CMT-015-B: inspector tabs follow the tabs keyboard pattern and the panel is a keyboard stop", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishShellFixture(fixture);
      await fixture.page.setViewportSize({height: 900, width: 1440});
      await localLogin(fixture);
      await fixture.page.goto(reviewUrl(fixture, published.body.artifact.id, published.body.version.id));
      const tabs = fixture.page.getByRole("tab");
      await expect(tabs).toHaveCount(5);
      const comments = fixture.page.getByRole("tab", {name: /^Comments/u});
      await comments.click();
      await expect(fixture.page.locator("[role='tab'][tabindex='0']")).toHaveCount(1);

      await fixture.page.keyboard.press("ArrowRight");
      const details = fixture.page.getByRole("tab", {name: "Details"});
      await expect(details).toBeFocused();
      await expect(details).toHaveAttribute("aria-selected", "true");
      await fixture.page.keyboard.press("End");
      await expect(fixture.page.getByRole("tab", {name: "Activity"})).toBeFocused();
      await fixture.page.keyboard.press("ArrowRight");
      await expect(comments).toBeFocused();
      await fixture.page.keyboard.press("ArrowLeft");
      await expect(fixture.page.getByRole("tab", {name: "Activity"})).toHaveAttribute("aria-selected", "true");
      await fixture.page.keyboard.press("Home");
      await expect(comments).toHaveAttribute("aria-selected", "true");

      // Tab leaves the tab list in one step (past Close inspector) for the panel
      // itself, which a keyboard user can then scroll.
      await fixture.page.keyboard.press("Tab");
      await expect(fixture.page.getByRole("button", {name: "Close inspector"})).toBeFocused();
      await fixture.page.keyboard.press("Tab");
      await expect(fixture.page.getByRole("tabpanel")).toBeFocused();
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("CMT-015-B: the header and the focus bar name the exact artifact and version", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishShellFixture(fixture);
      await publishVersion(fixture.server, fixture.installation, {
        artifactId: published.body.artifact.id,
        content: reviewDocument,
        expectedCurrentVersionId: published.body.version.id,
        idempotencyKey: "review-shell-identity-v2",
      });
      await fixture.page.setViewportSize({height: 900, width: 1440});
      await localLogin(fixture);
      await fixture.page.goto(reviewUrl(fixture, published.body.artifact.id, published.body.version.id));
      const header = fixture.page.locator(".as-preview-header");
      await expect(header.getByRole("heading", {name: "Shell fixture"})).toBeVisible();
      await expect(header.getByText("Version 1 of 2", {exact: true})).toBeVisible();
      await expect(fixture.page.locator(".as-preview-footer")).toContainText("Version 1 of 2 · 1 file");

      await fixture.page.getByRole("button", {name: "Full screen"}).click();
      const focusBar = fixture.page.getByRole("toolbar", {name: "Artifact viewer controls"});
      await expect(focusBar.getByText("Shell fixture", {exact: true})).toBeVisible();
      await expect(focusBar.getByText("Version 1 of 2", {exact: true})).toBeVisible();
      await expect(focusBar.getByRole("button", {name: "Exit full screen"})).toBeVisible();
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("CMT-015-B: on a phone the HTML focus bar keeps the artifact identity and exit on screen", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishShellFixture(fixture, "A long title for an important document");
      await fixture.page.setViewportSize({height: 844, width: 390});
      await localLogin(fixture);
      await fixture.page.goto(`${reviewUrl(fixture, published.body.artifact.id, published.body.version.id)}&view=focus`);
      const focusBar = fixture.page.getByRole("toolbar", {name: "Artifact viewer controls"});
      const exit = focusBar.getByRole("button", {name: "Exit full screen"});
      await expect(exit).toBeVisible();
      await expect(exit).toBeInViewport({ratio: 1});
      const identity = fixture.page.locator(".as-focus-controls__identity");
      await expect(identity).toBeInViewport({ratio: 1});
      await expect(identity.locator(".as-version-chip")).toBeInViewport({ratio: 1});
      // The bar keeps to two rows (identity, then controls) over the document.
      const rows = await focusBar.evaluate((bar) => new Set(
        [...bar.children]
          .map((child) => child.getBoundingClientRect())
          .filter((box) => box.width > 0 && box.height > 0)
          .map((box) => Math.round(box.top)),
      ).size);
      expect(rows).toBeLessThanOrEqual(2);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("CMT-016-F: an unavailable Review target is reported once, with a way back", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      await publishShellFixture(fixture);
      await fixture.page.setViewportSize({height: 900, width: 1440});
      await localLogin(fixture);
      await fixture.page.goto(`${fixture.server.baseUrl}/review?project=prj_default&artifact=art_missing-shell-target`);
      await expect(fixture.page.getByRole("heading", {name: "Review target unavailable"})).toBeVisible();
      await expect(fixture.page.getByRole("alert")).toHaveCount(0);
      await expect(fixture.page.getByText("Nothing selected")).toHaveCount(0);

      await fixture.page.getByRole("button", {name: "Back to the catalog"}).click();
      await expect(fixture.page.getByRole("heading", {name: "Select an artifact"})).toBeVisible();
      expect(new URL(fixture.page.url()).searchParams.get("artifact")).toBeNull();
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("PRD-003-B: Compare shows the changed lines of a text file before and after", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const first = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: "alpha\nbeta\ngamma\n",
        idempotencyKey: "review-shell-compare-v1",
        mediaType: "text/plain; charset=utf-8",
        name: "Compare fixture",
        path: "notes.txt",
      });
      await publishVersion(fixture.server, fixture.installation, {
        artifactId: first.body.artifact.id,
        content: "alpha\nBETA, revised\ngamma\n",
        expectedCurrentVersionId: first.body.version.id,
        idempotencyKey: "review-shell-compare-v2",
        mediaType: "text/plain; charset=utf-8",
        path: "notes.txt",
      });
      await fixture.page.setViewportSize({height: 900, width: 1440});
      await localLogin(fixture);
      await fixture.page.goto(reviewUrl(fixture, first.body.artifact.id));
      await fixture.page.getByRole("tab", {name: "Versions"}).click();
      await fixture.page.getByRole("button", {name: "Compare", exact: true}).click();
      const panel = fixture.page.getByRole("tabpanel", {name: "Compare"});
      const before = panel.getByRole("region", {name: /^Before · Version 1, line 2$/u});
      const after = panel.getByRole("region", {name: /^After · Version 2, line 2$/u});
      await expect(before.getByRole("listitem")).toHaveText(["beta"]);
      await expect(after.getByRole("listitem")).toHaveText(["BETA, revised"]);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("leaving a comparison keeps one inspector tab in the tab order and the panel labelled", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const first = await publishShellFixture(fixture, "Compared fixture");
      await publishVersion(fixture.server, fixture.installation, {
        artifactId: first.body.artifact.id,
        content: reviewDocument.replace("Body text", "Revised body text"),
        expectedCurrentVersionId: first.body.version.id,
        idempotencyKey: "review-shell-compared-v2",
      });
      await publishShellFixture(fixture, "Other fixture");
      await fixture.page.setViewportSize({height: 900, width: 1440});
      await localLogin(fixture);
      await fixture.page.goto(reviewUrl(fixture, first.body.artifact.id));
      await fixture.page.getByRole("tab", {name: "Versions"}).click();
      await fixture.page.getByRole("button", {name: "Compare", exact: true}).click();
      await expect(fixture.page.getByRole("tab", {name: "Compare"})).toHaveAttribute("aria-selected", "true");

      // Another artifact has no comparison, so the Compare tab goes away.
      await fixture.page.locator(".as-artifact-card").filter({hasText: "Other fixture"}).click();
      await expect(fixture.page.getByRole("heading", {name: "Other fixture", exact: true})).toBeVisible();
      await expect(fixture.page.getByRole("tab", {name: "Compare"})).toHaveCount(0);
      const reachable = fixture.page.locator("[role='tab'][tabindex='0']");
      await expect(reachable).toHaveCount(1);
      await expect(reachable).toHaveAttribute("aria-selected", "true");
      const labelledBy = await fixture.page.getByRole("tabpanel").getAttribute("aria-labelledby");
      expect(labelledBy).not.toBeNull();
      await expect(fixture.page.locator(`#${labelledBy ?? ""}`)).toHaveCount(1);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("CMT-015-F: an overlaying panel closes on an outside click and dims the document only on a phone", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishShellFixture(fixture);
      await fixture.page.setViewportSize({height: 900, width: 1440});
      await localLogin(fixture);
      await fixture.page.goto(reviewUrl(fixture, published.body.artifact.id, published.body.version.id));
      const inspector = fixture.page.getByRole("complementary", {name: "Artifact inspector"});
      const catcher = fixture.page.locator(".as-overlay-scrim[data-panel='inspector']");
      const background = async (): Promise<string> => catcher.evaluate((element) => getComputedStyle(element).backgroundColor);
      await expect(inspector).toBeVisible();
      // Docked beside the artifact, the inspector needs no catcher.
      await expect(catcher).toBeHidden();

      // Overlaying a laptop-width document, the inspector leaves the document
      // readable beside it: the catcher takes outside clicks without dimming.
      await fixture.page.setViewportSize({height: 768, width: 1024});
      await expect(catcher).toBeVisible();
      expect(await background()).toBe("rgba(0, 0, 0, 0)");
      const previewWidth = (await fixture.page.locator(".as-preview-panel").boundingBox())?.width ?? 0;
      expect(previewWidth).toBeGreaterThan(600);
      // Over the artifact, outside the panel (the catalog stays docked at this width).
      await fixture.page.mouse.click(480, 400);
      await expect(inspector).toBeHidden();
      await expect(catcher).toHaveCount(0);

      // On a phone the panel covers most of the document, so a scrim dims it.
      await fixture.page.setViewportSize({height: 844, width: 390});
      // The catalog, docked at 1024, now overlays; set it aside first.
      await fixture.page.getByRole("button", {name: "Collapse artifact catalog"}).click();
      await fixture.page.getByRole("button", {name: "Open inspector"}).click();
      await expect(inspector).toBeVisible();
      await expect(catcher).toBeVisible();
      expect(await background()).not.toBe("rgba(0, 0, 0, 0)");
    } finally {
      await stopBrowserFixture(fixture);
    }
  });
});
