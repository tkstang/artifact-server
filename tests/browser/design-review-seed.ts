import {readFile} from "node:fs/promises";
import path from "node:path";

import {z} from "zod";

import {
  ApiClient,
  issueApiKey,
  MutableClock,
  signInAdministrator,
} from "../support/agent-dispatch.js";
import {
  commitStagedUpload,
  createStagedUpload,
  publishNew,
  publishVersion,
  uploadEveryStagedFile,
  type PublishResponse,
  type TestSiteFile,
} from "../support/publishing.js";
import {
  createTestInstallation,
  startTestServer,
  type RunningTestServer,
  type TestInstallation,
} from "../support/runtime-harness.js";

// A small synthetic team world for the design review. It models the shape and
// volume of real review work: a long Markdown proposal, an HTML page with
// anchored threads across versions, a busy checklist, a multi-file bundle, a
// long title and an empty project. Nothing here is real user content.

// The fixed clock starts three hours back and walks forward in small steps, so
// catalog dates vary while browser sessions issued by this clock stay valid.
const step = 20 * 60_000;
const threadSchema = z.object({thread: z.object({id: z.string()})});

export interface DesignReviewWorld {
  readonly agent: {readonly id: string; readonly client: ApiClient; readonly name: string};
  readonly bundle: PublishResponse;
  readonly checklist: PublishResponse;
  readonly clock: MutableClock;
  readonly dashboard: readonly PublishResponse[];
  readonly emptyProjectId: string;
  readonly installation: TestInstallation;
  readonly longTitle: PublishResponse;
  readonly proposal: PublishResponse;
  readonly server: RunningTestServer;
  readonly uncommented: PublishResponse;
}

export const reviewUrl = (world: DesignReviewWorld, published: PublishResponse, extra = ""): string =>
  `${world.server.baseUrl}/review?project=${published.artifact.projectId}` +
  `&artifact=${published.artifact.id}&version=${published.version.id}${extra}`;

