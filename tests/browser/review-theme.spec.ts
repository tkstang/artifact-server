import {expect, test} from "@playwright/test";

import {localLogin, startBrowserFixture, stopBrowserFixture} from "./browser-fixture.js";

test.describe("Review theme", () => {
  test("a first visit follows the OS colour scheme, and a saved choice wins over it", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const html = fixture.page.locator("html");
      await fixture.page.emulateMedia({colorScheme: "light"});
      await localLogin(fixture);
      await expect(html).toHaveAttribute("data-review-theme", "dawn");
      await expect(html).not.toHaveClass(/\bdark\b/u);

      await fixture.page.evaluate(() => window.localStorage.removeItem("artifact-review-theme"));
      await fixture.page.emulateMedia({colorScheme: "dark"});
      await fixture.page.reload();
      await expect(html).toHaveAttribute("data-review-theme", "moon");
      await expect(html).toHaveClass(/\bdark\b/u);

      await fixture.page.getByRole("button", {name: "Use light theme"}).click();
      await fixture.page.reload();
      await expect(html).toHaveAttribute("data-review-theme", "dawn");
    } finally {
      await stopBrowserFixture(fixture);
    }
  });
});
