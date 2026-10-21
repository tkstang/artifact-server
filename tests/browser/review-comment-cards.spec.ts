import {expect, test} from "@playwright/test";

import {ApiClient, issueApiKey, signInAdministrator} from "../support/agent-dispatch.js";
import {publishNew} from "../support/publishing.js";
import {connectAgentOverApi} from "./agent-api.js";
import {
  localLogin,
  startBrowserFixture,
  stopBrowserFixture,
} from "./browser-fixture.js";
import {
  createThreadOverApi,
  listThreadsOverApi,
  loseFirstCommittedCommentResponse,
} from "./comment-api.js";

function presenceRoute(url: URL): boolean {
  return url.pathname === "/api/v1/agents";
}

test.describe("Artifact Server Review comment cards", () => {
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
      // The browser's own wording ("Failed to fetch") never reaches the reader.
      await expect(page.locator(".as-comments__error"))
        .toHaveText("Can't reach Artifact Server. Check your connection and try again.");
      expect((await listThreadsOverApi(fixture, artifactId)).length).toBe(1);

      // Retry from the keyboard: Cmd/Ctrl+Enter submits like the button.
      await page.getByLabel("Add a comment").press("Control+Enter");
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

  test("CMT-010-B: a lost new comment keeps its key through a tab switch and a reload, and its retry stays one thread", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: "<!doctype html><html lang=\"en\"><h1>Remount fixture</h1></html>",
        idempotencyKey: "review-comment-remount-fixture",
        name: "Remount fixture",
      });
      const artifactId = published.body.artifact.id;
      const page = fixture.page;
      page.on("dialog", (dialog) => void dialog.accept());
      const sent = await loseFirstCommittedCommentResponse(page);

      await localLogin(fixture);
      await page.goto(`${fixture.server.baseUrl}/review?${new URLSearchParams({
        artifact: artifactId,
        project: "prj_default",
        version: published.body.version.id,
      })}`);
      await page.getByRole("tab", {name: /Comments/u}).click();
      await page.getByLabel("Add a comment").fill("Persist only once.");
      await page.getByRole("button", {name: "Post comment"}).click();
      await expect(page.locator(".as-comments__error")).toBeVisible();
      expect(await listThreadsOverApi(fixture, artifactId)).toHaveLength(1);

      // Switching tabs remounts the composer; a reload rebuilds the page.
      await page.getByRole("tab", {name: "Details", exact: true}).click();
      await page.getByRole("tab", {name: /^Comments/u}).click();
      await expect(page.getByLabel("Add a comment")).toHaveValue("Persist only once.");
      await page.reload();
      await page.getByRole("tab", {name: /^Comments/u}).click();
      await expect(page.getByLabel("Add a comment")).toHaveValue("Persist only once.");

      await page.getByRole("button", {name: "Post comment"}).click();
      await expect(page.getByLabel("Add a comment")).toHaveValue("");
      expect((await listThreadsOverApi(fixture, artifactId)).map((thread) => thread.body))
        .toEqual(["Persist only once."]);
      expect(sent.keys).toHaveLength(2);
      expect(sent.keys[1]).toBe(sent.keys[0]);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("CMT-010-B: a lost reply keeps its key when its composer closes and reopens, and its retry stays one reply", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: "<!doctype html><html lang=\"en\"><h1>Reply retry fixture</h1></html>",
        idempotencyKey: "review-comment-reply-retry-fixture",
        name: "Reply retry fixture",
      });
      const artifactId = published.body.artifact.id;
      const thread = await createThreadOverApi(fixture, {
        artifactId,
        body: "Answer me once.",
        idempotencyKey: "review-comment-reply-retry-thread",
        versionId: published.body.version.id,
      });
      const page = fixture.page;
      const sent = await loseFirstCommittedCommentResponse(page, /\/comments\/[^/]+\/replies\?/u);

      await localLogin(fixture);
      await page.goto(`${fixture.server.baseUrl}/review?${new URLSearchParams({
        artifact: artifactId,
        project: "prj_default",
        version: published.body.version.id,
      })}`);
      await page.getByRole("tab", {name: /Comments/u}).click();
      const card = page.locator(".as-comment-card").filter({hasText: "Answer me once."});
      await card.getByRole("button", {name: "Reply", exact: true}).click();
      await card.getByLabel("Reply").fill("Answered.");
      await card.getByRole("button", {name: "Post reply"}).click();
      await expect(page.locator(".as-comments__error")).toBeVisible();

      // Cancel unmounts the reply composer; reopening restores the draft.
      await card.getByRole("button", {name: "Cancel"}).click();
      await card.getByRole("button", {name: "Reply", exact: true}).click();
      await expect(card.getByLabel("Reply")).toHaveValue("Answered.");
      await card.getByRole("button", {name: "Post reply"}).click();
      await expect(card.locator(".as-comment-replies")).toContainText("Answered.");
      expect(sent.keys).toHaveLength(2);
      expect(sent.keys[1]).toBe(sent.keys[0]);
      const stored = await listThreadsOverApi(fixture, artifactId);
      expect(stored.find(({id}) => id === thread.id)?.replyCount).toBe(1);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("a registered agent's reply is attributed by its principal, whatever its key is named", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: "<!doctype html><html lang=\"en\"><h1>Attribution fixture</h1></html>",
        idempotencyKey: "review-comment-attribution-fixture",
        name: "Attribution fixture",
      });
      const artifactId = published.body.artifact.id;
      const thread = await createThreadOverApi(fixture, {
        artifactId,
        body: "Review this.",
        idempotencyKey: "review-comment-attribution-thread",
        versionId: published.body.version.id,
      });
      // The key's name is what the API records as the reply's author; the
      // registration it connected with is named Pi.
      const cookies = await signInAdministrator(fixture.server, fixture.installation);
      const agent = new ApiClient(fixture.server, await issueApiKey(
        fixture.server,
        cookies,
        ["agent:connect", "artifact:read", "comment:write"],
        "Pi production key",
      ));
      await agent.registerAgent({
        agentSessionId: "attribution-session",
        connectionKey: "attribution-connection",
        displayName: "Pi",
        workingDirectory: "/work/attribution",
      });
      const reply = await agent.fetch(
        `/api/v1/artifacts/${artifactId}/comments/${thread.id}/replies?projectId=prj_default`,
        {body: JSON.stringify({body: "I fixed this."}), idempotencyKey: "review-comment-attribution-reply", method: "POST"},
      );
      expect(reply.status).toBe(201);

      await localLogin(fixture);
      await fixture.page.goto(`${fixture.server.baseUrl}/review?${new URLSearchParams({
        artifact: artifactId,
        project: "prj_default",
        version: published.body.version.id,
      })}`);
      await fixture.page.getByRole("tab", {name: /Comments/u}).click();
      const card = fixture.page.locator(".as-comment-card").filter({hasText: "Review this."});
      const replies = card.locator(".as-comment-replies");
      await expect(replies).toContainText("Pi production key");
      await expect(replies.locator(".as-comment-author__agent")).toHaveText("Agent");
      // The human who opened the thread is not an agent.
      await expect(card.locator(":scope > header .as-comment-author__agent")).toHaveCount(0);
      await expect(card.locator(".as-comment-card__state")).toContainText("Pi replied");
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("a general comment reads as general, and only a lost anchor reads as unavailable", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: "<!doctype html><html lang=\"en\"><h1>Anchor fixture</h1><p>Present text.</p></html>",
        idempotencyKey: "review-comment-anchor-fixture",
        name: "Anchor fixture",
      });
      const versionId = published.body.version.id;
      const artifactId = published.body.artifact.id;
      await createThreadOverApi(fixture, {
        artifactId,
        body: "About the whole page.",
        idempotencyKey: "review-comment-general",
        versionId,
      });
      await createThreadOverApi(fixture, {
        anchor: {
          htmlAnchor: {selector: "#gone", tagName: "P", text: "Removed passage."},
          originalText: "Removed passage.",
        },
        artifactId,
        body: "About a passage this version no longer has.",
        idempotencyKey: "review-comment-lost-anchor",
        versionId,
      });

      await localLogin(fixture);
      const page = fixture.page;
      await page.goto(`${fixture.server.baseUrl}/review?${new URLSearchParams({
        artifact: artifactId,
        project: "prj_default",
        version: versionId,
      })}`);
      await page.getByRole("tab", {name: /Comments/u}).click();
      const lost = page.getByRole("article").filter({hasText: "no longer has"});
      const general = page.getByRole("article").filter({hasText: "About the whole page."});
      // The frame has reported its unplaceable threads once the lost one says so.
      await expect(lost.getByText("Location unavailable in this version")).toBeVisible();
      await expect(general.getByText("Location unavailable in this version")).toHaveCount(0);
      await expect(general.getByText("General comment", {exact: true})).toBeVisible();
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("a failed first comment read shows one retryable error instead of an empty conversation", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: "<!doctype html><html lang=\"en\"><h1>Read failure fixture</h1></html>",
        idempotencyKey: "review-comment-read-failure",
        name: "Read failure fixture",
      });
      const artifactId = published.body.artifact.id;
      await createThreadOverApi(fixture, {
        artifactId,
        body: "A comment that exists.",
        idempotencyKey: "review-comment-read-failure-thread",
        versionId: published.body.version.id,
      });
      const page = fixture.page;
      let available = false;
      await page.route(
        (url) => url.pathname.endsWith(`/artifacts/${artifactId}/comments`),
        (route) => available || route.request().method() !== "GET"
          ? route.continue()
          : route.fulfill({
            body: JSON.stringify({
              error: {code: "UNAVAILABLE", message: "Comments are unavailable."},
            }),
            contentType: "application/json",
            status: 503,
          }),
      );

      await localLogin(fixture);
      await page.goto(`${fixture.server.baseUrl}/review?${new URLSearchParams({
        artifact: artifactId,
        project: "prj_default",
        version: published.body.version.id,
      })}`);
      await page.getByRole("tab", {name: /Comments/u}).click();
      const failure = page.locator(".as-comments__read-error");
      await expect(failure).toContainText("Comments could not be loaded.");
      await expect(page.getByText(/No open comments|are resolved/u)).toHaveCount(0);
      await expect(page.getByRole("button", {name: /^Send all open/u})).toHaveCount(0);
      // The tab carries no count it does not know, rather than a false 0.
      await expect(page.getByRole("tab", {name: /Comments/u})).toHaveText("Comments");

      available = true;
      await failure.getByRole("button", {name: "Try again"}).click();
      await expect(page.getByRole("article").filter({hasText: "A comment that exists."}))
        .toBeVisible();
      await expect(failure).toHaveCount(0);
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("comments with an agent are counted as with it, never as resolved", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: "<!doctype html><html lang=\"en\"><h1>Agent work fixture</h1></html>",
        idempotencyKey: "review-comment-agent-work",
        name: "Agent work fixture",
      });
      const artifactId = published.body.artifact.id;
      const versionId = published.body.version.id;
      const done = await createThreadOverApi(fixture, {
        artifactId,
        body: "Already settled.",
        idempotencyKey: "review-comment-agent-work-done",
        versionId,
      });
      await createThreadOverApi(fixture, {
        artifactId,
        body: "Please tighten the intro.",
        idempotencyKey: "review-comment-agent-work-open",
        versionId,
      });
      const owner = new ApiClient(fixture.server, fixture.installation.apiToken);
      expect((await owner.setThreadState(published.body, done.id, "resolved")).status)
        .toBe(200);
      await connectAgentOverApi(fixture, "builder");

      await localLogin(fixture);
      const page = fixture.page;
      await page.goto(`${fixture.server.baseUrl}/review?${new URLSearchParams({
        artifact: artifactId,
        project: "prj_default",
        version: versionId,
      })}`);
      await page.getByRole("tab", {name: /Comments/u}).click();
      await page.getByRole("button", {name: "Send all open (1) to builder"}).click();
      await expect(page.getByText("1 comment is with builder.", {exact: true})).toBeVisible();
      await expect(page.getByText("All comments on this version are resolved.")).toHaveCount(0);
      await expect(page.locator(".as-comments__counts")).toHaveText("0 open · 1 with builder");
      await page.getByRole("button", {name: "Show sent comments"}).click();
      await expect(page.getByRole("button", {name: "Sent (1)"}))
        .toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("article").filter({hasText: "Please tighten the intro."}))
        .toContainText("With builder");

      // All keeps sent comments out (DSP-004) and says where they are.
      await page.getByRole("button", {exact: true, name: "All"}).click();
      await expect(page.getByRole("article").filter({hasText: "Already settled."}))
        .toBeVisible();
      await expect(page.getByRole("article").filter({hasText: "Please tighten the intro."}))
        .toHaveCount(0);
      await expect(page.getByText("1 sent comment is listed under Sent, not here."))
        .toBeVisible();
      await page.getByRole("button", {name: "Show sent comments"}).click();
      await expect(page.getByRole("button", {name: "Sent (1)"}))
        .toHaveAttribute("aria-pressed", "true");
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("a failed presence check reads as unknown and disables sending with a reason", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: "<!doctype html><html lang=\"en\"><h1>Presence fixture</h1></html>",
        idempotencyKey: "review-comment-stale-presence",
        name: "Presence fixture",
      });
      await createThreadOverApi(fixture, {
        artifactId: published.body.artifact.id,
        body: "Waiting for an agent.",
        idempotencyKey: "review-comment-stale-presence-thread",
        versionId: published.body.version.id,
      });
      await connectAgentOverApi(fixture, "builder");
      await localLogin(fixture);
      const page = fixture.page;
      await page.goto(`${fixture.server.baseUrl}/review?${new URLSearchParams({
        artifact: published.body.artifact.id,
        project: "prj_default",
        version: published.body.version.id,
      })}`);
      await page.getByRole("tab", {name: /Comments/u}).click();
      const sendAll = page.getByRole("button", {name: "Send all open (1) to builder"});
      await expect(sendAll).toBeEnabled();

      await page.route(presenceRoute, (route) => route.abort());
      await page.getByRole("button", {exact: true, name: "Reload"}).click();
      await expect(page.getByText("Agent status unknown — the last check failed."))
        .toBeVisible();
      await expect(page.getByText("Can't send until agent status is known.")).toBeVisible();
      await expect(sendAll).toBeDisabled();
      await expect(page.getByRole("button", {name: "builder — Idle"})).toHaveCount(0);

      await page.unroute(presenceRoute);
      await page.getByRole("button", {exact: true, name: "Reload"}).click();
      await expect(sendAll).toBeEnabled();
    } finally {
      await stopBrowserFixture(fixture);
    }
  });

  test("resolving from Open leaves a short Undo that reopens the comment", async ({browser}) => {
    const fixture = await startBrowserFixture(browser);
    try {
      const published = await publishNew(fixture.server, fixture.installation, {
        accessSetting: "account_required",
        content: "<!doctype html><html lang=\"en\"><h1>Resolve fixture</h1></html>",
        idempotencyKey: "review-comment-resolve-undo",
        name: "Resolve fixture",
      });
      const artifactId = published.body.artifact.id;
      await createThreadOverApi(fixture, {
        artifactId,
        body: "Fix the heading.",
        idempotencyKey: "review-comment-resolve-undo-thread",
        versionId: published.body.version.id,
      });
      await localLogin(fixture);
      const page = fixture.page;
      await page.goto(`${fixture.server.baseUrl}/review?${new URLSearchParams({
        artifact: artifactId,
        project: "prj_default",
        version: published.body.version.id,
      })}`);
      await page.getByRole("tab", {name: /Comments/u}).click();
      const card = page.getByRole("article").filter({hasText: "Fix the heading."});
      await card.getByRole("button", {exact: true, name: "Resolve"}).click();
      const acknowledgement = page.locator(".as-comment-ack");
      await expect(acknowledgement).toContainText("Resolved");
      await expect(card).toHaveCount(0);
      expect((await listThreadsOverApi(fixture, artifactId))[0]?.state).toBe("resolved");

      await acknowledgement.getByRole("button", {name: "Undo"}).click();
      await expect(card).toHaveAttribute("data-state", "open");
      await expect(acknowledgement).toHaveCount(0);
      expect((await listThreadsOverApi(fixture, artifactId))[0]?.state).toBe("open");
    } finally {
      await stopBrowserFixture(fixture);
    }
  });
});
