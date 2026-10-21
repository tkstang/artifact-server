import {useEffect, useState} from "react";

import {api, type AgentPresence} from "@/api/client";
import {PresenceGlyph, presenceRing, type PresenceRing} from "@/components/dispatch/presence-avatar";
import {Button} from "@/components/ui/button";
import {errorMessage, formatRelativeTime} from "@/lib/presentation";

type AgentsState =
  | {readonly kind: "failed"; readonly message: string}
  | {readonly kind: "loaded"; readonly agents: readonly AgentPresence[]; readonly now: number}
  | {readonly kind: "loading"};

/**
 * The agents registered with this installation and whether each is connected
 * now, so an operator can confirm a setup worked without leaving Settings.
 */
export function ConnectedAgents() {
  const [state, setState] = useState<AgentsState>({kind: "loading"});
  const [refreshing, setRefreshing] = useState(false);

  const load = async (): Promise<void> => {
    setRefreshing(true);
    try {
      const agents = await api.agentPresence();
      setState({agents: orderAgents(agents), kind: "loaded", now: Date.now()});
    } catch (caught) {
      setState({
        kind: "failed",
        message: caught instanceof Error ? errorMessage(caught) : "Agents could not be loaded.",
      });
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <section aria-labelledby="settings-connected-agents" className="as-settings-agents">
      <header className="as-settings-agents__header">
        <div>
          <h2 id="settings-connected-agents">Connected agents</h2>
          <p>Agents that can receive the comments you send from Review.</p>
        </div>
        <Button
          disabled={refreshing}
          onClick={() => void load()}
          size="sm"
          type="button"
          variant="ghost"
        >
          {refreshing ? "Checking…" : "Refresh"}
        </Button>
      </header>
      {state.kind === "loading" ? (
        <p className="as-settings-agents__empty">Checking for agents…</p>
      ) : state.kind === "failed" ? (
        <p className="as-settings-agents__empty" role="alert">
          {`Couldn't load agents. ${state.message}`}
        </p>
      ) : state.agents.length === 0 ? (
        <div className="as-settings-agents__empty">
          <strong>No agents connected yet</strong>
          <p>
            Connect one with an MCP setup below. It appears here once it is running.
          </p>
        </div>
      ) : (
        <ul className="as-settings-agents__list">
          {state.agents.map((agent) => {
            const ring = presenceRing(agent);
            return (
              <li data-connected={agent.connected} key={agent.id}>
                <PresenceGlyph kind={agent.kind} ring={ring} size="md" />
                <div className="as-settings-agents__identity">
                  <strong>{agent.displayName}</strong>
                  <span>{agentStatus(agent, ring, state.now)}</span>
                </div>
                <code title={agent.workingDirectory}>{agent.workingDirectory}</code>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/** One agent's state in words: connected (and what it is doing) or last seen. */
function agentStatus(agent: AgentPresence, ring: PresenceRing, now: number): string {
  switch (ring) {
    case "idle":
      return "Connected";
    case "working":
      return "Connected · working";
    case "replying":
      return "Connected · replying";
    case "disconnected":
      return `Not connected · last seen ${formatRelativeTime(agent.lastSeenAt, now)}`;
  }
  return ring;
}

/** Connected agents first, then the most recently seen. */
function orderAgents(agents: readonly AgentPresence[]): readonly AgentPresence[] {
  return agents.toSorted((left, right) => {
    if (left.connected !== right.connected) return left.connected ? -1 : 1;
    return right.lastSeenAt.localeCompare(left.lastSeenAt);
  });
}