export async function startDesignReviewWorld(options: {readonly port?: number} = {}): Promise<DesignReviewWorld> {
  const installation = await createTestInstallation();
  const clock = new MutableClock(new Date(Date.now() - 3 * 3_600_000).toISOString());
  const server = await startTestServer(installation, options.port === undefined ? {clock} : {clock, port: options.port});
  const owner = new ApiClient(server, installation.apiToken);
  let sequence = 0;
  const key = (label: string): string => `design-review-${label}-${sequence++}`;

  const proposal = await publishFiles(server, installation, key("proposal"), "launch-review.md", [
    {path: "launch-review.md", mediaType: "text/markdown", bytes: await readFile(fixture("markdown-showcase.md"))},
    {path: "review-loop.svg", mediaType: "image/svg+xml", bytes: await readFile(fixture("review-loop.svg"))},
  ], {name: "A calmer review workflow", tags: ["proposal", "process"]});
  clock.advance(step);

  const dashboardOne = (await publishNew(server, installation, {
    accessSetting: "public_link", content: dashboardHtml(1), idempotencyKey: key("dashboard"),
    mediaType: "text/html; charset=utf-8", name: "Release readiness", path: "index.html",
    tags: ["release", "weekly"],
  })).body;
  clock.advance(step / 3);
  const dashboardTwo = (await publishVersion(server, installation, {
    artifactId: dashboardOne.artifact.id, content: dashboardHtml(2),
    expectedCurrentVersionId: dashboardOne.version.id, idempotencyKey: key("dashboard-v2"),
    mediaType: "text/html; charset=utf-8", path: "index.html",
  })).body;
  clock.advance(step / 3);
  const dashboardThree = (await publishVersion(server, installation, {
    artifactId: dashboardOne.artifact.id, content: dashboardHtml(3),
    expectedCurrentVersionId: dashboardTwo.version.id, idempotencyKey: key("dashboard-v3"),
    mediaType: "text/html; charset=utf-8", path: "index.html",
  })).body;
  clock.advance(step);

  const checklist = (await publishNew(server, installation, {
    accessSetting: "account_required", content: checklistHtml(), idempotencyKey: key("checklist"),
    mediaType: "text/html; charset=utf-8", name: "Customer onboarding checklist", path: "index.html",
    tags: ["onboarding", "support"],
  })).body;
  clock.advance(step / 2);

  const encoder = new TextEncoder();
  const bundle = await publishFiles(server, installation, key("bundle"), "index.html", [
    {path: "index.html", mediaType: "text/html; charset=utf-8", bytes: encoder.encode(bundleHtml())},
    {path: "styles/tokens.css", mediaType: "text/css; charset=utf-8", bytes: encoder.encode(":root { --space: 8px; }\nbody { font: 16px/1.6 system-ui; margin: 2rem; }\n")},
    {path: "notes/decisions.md", mediaType: "text/markdown", bytes: encoder.encode("# Decisions\n\n- Use one accent colour.\n- Keep cards soft.\n")},
    {path: "assets/review-loop.svg", mediaType: "image/svg+xml", bytes: await readFile(fixture("review-loop.svg"))},
  ], {name: "Brand refresh starter kit", tags: ["design"]});
  clock.advance(step);

  const longTitle = (await publishNew(server, installation, {
    accessSetting: "account_required",
    content: "<!doctype html><title>Notes</title><main><h1>Quarterly planning notes</h1><p>Short notes for a long title.</p></main>",
    idempotencyKey: key("long"), mediaType: "text/html; charset=utf-8",
    name: "Quarterly planning notes for the support, success and partnerships teams, including the open questions from the offsite",
    path: "index.html", tags: ["planning"],
  })).body;
  clock.advance(step / 2);

  const fillers = [
    ["Incident review: search latency", ["incident"]],
    ["Pricing page copy, draft two", ["copy", "marketing"]],
    ["Hiring loop for designers", ["hiring"]],
    ["Accessibility audit summary", ["accessibility"]],
    ["Partner newsletter, October", ["marketing"]],
    ["Data retention policy", ["policy"]],
  ] as const;
  let uncommented: PublishResponse | null = null;
  for (const [name, tags] of fillers) {
    // Deliberately sequential: publish order is the catalog's date order.
    // eslint-disable-next-line no-await-in-loop
    const published = (await publishNew(server, installation, {
      accessSetting: "account_required",
      content: `<!doctype html><title>${name}</title><main><h1>${name}</h1><p>A short synthetic page.</p></main>`,
      idempotencyKey: key("filler"), mediaType: "text/html; charset=utf-8", name, path: "index.html",
      tags: [...tags],
    })).body;
    uncommented ??= published;
    clock.advance(step / 2);
  }
  if (uncommented === null) throw new Error("The filler list is empty.");

  const emptyProjectId = await owner.createProject("Research archive", key("project"));

  // Named synthetic people and one agent, each writing through its own API key,
  // so threads show real authors instead of the installation token.
  const cookies = await signInAdministrator(server, installation);
  const author = async (name: string, capabilities: readonly string[]): Promise<ApiClient> =>
    new ApiClient(server, await issueApiKey(server, cookies, capabilities, name));
  const maya = await author("Maya Chen", ["artifact:read", "comment:write"]);
  const jordan = await author("Jordan Lee", ["artifact:read", "comment:write"]);
  const pi = await author("Pi", ["agent:connect", "artifact:read", "comment:write"]);

  // Threads on the Markdown proposal: page-level, one answered by the agent, one resolved.
  const proposalThreads = await openThreads(proposal, [
    [maya, {body: "Can we say who decides when a review is finished?"}],
    [jordan, {body: "The table reads well. Should the Decide stage name an owner?"}],
    [maya, {body: "Love the checklist. Could it link to the template?"}],
    [jordan, {body: "Typo in the second paragraph: 'reveiw'."}],
  ], key);
  await reply(pi, proposal, proposalThreads[0] ?? "", "Added a sentence under 'A rhythm that respects attention' naming the author as the decider.", key("reply"));
  await owner.setThreadState(proposal, proposalThreads[3] ?? "", "resolved");

  // Anchored threads on the latest dashboard version.
  const dashboard = dashboardThree;
  const anchored = await openThreads(dashboard, [
    [maya, {anchor: {selector: "#rollback", tagName: "P", text: "Rollback is rehearsed and documented."}, body: "Name the owner of the rollback plan."}],
    [jordan, {anchor: {selector: "#uptime", tagName: "P", text: "Uptime over the last 30 days: 99.95%."}, body: "Is 99.95% the target or the measured value?"}],
    [maya, {anchor: {selector: "#risks", tagName: "H2", text: "Open risks"}, body: "The risk list needs dates."}],
    [jordan, {anchor: {selector: "#signoff", tagName: "P", text: "Sign-off: engineering, design, product."}, body: "Should support sign off before launch?"}],
  ], key);
  await reply(pi, dashboard, anchored[0] ?? "", "Done. The rollback plan now names the on-call lead and links the runbook.", key("reply"));
  await reply(maya, dashboard, anchored[0] ?? "", "Thanks, that reads much better.", key("reply"));
  await reply(pi, dashboard, anchored[1] ?? "", "It is the measured value. I added the target (99.9%) next to it.", key("reply"));
  await owner.setThreadState(dashboard, anchored[1] ?? "", "resolved");

  // A busy checklist: enough threads to scroll.
  await openThreads(checklist, Array.from({length: 24}, (_, index) => [
    index % 2 === 0 ? maya : jordan,
    {body: index % 5 === 0
      ? `Step ${index + 1}: this needs a screenshot so new customers know which button to press, and it should say what happens if the import fails halfway.`
      : `Step ${index + 1}: tighten the wording.`},
  ] as const), key);

  // One connected agent, currently replying.
  const registered = await pi.registerAgent({
    agentSessionId: "session-pi", capabilities: {beacon: false, evidence: "native"},
    connectionKey: "design-review-pi", displayName: "Pi", workingDirectory: "/work/launch-site",
  });
  const activity = await pi.fetch(`/api/v1/agents/${registered.id}/activity`, {
    body: JSON.stringify({state: "replying"}), method: "POST",
  });
  if (activity.status !== 204) throw new Error(`Agent activity answered ${activity.status}.`);

  return {
    agent: {client: pi, id: registered.id, name: "Pi"},
    bundle, checklist, clock,
    dashboard: [dashboardOne, dashboardTwo, dashboardThree],
    emptyProjectId, installation, longTitle, proposal, server, uncommented,
  };
}

