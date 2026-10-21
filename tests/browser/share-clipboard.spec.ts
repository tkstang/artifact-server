import {expect, test} from "@playwright/test";

import {publishNew} from "../support/publishing.js";
import {localLogin, startBrowserFixture, stopBrowserFixture} from "./browser-fixture.js";

test.describe("Share clipboard failure", () => {
  test("a rejected clipboard write says to copy by hand and selects the link, never the browser exception", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: "<!doctype html><html lang=\"en\"><title>Clipboard fixture</title><main><h1>Clipboard fixture</h1></main></html>",
        idempotencyKey: "share-clipboard-rejected",
        name: "Clipboard fixture",
      });
      // The browser refuses every clipboard write, as it does without
      // permission or focus; the page sees the real DOMException shape.
      await fixture.context.addInitScript(() => {
        navigator.clipboard.writeText = () => Promise.reject(
          new DOMException("Write permission denied.", "NotAllowedError"),
        );
      });
      await localLogin(fixture);
      const exactReviewLink = new URL(published.body.links.review);
      exactReviewLink.searchParams.set("path", "index.html");
      await fixture.page.goto(
        `${fixture.server.baseUrl}/review?${new URLSearchParams({
          artifact: published.body.artifact.id,
          path: "index.html",
          project: published.body.artifact.projectId,
          version: published.body.version.id,
        })}`,
      );

      await fixture.page
        .locator(".as-preview-header__actions")
        .getByRole("button", {exact: true, name: "Share"})
        .click();
      const share = fixture.page.locator(".as-share-popover[data-open]");
      await share.getByRole("button", {name: "Copy Review link"}).click();

      await expect(share.getByRole("alert"))
        .toHaveText("Couldn't copy — select the link and copy it.");
      await expect(share.getByText("Write permission denied.")).toHaveCount(0);
      await expect(share.getByRole("button", {name: "Copy Review link"})).toBeVisible();
      expect(await fixture.page.evaluate(() => window.getSelection()?.toString().trim()))
        .toBe(exactReviewLink.toString());
    } finally {
      await stopBrowserFixture(fixture);
    }
  });
});
