import {expect, test} from "@playwright/test";

import {publishNew} from "../support/publishing.js";
import {
  localLogin,
  startBrowserFixture,
  stopBrowserFixture,
  type BrowserFixture,
} from "./browser-fixture.js";

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
});