function fixture(name: string): string {
  return path.resolve("tests/browser/fixtures", name);
}

async function publishFiles(
  server: RunningTestServer,
  installation: TestInstallation,
  idempotencyKey: string,
  entryPath: string,
  files: readonly TestSiteFile[],
  target: {readonly name: string; readonly tags: readonly string[]},
): Promise<PublishResponse> {
  const upload = await createStagedUpload(server, installation, entryPath, files);
  await uploadEveryStagedFile(installation, upload.body, files);
  const committed = await commitStagedUpload(installation, upload.body, idempotencyKey, {
    accessSetting: "account_required", kind: "new_artifact", name: target.name, tags: [...target.tags],
  });
  return committed.body;
}

interface ThreadSeed {
  readonly anchor?: {readonly selector: string; readonly tagName: string; readonly text: string};
  readonly body: string;
}

async function openThreads(
  published: PublishResponse,
  seeds: readonly (readonly [ApiClient, ThreadSeed])[],
  key: (label: string) => string,
): Promise<readonly string[]> {
  const ids: string[] = [];
  for (const [writer, seed] of seeds) {
    const draft = seed.anchor === undefined
      ? {anchor: {kind: "page"}, body: seed.body}
      : {
        anchor: {
          htmlAnchor: {point: {x: 0.5, y: 0.5}, selector: seed.anchor.selector, tagName: seed.anchor.tagName, text: seed.anchor.text},
          originalText: seed.anchor.text,
        },
        body: seed.body,
        path: published.version.entryPath,
      };
    // Deliberately sequential: the seeding order is the listing order.
    // eslint-disable-next-line no-await-in-loop
    const response = await writer.fetch(
      `/api/v1/artifacts/${published.artifact.id}/versions/${published.version.id}/comments?projectId=${published.artifact.projectId}`,
      {body: JSON.stringify(draft), idempotencyKey: key("thread"), method: "POST"},
    );
    // eslint-disable-next-line no-await-in-loop
    if (response.status !== 201) throw new Error(`Opening a thread answered ${response.status}: ${await response.text()}`);
    // eslint-disable-next-line no-await-in-loop
    ids.push(threadSchema.parse(await response.json()).thread.id);
  }
  return ids;
}

