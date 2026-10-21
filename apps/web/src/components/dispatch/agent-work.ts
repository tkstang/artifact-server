import type {AgentDispatch, CommentThread} from "@/api/client";

/** Open sent comments an agent still holds, grouped by the agent's name. */
export interface AgentWork {
  /** Agent names with their comment counts, largest first. */
  readonly byAgent: readonly (readonly [name: string, count: number])[];
  /** Open sent comments whose send ended without reaching an agent. */
  readonly stalled: number;
  readonly total: number;
}

/** True while a send's agent still has its comments: queued to delivered. */
export function agentHoldsTheComment(dispatch: AgentDispatch): boolean {
  return dispatch.state === "queued"
    || dispatch.state === "claimed"
    || dispatch.state === "delivered";
}

/** Which agent holds each open sent comment, from the dispatch index. */
export function agentWorkOf(
  sentThreads: readonly CommentThread[],
  dispatchByThread: ReadonlyMap<string, AgentDispatch>,
): AgentWork {
  const counts = new Map<string, number>();
  let stalled = 0;
  for (const thread of sentThreads) {
    if (thread.state !== "open") continue;
    const dispatch = dispatchByThread.get(thread.id);
    if (dispatch !== undefined && !agentHoldsTheComment(dispatch)) {
      stalled += 1;
      continue;
    }
    const name = dispatch?.agentDisplayName ?? "an agent";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const byAgent = [...counts.entries()].toSorted((left, right) =>
    right[1] - left[1] || left[0].localeCompare(right[0])
  );
  return {
    byAgent,
    stalled,
    total: byAgent.reduce((sum, [, count]) => sum + count, 0),
  };
}

/** "1 comment is with Pi", "3 comments are with Pi and 1 with OpenCode". */
export function agentWorkSentence(work: AgentWork): string | null {
  const [first, ...rest] = work.byAgent;
  if (first === undefined) return null;
  const [name, count] = first;
  const lead = count === 1
    ? `1 comment is with ${name}`
    : `${count} comments are with ${name}`;
  if (rest.length === 0) return lead;
  const tail = rest.map(([other, otherCount]) => `${otherCount} with ${other}`);
  const last = tail.pop();
  return tail.length === 0
    ? `${lead} and ${last}`
    : `${lead}, ${tail.join(", ")} and ${last}`;
}
