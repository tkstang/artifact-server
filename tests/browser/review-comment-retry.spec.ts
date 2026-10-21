import {expect, test} from "@playwright/test";

import {publishNew} from "../support/publishing.js";
import {
  localLogin,
  startBrowserFixture,
  stopBrowserFixture,
} from "./browser-fixture.js";
import {listThreadsOverApi} from "./comment-api.js";

test.describe("Artifact Server Review comment retries", () => {
  test("CMT-010-B: a new comment retried after a lost response replays its key and stays one thread", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: "<!doctype html><html lang=\"en\"><h1>Retry fixture</h1></html>",
        idempotencyKey: "review-comment-retry-fixture",
        name: "Retry fixture",
      });
      const artifactId = published.body.artifact.id;
      const page = fixture.page;

      // The first create reaches the server and is stored, but its response
      // never reaches the browser: the reviewer sees a failure and retries.
      const sentKeys: string[] = [];
      let dropped = false;
      await page.route(
        (url) => url.pathname.endsWith("/comments")
          && url.pathname.includes(`/artifacts/${artifactId}/versions/`),
        async (route) => {
          if (route.request().method() !== "POST") return route.continue();
          sentKeys.push(route.request().headers()["idempotency-key"] ?? "");
          if (dropped) return route.continue();
          dropped = true;
          // Replay the browser's own request, including the same-origin
          // headers the server requires of browser mutations.
          const stored = await route.fetch({
            headers: {
              ...await route.request().allHeaders(),
              origin: new URL(route.request().url()).origin,
              "sec-fetch-mode": "cors",
              "sec-fetch-site": "same-origin",
            },
          });
          expect(stored.status()).toBe(201);
          return route.abort("connectionreset");
        },
      );

      await localLogin(fixture);
      await page.goto(`${fixture.server.baseUrl}/review?${new URLSearchParams({
        artifact: artifactId,
        project: "prj_default",
        version: published.body.version.id,
      })}`);
      await page.getByRole("tab", {name: /Comments/u}).click();
      await page.getByLabel("Add a comment").fill("Only once, please.");
      const post = page.getByRole("button", {name: "Post comment"});
      await post.click();
      await expect(page.locator(".as-comments__error")).toBeVisible();
      expect((await listThreadsOverApi(fixture, artifactId)).length).toBe(1);

      await post.click();
      const card = page.locator(".as-comment-card").filter({hasText: "Only once, please."});
      await expect(card).toHaveCount(1);
      await expect(page.getByLabel("Add a comment")).toHaveValue("");
      expect(sentKeys).toHaveLength(2);
      expect(sentKeys[0]).not.toBe("");
      expect(sentKeys[1]).toBe(sentKeys[0]);
      const stored = await listThreadsOverApi(fixture, artifactId);
      expect(stored.map((thread) => thread.body)).toEqual(["Only once, please."]);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });
});
