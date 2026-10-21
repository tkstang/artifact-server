import {expect, test} from "@playwright/test";

import {publishNew} from "../support/publishing.js";
import {
  localLogin,
  startBrowserFixture,
  stopBrowserFixture,
  type BrowserFixture,
} from "./browser-fixture.js";
import {createThreadOverApi} from "./comment-api.js";

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
});