async function reply(
  writer: ApiClient,
  published: PublishResponse,
  threadId: string,
  body: string,
  idempotencyKey: string,
): Promise<void> {
  const response = await writer.fetch(
    `/api/v1/artifacts/${published.artifact.id}/comments/${threadId}/replies?projectId=${published.artifact.projectId}`,
    {body: JSON.stringify({body}), idempotencyKey, method: "POST"},
  );
  if (response.status !== 201) throw new Error(`Replying answered ${response.status}: ${await response.text()}`);
}

function dashboardHtml(version: number): string {
  const extra = version >= 2 ? '<li>Support macros updated for the new billing page.</li>' : "";
  const risks = version >= 3 ? '<li>Payment provider sandbox is flaky in the afternoon.</li>' : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Release readiness</title>
<style>
  body { font: 16px/1.6 system-ui, sans-serif; margin: 0; color: #1f2328; background: #fff; }
  main { max-width: 760px; margin: 0 auto; padding: 40px 24px 80px; }
  h1 { font-size: 2rem; margin: 0 0 0.25rem; }
  .meta { color: #59636e; margin: 0 0 2rem; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; margin: 0 0 2rem; }
  .card { border: 1px solid #d1d9e0; border-radius: 10px; padding: 12px 14px; }
  .card strong { display: block; font-size: 1.5rem; }
</style></head>
<body><main>
  <h1 id="title">Release readiness — version ${version}</h1>
  <p class="meta">Billing page relaunch · target date next Thursday</p>
  <div class="cards">
    <div class="card"><span>Open bugs</span><strong>${7 - version}</strong></div>
    <div class="card"><span>Tests passing</span><strong>${96 + version}%</strong></div>
    <div class="card"><span>Teams signed off</span><strong>${version} of 3</strong></div>
  </div>
  <h2 id="status">Status</h2>
  <p id="uptime">Uptime over the last 30 days: 99.95%.</p>
  <p id="rollback">Rollback is rehearsed and documented.</p>
  <p id="signoff">Sign-off: engineering, design, product.</p>
  <h2 id="changes">What changed</h2>
  <ul><li>New invoice layout with clearer totals.</li><li>Saved cards can be renamed.</li>${extra}</ul>
  <h2 id="risks">Open risks</h2>
  <ul><li>Tax rounding differs between regions.</li><li>Two translations are still in review.</li>${risks}</ul>
</main></body></html>`;
}

function checklistHtml(): string {
  const steps = Array.from({length: 24}, (_, index) => `<li id="step-${index + 1}">Step ${index + 1}: ${[
    "Create the workspace", "Invite teammates", "Connect the calendar", "Import contacts", "Choose a plan",
    "Set up billing", "Pick a template", "Publish a first page",
  ][index % 8] ?? ""}.</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Customer onboarding checklist</title>
<style>body{font:16px/1.6 system-ui,sans-serif;margin:0;color:#1f2328}main{max-width:720px;margin:0 auto;padding:40px 24px}li{margin:.4rem 0}</style>
</head><body><main><h1>Customer onboarding checklist</h1><p>Every step a new customer takes in their first week.</p><ol>${steps}</ol></main></body></html>`;
}

function bundleHtml(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Brand refresh starter kit</title>
<link rel="stylesheet" href="styles/tokens.css"></head>
<body><h1>Brand refresh starter kit</h1><p>Tokens, notes and one illustration.</p>
<img alt="Review loop illustration" src="assets/review-loop.svg" width="320"></body></html>`;
}

/** Keep a seeded world running for a reviewer: `tsx tests/browser/design-review-seed.ts --port 8801`. */
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === path.resolve("tests/browser/design-review-seed.ts")) {
  const portIndex = process.argv.indexOf("--port");
  const port = portIndex === -1 ? undefined : Number(process.argv[portIndex + 1]);
  const world = await startDesignReviewWorld(port === undefined ? {} : {port});
  console.log(JSON.stringify({
    baseUrl: world.server.baseUrl,
    urls: {
      proposal: reviewUrl(world, world.proposal),
      dashboard: reviewUrl(world, world.dashboard[2] ?? world.proposal),
      checklist: reviewUrl(world, world.checklist),
      bundle: reviewUrl(world, world.bundle),
      longTitle: reviewUrl(world, world.longTitle),
      uncommented: reviewUrl(world, world.uncommented),
      emptyProject: `${world.server.baseUrl}/review?project=${world.emptyProjectId}`,
    },
  }, null, 2));
}
