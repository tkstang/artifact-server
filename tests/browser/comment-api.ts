import {expect, type Page} from "@playwright/test";
import {z} from "zod";

import {apiHeaders} from "../support/runtime-harness.js";
import type {BrowserFixture} from "./browser-fixture.js";

/**
 * The comment shapes these browser tests read, mirroring the response shaping
 * in `src/http/create-http-app.ts` rather than the specification example.
 */
const threadSchema = z.object({
  anchor: z.unknown(),
  artifactId: z.string(),
  author: z.object({
    displayName: z.string(),
    principalId: z.string(),
    principalKind: z.string(),
  }),
  body: z.string(),
  id: z.string(),
  path: z.string().nullable(),
  replyCount: z.number(),
  state: z.enum(["open", "resolved"]),
  versionId: z.string(),
});

const threadPageSchema = z.object({
  items: z.array(threadSchema),
  nextCursor: z.string().nullable(),
});

const createdThreadSchema = z.object({
  replayed: z.boolean(),
  thread: threadSchema,
});

const replySchema = z.object({
  body: z.string(),
  id: z.string(),
  threadId: z.string(),
});

const createdReplySchema = z.object({
  replayed: z.boolean(),
  reply: replySchema,
});

export type CommentThread = z.infer<typeof threadSchema>;

/** Seed one reply through the same HTTP contract used by agents and Review. */
export async function createReplyOverApi(
  fixture: BrowserFixture,
  input: {
    readonly artifactId: string;
    readonly body: string;
    readonly idempotencyKey: string;
    readonly projectId?: string;
    readonly threadId: string;
  },
): Promise<z.infer<typeof replySchema>> {
  const projectId = input.projectId ?? "prj_default";
  const response = await fetch(
    `${fixture.server.baseUrl}/api/v1/artifacts/${input.artifactId}/comments/${input.threadId}/replies?projectId=${projectId}`,
    {
      body: JSON.stringify({body: input.body}),
      headers: apiHeaders(fixture.installation, input.idempotencyKey),
      method: "POST",
    },
  );
  expect(response.status).toBe(201);
  return createdReplySchema.parse(await response.json()).reply;
}

/**
 * Seed one thread the way an agent does: over the API, with a service token,
 * before anybody opens the browser.
 */
export async function createThreadOverApi(
  fixture: BrowserFixture,
  input: {
    readonly anchor?: unknown;
    readonly artifactId: string;
    readonly body: string;
    readonly idempotencyKey: string;
    readonly path?: string;
    readonly projectId?: string;
    readonly versionId: string;
  },
): Promise<CommentThread> {
  const projectId = input.projectId ?? "prj_default";
  const draft = input.path === undefined
    ? {anchor: input.anchor ?? {kind: "page"}, body: input.body}
    : {anchor: input.anchor ?? {kind: "page"}, body: input.body, path: input.path};
  const response = await fetch(
    `${fixture.server.baseUrl}/api/v1/artifacts/${input.artifactId}/versions/${input.versionId}/comments?projectId=${projectId}`,
    {
      body: JSON.stringify(draft),
      headers: apiHeaders(fixture.installation, input.idempotencyKey),
      method: "POST",
    },
  );
  expect(response.status).toBe(201);
  return createdThreadSchema.parse(await response.json()).thread;
}

/** Read the stored threads for one artifact straight from the API. */
export async function listThreadsOverApi(
  fixture: BrowserFixture,
  artifactId: string,
  projectId = "prj_default",
): Promise<readonly CommentThread[]> {
  const response = await fetch(
    `${fixture.server.baseUrl}/api/v1/artifacts/${artifactId}/comments?projectId=${projectId}`,
    {headers: {Authorization: `Bearer ${fixture.installation.apiToken}`}},
  );
  expect(response.status).toBe(200);
  return threadPageSchema.parse(await response.json()).items;
}

/**
 * Let the first comment create on `page` reach the server and be stored, then
 * drop its response, as a lost network reply would. Later creates pass. The
 * replay forwards the same-origin headers the server requires of browser
 * mutations, so the first save genuinely commits (asserted as 201).
 */
export async function loseFirstCommittedCommentResponse(page: Page): Promise<{
  readonly bodies: readonly string[];
  readonly keys: readonly string[];
}> {
  const bodies: string[] = [];
  const keys: string[] = [];
  await page.route(/\/versions\/[^/]+\/comments\?/u, async (route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }
    keys.push(request.headers()["idempotency-key"] ?? "");
    bodies.push(z.object({body: z.string()}).parse(request.postDataJSON()).body);
    if (keys.length > 1) {
      await route.continue();
      return;
    }
    const stored = await route.fetch({
      headers: {
        ...await request.allHeaders(),
        origin: new URL(request.url()).origin,
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(stored.status()).toBe(201);
    await route.abort("connectionreset");
  });
  return {bodies, keys};
}
