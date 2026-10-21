import {ApiClient, issueApiKey, signInAdministrator} from "../support/agent-dispatch.js";
import type {BrowserFixture} from "./browser-fixture.js";

/**
 * Register one connected agent over the API with an `agent:connect` key, the
 * credential a bridge holds, never the browser session.
 */
export async function connectAgentOverApi(
  fixture: BrowserFixture,
  name: string,
): Promise<{readonly agentId: string; readonly client: ApiClient}> {
  const cookies = await signInAdministrator(fixture.server, fixture.installation);
  const token = await issueApiKey(fixture.server, cookies, ["agent:connect"], `${name} key`);
  const client = new ApiClient(fixture.server, token);
  const agent = await client.registerAgent({
    agentSessionId: `session-${name}`,
    connectionKey: `connection-${name}`,
    displayName: name,
    workingDirectory: `/work/${name}`,
  });
  return {agentId: agent.id, client};
}
