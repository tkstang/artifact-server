import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {z} from "zod";

import {
  api,
  type AgentDispatch,
  type AgentPresence,
  type CommentAnchor,
  type CommentReply,
  type CommentThread,
  type CommentThreadDetails,
  type CommentThreadQuery,
} from "@/api/client";
import {
  documentAnchorOf,
  inDocumentOrder,
  quotedPassage,
} from "@/components/comments/comment-anchor";
import {CommentAuthor} from "@/components/comments/comment-author";
import {CommentComposer} from "@/components/comments/comment-composer";
import {useCommentDraft} from "@/components/comments/comment-drafts";
import {maximumCommentBodyCharacters} from "@/components/comments/comment-limits";
import {
  mergeThreads,
  threadWatermark,
  useCommentListOwnership,
  useCommentPoll,
} from "@/components/comments/comment-poll";
import {formatTimestamp} from "@/lib/presentation";
import {
  agentHoldsTheComment,
  agentWorkOf,
  agentWorkSentence,
} from "@/components/dispatch/agent-work";
import {bundleOfThreads} from "@/components/dispatch/dispatch-bundle";
import {loadDispatchIndex} from "@/components/dispatch/dispatch-index";
import {
  dispatchIsCancelable,
  DispatchStateChip,
} from "@/components/dispatch/dispatch-state";
import {useDispatchUndo} from "@/components/dispatch/dispatch-toast";
import {PresenceAvatar} from "@/components/dispatch/presence-avatar";
import {SendToAgentControl} from "@/components/dispatch/send-to-agent-dialog";
import {
  reviewAnchorSchema,
  type ReviewAnchor,
  type ReviewAnnotation,
} from "@/review-frame/protocol";

const threadPageSize = 100;
/** How long a resolved card stays in Open as "Resolved · Undo". */
const resolveAcknowledgementMilliseconds = 6_000;
const conversationLoadConcurrency = 6;

/** Said while the last presence check failed: the old list may be wrong. */
const presenceUnknownSummary = "Agent status unknown — the last check failed.";
const presenceUnknownReason = "Can't send until agent status is known.";

/** One line naming who can take comments: "Pi is connected". */
function agentPresenceSummary(
  agents: readonly AgentPresence[] | null,
  stale: boolean,
): string {
  if (stale) return presenceUnknownSummary;
  if (agents === null) return "Checking agents…";
  const connected = agents.filter((agent) => agent.connected);
  const offline = agents.filter((agent) => !agent.connected);
  const [onlyConnected] = connected;
  const lead = connected.length === 1 && onlyConnected !== undefined
    ? `${onlyConnected.displayName} is connected`
    : connected.length > 1
      ? `${connected.length} agents connected`
      : null;
  const [onlyOffline] = offline;
  if (lead === null) {
    return offline.length === 1 && onlyOffline !== undefined
      ? `${onlyOffline.displayName} is offline`
      : offline.length === 0
        ? "No agents connected"
        : `No agents connected · ${offline.length} offline`;
  }
  return offline.length === 0 ? lead : `${lead} · ${offline.length} offline`;
}

function threadQuery(
  versionId: string,
  since: string | null,
  cursor: string | null,
  dispatched: "exclude" | "include" | "only" | null = null,
): CommentThreadQuery {
  return {
    cursor,
    dispatched,
    limit: threadPageSize,
    since,
    state: null,
    versionId,
  };
}

async function loadAllThreads(
  projectId: string,
  artifactId: string,
  versionId: string,
  since: string | null,
  dispatched: "exclude" | "include" | "only" | null = null,
  cursor: string | null = null,
  collected: readonly CommentThread[] = [],
): Promise<readonly CommentThread[]> {
  const page = await api.comments(
    projectId,
    artifactId,
    threadQuery(versionId, since, cursor, dispatched),
  );
  const next = [...collected, ...page.items];
  return page.nextCursor === null
    ? next
    : loadAllThreads(
      projectId,
      artifactId,
      versionId,
      since,
      dispatched,
      page.nextCursor,
      next,
    );
}

function toAnnotation(thread: CommentThread): ReviewAnnotation {
  const parsed = reviewAnchorSchema.safeParse(thread.anchor);
  return {
    anchor: parsed.success ? parsed.data : null,
    body: thread.body,
    state: thread.state,
    threadId: thread.id,
  };
}

async function loadConversations(
  projectId: string,
  artifactId: string,
  threads: readonly CommentThread[],
): Promise<readonly CommentThreadDetails[]> {
  const conversations = new Map<string, CommentThreadDetails>();
  const worker = async (index: number): Promise<void> => {
    const thread = threads[index];
    if (thread === undefined) return;
    const details = await api.comment(projectId, artifactId, thread.id);
    conversations.set(thread.id, details);
    await worker(index + conversationLoadConcurrency);
  };
  await Promise.all(
    Array.from(
      {length: Math.min(conversationLoadConcurrency, threads.length)},
      (_, index) => worker(index),
    ),
  );
  return threads.flatMap((thread) => {
    const details = conversations.get(thread.id);
    return details === undefined ? [] : [details];
  });
}

export interface ReviewCommentSession {
  readonly artifactId: string | null;
  readonly annotations: readonly ReviewAnnotation[];
  /** Resolve an open thread or reopen a resolved one; true once stored. */
  readonly changeState: (thread: CommentThread) => Promise<boolean>;
  readonly createReply: (
    thread: CommentThread,
    body: string,
    idempotencyKey: string,
  ) => Promise<boolean>;
  readonly deleteReply: (reply: CommentReply) => Promise<void>;
  /** The last mutation failure, shown beside the threads it concerns. */
  readonly error: Error | null;
  /**
   * The last full read's failure, cleared by the next successful read. With
   * no threads loaded it means the conversation is unknown, not empty.
   */
  readonly loadError: Error | null;
  readonly loading: boolean;
  readonly projectId: string;
  readonly reload: () => Promise<void>;
  readonly repliesByThread: ReadonlyMap<string, readonly CommentReply[]>;
  readonly selectedThreadId: string | null;
  readonly selectThread: (threadId: string | null) => void;
  /**
   * Create a thread. Callers that can retry pass the compose attempt's stable
   * idempotency key so a retry after a lost response replays, never duplicates.
   */
  readonly submit: (
    body: string,
    anchor: ReviewAnchor | null,
    path: string | null,
    idempotencyKey?: string,
  ) => Promise<boolean>;
  readonly threads: readonly CommentThread[];
  readonly unanchoredIds: readonly string[];
  readonly updateUnanchored: (threadIds: readonly string[]) => void;
  readonly updateReply: (reply: CommentReply, body: string) => Promise<boolean>;
}

/** Keep one Review version's saved threads and Plannotator projections in sync. */
export function useReviewComments({
  artifactId,
  onVersionChanged,
  projectId,
  versionId,
}: {
  readonly artifactId: string | null;
  readonly onVersionChanged: (versionId: string) => void;
  readonly projectId: string;
  readonly versionId: string | null;
}): ReviewCommentSession {
  const [threads, setThreads] = useState<readonly CommentThread[]>([]);
  const [repliesByThread, setRepliesByThread] = useState<ReadonlyMap<
    string,
    readonly CommentReply[]
  >>(new Map());
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [unanchoredIds, setUnanchoredIds] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const watermarkRef = useRef<string | null>(null);
  const reloadGenerationRef = useRef(0);
  const threadUpdatedAtRef = useRef<ReadonlyMap<string, string>>(new Map());
  const ownership = useCommentListOwnership();
  const active = artifactId !== null && projectId !== "" && versionId !== null;

  const reload = useCallback(async (): Promise<void> => {
    const generation = reloadGenerationRef.current + 1;
    reloadGenerationRef.current = generation;
    if (artifactId === null || projectId === "" || versionId === null) {
      setThreads([]);
      setRepliesByThread(new Map());
      setSelectedThreadId(null);
      setUnanchoredIds([]);
      setError(null);
      setLoadError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await ownership.own(async () => {
        const listedThreads = await loadAllThreads(
          projectId,
          artifactId,
          versionId,
          null,
        );
        const conversations = await loadConversations(
          projectId,
          artifactId,
          listedThreads,
        );
        if (reloadGenerationRef.current !== generation) return;
        setThreads(conversations.map(({thread}) => thread));
        setRepliesByThread(new Map(
          conversations.map(({replies, thread}) => [thread.id, replies]),
        ));
        setLoadError(null);
      });
    } catch (caught) {
      if (reloadGenerationRef.current !== generation) return;
      setLoadError(
        caught instanceof Error ? caught : new Error("Comment loading failed."),
      );
    } finally {
      if (reloadGenerationRef.current === generation) setLoading(false);
    }
  }, [artifactId, ownership, projectId, versionId]);

  useEffect(() => {
    setThreads([]);
    setRepliesByThread(new Map());
    setSelectedThreadId(null);
    setUnanchoredIds([]);
    setLoadError(null);
    void reload();
  }, [reload]);

  useEffect(() => {
    watermarkRef.current = threadWatermark(threads);
    threadUpdatedAtRef.current = new Map(
      threads.map((thread) => [thread.id, thread.updatedAt]),
    );
    if (
      selectedThreadId !== null
      && !threads.some((thread) => thread.id === selectedThreadId)
    ) {
      setSelectedThreadId(null);
    }
  }, [selectedThreadId, threads]);

  const poll = useCallback(async (): Promise<void> => {
    if (artifactId === null || projectId === "" || versionId === null) return;
    const token = ownership.open();
    if (token < 0) return;
    try {
      const listedThreads = await loadAllThreads(
        projectId,
        artifactId,
        versionId,
        watermarkRef.current,
      );
      if (listedThreads.length === 0 || !ownership.settled(token)) return;
      const changedThreads = listedThreads.filter((thread) =>
        threadUpdatedAtRef.current.get(thread.id) !== thread.updatedAt
      );
      if (changedThreads.length === 0) return;
      const conversations = await loadConversations(
        projectId,
        artifactId,
        changedThreads,
      );
      if (!ownership.settled(token)) return;
      setThreads((current) => mergeThreads(
        current,
        conversations.map(({thread}) => thread),
      ));
      setRepliesByThread((current) => {
        const nextReplies = new Map(current);
        for (const conversation of conversations) {
          nextReplies.set(conversation.thread.id, conversation.replies);
        }
        return nextReplies;
      });
    } catch {
      // A failed background refresh leaves the last readable thread set intact.
    }
  }, [artifactId, ownership, projectId, versionId]);

  useCommentPoll(poll, active);

  const submit = useCallback(async (
    body: string,
    anchor: ReviewAnchor | null,
    path: string | null,
    idempotencyKey: string = crypto.randomUUID(),
  ): Promise<boolean> => {
    if (artifactId === null || projectId === "" || versionId === null) return false;
    setError(null);
    try {
      const storedAnchor: CommentAnchor = z.json().parse(anchor);
      const created = await ownership.own(() =>
        api.createComment(
          projectId,
          artifactId,
          versionId,
          {anchor: storedAnchor, body, path},
          idempotencyKey,
        )
      );
      if (created.thread.versionId !== versionId) {
        onVersionChanged(created.thread.versionId);
      } else {
        await reload();
        setSelectedThreadId(created.thread.id);
      }
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught : new Error("Comment creation failed."),
      );
      return false;
    }
  }, [artifactId, onVersionChanged, ownership, projectId, reload, versionId]);

  const changeState = useCallback(async (thread: CommentThread): Promise<boolean> => {
    if (artifactId === null || projectId === "") return false;
    setError(null);
    try {
      await ownership.own(() =>
        api.updateComment(projectId, artifactId, thread.id, {
          state: thread.state === "open" ? "resolved" : "open",
        })
      );
      await reload();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught : new Error("Comment state change failed."),
      );
      return false;
    }
  }, [artifactId, ownership, projectId, reload]);

  const createReply = useCallback(async (
    thread: CommentThread,
    body: string,
    idempotencyKey: string,
  ): Promise<boolean> => {
    if (artifactId === null || projectId === "" || thread.state !== "open") return false;
    setError(null);
    try {
      await ownership.own(() => api.createCommentReply(
        projectId,
        artifactId,
        thread.id,
        body,
        idempotencyKey,
      ));
      await reload();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("Reply creation failed."));
      return false;
    }
  }, [artifactId, ownership, projectId, reload]);

  const updateReply = useCallback(async (
    reply: CommentReply,
    body: string,
  ): Promise<boolean> => {
    if (artifactId === null || projectId === "") return false;
    setError(null);
    try {
      await ownership.own(() => api.updateCommentReply(
        projectId,
        artifactId,
        reply.threadId,
        reply.id,
        body,
      ));
      await reload();
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("Reply edit failed."));
      return false;
    }
  }, [artifactId, ownership, projectId, reload]);

  const deleteReply = useCallback(async (reply: CommentReply): Promise<void> => {
    if (artifactId === null || projectId === "") return;
    setError(null);
    try {
      await ownership.own(() => api.deleteCommentReply(
        projectId,
        artifactId,
        reply.threadId,
        reply.id,
      ));
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("Reply deletion failed."));
    }
  }, [artifactId, ownership, projectId, reload]);

  const annotations = useMemo(
    () => threads.filter((thread) => thread.state === "open").map(toAnnotation),
    [threads],
  );

  return {
    annotations,
    artifactId,
    changeState,
    createReply,
    deleteReply,
    error,
    loadError,
    loading,
    projectId,
    reload,
    repliesByThread,
    selectedThreadId,
    selectThread: setSelectedThreadId,
    submit,
    threads,
    unanchoredIds,
    updateUnanchored: setUnanchoredIds,
    updateReply,
  };
}

/** The new-thread composer, drafted per artifact and version. */
function NewThreadComposer({
  artifactId,
  principalId,
  session,
  versionId,
}: {
  readonly artifactId: string;
  readonly principalId: string;
  readonly session: ReviewCommentSession;
  readonly versionId: string;
}) {
  const draft = useCommentDraft({
    artifactId,
    principalId,
    threadId: null,
    versionId,
  });
  return (
    <div data-new-thread-composer>
      <CommentComposer
        cancelLabel={null}
        collapsible
        draftRestored={draft.restored}
        idempotencyKeyFor={draft.attemptKey}
        initialBody={draft.initialBody}
        inputId={`review-new-thread-${versionId}`}
        key={`new-thread-${versionId}-${draft.restored ? "draft" : "empty"}`}
        label="Add a comment"
        maximumCharacters={maximumCommentBodyCharacters}
        onBodyChange={draft.onBodyChange}
        onCancel={null}
        onDiscardDraft={draft.onDiscard}
        onSubmit={async (body, idempotencyKey) => {
          const saved = await session.submit(body, null, null, idempotencyKey);
          if (saved) draft.onPosted();
          return saved;
        }}
        placeholder="Comment on the whole document…"
        submitLabel="Post comment"
      />
    </div>
  );
}

/** One thread's reply composer, drafted per thread. */
function ReplyComposer({
  artifactId,
  principalId,
  session,
  thread,
}: {
  readonly artifactId: string;
  readonly principalId: string;
  readonly session: ReviewCommentSession;
  readonly thread: CommentThread;
}) {
  const draft = useCommentDraft({
    artifactId,
    principalId,
    threadId: thread.id,
    versionId: null,
  });
  const [expanded, setExpanded] = useState(draft.restored);
  const [replyBody, setReplyBody] = useState(draft.initialBody);

  if (!expanded) {
    return (
      <div className="as-comment-reply-composer" data-expanded="false">
        <button
          className="as-button as-comment-reply-trigger"
          onClick={() => setExpanded(true)}
          type="button"
        >
          Reply
        </button>
      </div>
    );
  }

  return (
    <div className="as-comment-reply-composer" data-expanded="true">
      <CommentComposer
        cancelLabel="Cancel"
        draftRestored={draft.restored}
        idempotencyKeyFor={draft.attemptKey}
        initialBody={replyBody}
        inputId={`review-reply-${thread.id}`}
        label="Reply"
        maximumCharacters={maximumCommentBodyCharacters}
        onBodyChange={(body) => {
          setReplyBody(body);
          draft.onBodyChange(body);
        }}
        onCancel={() => setExpanded(false)}
        onDiscardDraft={() => {
          setReplyBody("");
          draft.onDiscard();
        }}
        onSubmit={async (body, idempotencyKey) => {
          const saved = await session.createReply(thread, body, idempotencyKey);
          if (saved) {
            setReplyBody("");
            draft.onPosted();
            setExpanded(false);
          }
          return saved;
        }}
        placeholder="Add a reply…"
        submitLabel="Post reply"
      />
    </div>
  );
}

type CommentView = "all" | "open" | "resolved" | "sent";

export interface ReviewCommentsInspectorHandle {
  readonly reload: () => Promise<void>;
}

/** Review-native thread list kept beside, never over, the artifact. */
export const ReviewCommentsInspector = forwardRef<ReviewCommentsInspectorHandle, {
  readonly canDeleteAny: boolean;
  readonly canComment: boolean;
  readonly principalId: string;
  readonly session: ReviewCommentSession;
  readonly versionId: string | null;
}>(function ReviewCommentsInspector({
  canDeleteAny,
  canComment,
  principalId,
  session,
  versionId,
}, ref) {
  const unanchored = new Set(session.unanchoredIds);
  const [agents, setAgents] = useState<readonly AgentPresence[] | null>(null);
  // A failed poll makes the last list stale: it may no longer be connected.
  const [presenceStale, setPresenceStale] = useState(false);
  const [view, setView] = useState<CommentView>("open");
  const [sentThreads, setSentThreads] = useState<readonly CommentThread[]>([]);
  const [sentReplies, setSentReplies] = useState<ReadonlyMap<
    string,
    readonly CommentReply[]
  >>(new Map());
  const [dispatchByThread, setDispatchByThread] = useState<ReadonlyMap<
    string,
    AgentDispatch
  >>(new Map());
  const [sentLoading, setSentLoading] = useState(false);
  // Threads just resolved from Open keep their place as an Undo line briefly.
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set());
  const acknowledgementTimers = useRef(new Map<string, number>());
  const [sentError, setSentError] = useState<Error | null>(null);

  const loadAgents = useCallback(async (): Promise<void> => {
    try {
      setAgents(await api.agentPresence());
      setPresenceStale(false);
    } catch {
      setPresenceStale(true);
    }
  }, []);

  const loadSent = useCallback(async (): Promise<void> => {
    if (session.artifactId === null || session.projectId === "" || versionId === null) {
      setSentThreads([]);
      setSentReplies(new Map());
      setDispatchByThread(new Map());
      return;
    }
    setSentLoading(true);
    setSentError(null);
    try {
      const listed = await loadAllThreads(
        session.projectId,
        session.artifactId,
        versionId,
        null,
        "only",
      );
      const [conversations, index] = await Promise.all([
        loadConversations(session.projectId, session.artifactId, listed),
        loadDispatchIndex(session.projectId, listed.map((thread) => thread.id)),
      ]);
      setSentThreads(conversations.map(({thread}) => thread));
      setSentReplies(new Map(
        conversations.map(({replies, thread}) => [thread.id, replies]),
      ));
      setDispatchByThread(index);
    } catch (caught) {
      setSentError(caught instanceof Error ? caught : new Error("Sent comments failed."));
    } finally {
      setSentLoading(false);
    }
  }, [session.artifactId, session.projectId, versionId]);

  const reloadDispatchSurface = useCallback(async (): Promise<void> => {
    await Promise.all([session.reload(), loadSent(), loadAgents()]);
  }, [loadAgents, loadSent, session.reload]);
  useImperativeHandle(ref, () => ({reload: reloadDispatchSurface}), [reloadDispatchSurface]);
  const dispatchUndo = useDispatchUndo(session.projectId, reloadDispatchSurface);

  useEffect(() => {
    void Promise.all([loadAgents(), loadSent()]);
  }, [loadAgents, loadSent]);
  useCommentPoll(loadAgents, session.projectId !== "");
  useCommentPoll(
    loadSent,
    view === "sent" && session.artifactId !== null && versionId !== null,
  );

  useEffect(() => {
    const timers = acknowledgementTimers.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, []);

  const forgetAcknowledgement = (threadId: string): void => {
    window.clearTimeout(acknowledgementTimers.current.get(threadId));
    acknowledgementTimers.current.delete(threadId);
    setAcknowledged((current) => {
      const next = new Set(current);
      next.delete(threadId);
      return next;
    });
  };

  const resolveFromOpen = async (thread: CommentThread): Promise<void> => {
    if (!await session.changeState(thread)) return;
    setAcknowledged((current) => new Set(current).add(thread.id));
    acknowledgementTimers.current.set(thread.id, window.setTimeout(
      () => forgetAcknowledgement(thread.id),
      resolveAcknowledgementMilliseconds,
    ));
  };

  const undoResolve = async (thread: CommentThread): Promise<void> => {
    forgetAcknowledgement(thread.id);
    await session.changeState(thread);
  };

  const openThreads = session.threads.filter((thread) => thread.state === "open");
  const resolvedThreads = session.threads.filter((thread) => thread.state === "resolved");
  const visibleThreads = view === "sent"
    ? sentThreads
    : view === "all"
      ? [...openThreads, ...resolvedThreads]
      : view === "open"
        ? inDocumentOrder(session.threads.filter((thread) =>
          thread.state === "open" || acknowledged.has(thread.id)
        ))
        : resolvedThreads;
  const visibleReplies = view === "sent" ? sentReplies : session.repliesByThread;
  const loadingVisible = view === "sent" ? sentLoading : session.loading;
  // A failed first read leaves the conversation unknown: no count, list or
  // empty state may stand in for it. A failed later read keeps what loaded.
  const readFailed = session.loadError !== null && session.threads.length === 0;
  const sentReadFailed = sentError !== null && sentThreads.length === 0;
  const agentWork = agentWorkOf(sentThreads, dispatchByThread);
  // Commenting keys are service principals too, so only an author whose
  // principal registered as an agent earns the Agent tag; names prove nothing.
  const agentsByPrincipal = new Map(
    agents?.map((agent) => [agent.principalId, agent]) ?? [],
  );
  const openSentCount = sentThreads.filter((thread) => thread.state === "open").length;
  const now = Date.now();

  /** Why Open is empty, without claiming "resolved" for work an agent holds. */
  const openEmptyMessage = (): string => {
    const withAgents = agentWorkSentence(agentWork);
    const stalled = agentWork.stalled === 1
      ? "1 sent comment was not delivered."
      : `${agentWork.stalled} sent comments were not delivered.`;
    if (withAgents !== null) {
      return agentWork.stalled === 0 ? `${withAgents}.` : `${withAgents}. ${stalled}`;
    }
    if (agentWork.stalled > 0) return stalled;
    return resolvedThreads.length > 0
      || sentThreads.some((thread) => thread.state === "resolved")
      ? "All comments on this version are resolved."
      : "No open comments on this version.";
  };
  const showSent = (
    <button
      className="as-button as-comments__to-sent"
      onClick={() => setView("sent")}
      type="button"
    >
      Show sent comments
    </button>
  );

  const cancelDispatch = async (dispatch: AgentDispatch): Promise<void> => {
    setSentError(null);
    try {
      await api.cancelAgentDispatch(session.projectId, dispatch.id);
      await reloadDispatchSurface();
    } catch (caught) {
      setSentError(caught instanceof Error ? caught : new Error("Cancel failed."));
    }
  };

  const onSent = async (): Promise<void> => {
    await reloadDispatchSurface();
  };

  return (
    <div className="as-comments">
      {dispatchUndo.element}
      <div className="as-comments__agents">
        <p data-stale={presenceStale ? "true" : undefined}>
          {agentPresenceSummary(agents, presenceStale)}
        </p>
        <div aria-label="Agent presence" role="group">
          {presenceStale ? null : agents?.map((agent) => (
            <PresenceAvatar agent={agent} key={agent.id} now={now} />
          ))}
        </div>
      </div>
      {readFailed ? (
        <div className="as-comments__read-error" role="alert">
          <p>Comments could not be loaded. {session.loadError?.message}</p>
          <button
            className="as-button"
            disabled={session.loading}
            onClick={() => void reloadDispatchSurface()}
            type="button"
          >
            {session.loading ? "Trying again…" : "Try again"}
          </button>
        </div>
      ) : null}
      {canComment && !readFailed ? (
        <div className="as-comments__send-all">
          <SendToAgentControl
            agents={agents}
            buttonSize="xs"
            buttonVariant="default"
            feedback={dispatchUndo.feedback}
            label={`Send all open (${openThreads.length})…`}
            onSent={onSent}
            oneAgentLabel={(name) => `Send all open (${openThreads.length}) to ${name}`}
            openCount={openThreads.length}
            principalId={principalId}
            projectId={session.projectId}
            resolveBundle={() => Promise.resolve(bundleOfThreads(openThreads))}
            unavailableReason={presenceStale ? presenceUnknownReason : null}
          />
        </div>
      ) : null}
      {canComment ? null : (
        <p className="as-comments__read-only">
          Comments are read-only for this account or archived project.
        </p>
      )}
      {session.error === null ? null : (
        <p className="as-comments__error" role="alert">{session.error.message}</p>
      )}
      {readFailed ? null : session.loadError === null ? null : (
        <p className="as-comments__error" role="alert">
          Comments could not be refreshed; showing the last loaded ones.
        </p>
      )}
      {sentError === null || readFailed ? null : (
        <p className="as-comments__error" role="alert">{sentError.message}</p>
      )}
      {readFailed || (openThreads.length === 0 && agentWork.total === 0) ? null : (
        // Each count names its scope: open means not yet sent, so it is
        // exactly what Send all carries; the rest are held by an agent.
        <p className="as-comments__counts">
          {[
            `${openThreads.length} open`,
            ...agentWork.byAgent.map(([name, count]) => `${count} with ${name}`),
          ].join(" · ")}
        </p>
      )}
      {readFailed ? null : (
        <nav aria-label="Comment filters" className="as-comments__filters">
          {(["open", "all", "resolved", "sent"] as const).map((candidate) => (
            <button
              aria-pressed={view === candidate}
              className="as-button"
              key={candidate}
              onClick={() => setView(candidate)}
              type="button"
            >
              {candidate === "all"
                ? "All"
                : candidate === "sent"
                  ? sentReadFailed ? "Sent" : `Sent (${sentThreads.length})`
                  : `${candidate[0]?.toUpperCase()}${candidate.slice(1)}`}
            </button>
          ))}
        </nav>
      )}
      {canComment && !readFailed && versionId !== null && session.artifactId !== null ? (
        <NewThreadComposer
          artifactId={session.artifactId}
          key={`${session.artifactId}-${versionId}`}
          principalId={principalId}
          session={session}
          versionId={versionId}
        />
      ) : null}
      {loadingVisible && !readFailed && visibleThreads.length === 0 ? (
        <p className="as-inspector-empty">Loading comments…</p>
      ) : null}
      {view === "all" && !readFailed && sentThreads.length > 0 ? (
        // DSP-004 keeps sent comments out of default listings; say so here.
        <div className="as-inspector-empty as-comments__empty">
          <p>
            {sentThreads.length === 1
              ? "1 sent comment is listed under Sent, not here."
              : `${sentThreads.length} sent comments are listed under Sent, not here.`}
          </p>
          {showSent}
        </div>
      ) : null}
      {!loadingVisible && !readFailed && !(view === "sent" && sentReadFailed)
          && !(view === "all" && sentThreads.length > 0)
          && visibleThreads.length === 0 ? (
        <div className="as-inspector-empty as-comments__empty">
          <p>
            {view === "all"
              ? "No comments on this version yet."
              : view === "sent"
                ? "No sent comments on this version."
                : view === "open"
                  ? openEmptyMessage()
                  : `No ${view} comments on this version.`}
          </p>
          {view === "open" && openSentCount > 0 ? showSent : null}
        </div>
      ) : null}
      <ol className="as-comment-list">
        {visibleThreads.map((thread) => {
          const sentDispatch = view === "sent" ? dispatchByThread.get(thread.id) : undefined;
          const replies = visibleReplies.get(thread.id) ?? [];
          if (view === "open" && thread.state === "resolved") {
            return (
              <li key={thread.id}>
                <p className="as-comment-ack" role="status">
                  <span>Resolved</span>
                  <button
                    className="as-button"
                    onClick={() => void undoResolve(thread)}
                    type="button"
                  >
                    Undo
                  </button>
                </p>
              </li>
            );
          }
          const lastReply = replies.at(-1);
          const replyingAgent = thread.state === "open" && lastReply !== undefined
            ? agentsByPrincipal.get(lastReply.author.principalId)
            : undefined;
          const holder = sentDispatch !== undefined && agentHoldsTheComment(sentDispatch)
            ? sentDispatch.agentDisplayName
            : null;
          const stateLine = replyingAgent !== undefined
            ? `${replyingAgent.displayName} replied — check it and resolve`
            : holder === null
              ? null
              : `With ${holder}`;
          const anchor = documentAnchorOf(thread);
          const anchored = anchor !== null;
          const quote = anchor === null ? "" : quotedPassage(anchor);
          return (
            <li key={thread.id}>
              <article
                aria-current={session.selectedThreadId === thread.id ? "true" : undefined}
                className="as-comment-card"
                data-selected={session.selectedThreadId === thread.id}
                data-state={thread.state}
              >
                <header>
                  <CommentAuthor
                    displayName={thread.author.displayName}
                    isAgent={agentsByPrincipal.has(thread.author.principalId)}
                  />
                  {sentDispatch !== undefined
                    ? <DispatchStateChip state={sentDispatch.state} />
                    : thread.state === "resolved"
                      ? <span data-state="resolved">Resolved</span>
                      : null}
                </header>
                <div className="as-comment-card__body">
                  {quote === "" ? null : (
                    <blockquote className="as-comment-card__quote">{quote}</blockquote>
                  )}
                  <p>{thread.body}</p>
                  <footer>
                    {stateLine === null ? null : (
                      <p className="as-comment-card__state">{stateLine}</p>
                    )}
                    <div className="as-comment-card__meta">
                      <span>
                        Updated <time dateTime={thread.updatedAt}>
                          {formatTimestamp(thread.updatedAt)}
                        </time>
                      </span>
                      {anchored ? null : <span>General comment</span>}
                      {thread.path === null ? null : (
                        <span>Page <code>{thread.path}</code></span>
                      )}
                    </div>
                    {view !== "sent" && anchored && unanchored.has(thread.id) ? (
                      <small>Location unavailable in this version</small>
                    ) : null}
                    <div className="as-comment-card__actions">
                      {view === "sent" ? (
                        sentDispatch !== undefined && dispatchIsCancelable(sentDispatch.state) ? (
                          <button
                            className="as-button"
                            onClick={() => void cancelDispatch(sentDispatch)}
                            type="button"
                          >
                            Cancel send
                          </button>
                        ) : null
                      ) : (
                        <>
                          {canComment && thread.state === "open" ? (
                            <SendToAgentControl
                              agentGlyph={false}
                              agents={agents}
                              buttonSize="xs"
                              buttonVariant="ghost"
                              feedback={dispatchUndo.feedback}
                              label="Send…"
                              onSent={onSent}
                              oneAgentLabel={(name) => `Send to ${name}`}
                              openCount={1}
                              principalId={principalId}
                              projectId={session.projectId}
                              reasonDisplay="hidden"
                              resolveBundle={() => Promise.resolve(bundleOfThreads([thread]))}
                              unavailableReason={presenceStale ? presenceUnknownReason : null}
                            />
                          ) : null}
                          {thread.path === null ? null : (
                            <button
                              className="as-button"
                              onClick={() => session.selectThread(thread.id)}
                              type="button"
                            >
                              Show in page
                            </button>
                          )}
                          {canComment ? (
                            <button
                              className="as-button"
                              onClick={() => void (view === "open"
                                ? resolveFromOpen(thread)
                                : session.changeState(thread))}
                              type="button"
                            >
                              {thread.state === "open" ? "Resolve" : "Reopen"}
                            </button>
                          ) : null}
                        </>
                      )}
                    </div>
                  </footer>
                </div>
                {replies.length === 0 ? null : (
                  <section
                    aria-label={`${replies.length} ${replies.length === 1 ? "reply" : "replies"}`}
                    className="as-comment-card__conversation"
                  >
                    <p className="as-comment-card__conversation-label">
                      {replies.length} {replies.length === 1 ? "reply" : "replies"}
                    </p>
                    <ol className="as-comment-replies">
                      {replies.map((reply) => (
                        <ReviewReply
                          canDeleteAny={canDeleteAny}
                          canMutate={canComment}
                          isAgent={agentsByPrincipal.has(reply.author.principalId)}
                          key={reply.id}
                          onDelete={session.deleteReply}
                          onUpdate={session.updateReply}
                          principalId={principalId}
                          reply={reply}
                        />
                      ))}
                    </ol>
                  </section>
                )}
                {view !== "sent" && canComment && thread.state === "open"
                    && session.artifactId !== null ? (
                  <ReplyComposer
                    artifactId={session.artifactId}
                    principalId={principalId}
                    session={session}
                    thread={thread}
                  />
                ) : null}
              </article>
            </li>
          );
        })}
      </ol>
    </div>
  );
});

function ReviewReply({
  canDeleteAny,
  canMutate,
  isAgent,
  onDelete,
  onUpdate,
  principalId,
  reply,
}: {
  readonly canDeleteAny: boolean;
  readonly canMutate: boolean;
  readonly isAgent: boolean;
  readonly onDelete: (reply: CommentReply) => Promise<void>;
  readonly onUpdate: (reply: CommentReply, body: string) => Promise<boolean>;
  readonly principalId: string;
  readonly reply: CommentReply;
}) {
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const editorId = useId();
  const ownReply = reply.author.principalId === principalId;
  const remove = async (): Promise<void> => {
    setDeleting(true);
    await onDelete(reply);
    setDeleting(false);
  };
  return (
    <li>
      <header>
        <CommentAuthor displayName={reply.author.displayName} isAgent={isAgent} />
        <time dateTime={reply.updatedAt}>{formatTimestamp(reply.updatedAt)}</time>
      </header>
      {editing ? (
        <CommentComposer
          cancelLabel="Cancel"
          initialBody={reply.body}
          inputId={editorId}
          label="Edit reply"
          maximumCharacters={maximumCommentBodyCharacters}
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => {
            const changed = await onUpdate(reply, body);
            if (changed) setEditing(false);
            return changed;
          }}
          submitLabel="Save reply"
        />
      ) : <p>{reply.body}</p>}
      {!canMutate || editing || (!ownReply && !canDeleteAny) ? null : (
        <div className="as-comment-reply__actions">
          {ownReply ? (
            <button className="as-button" onClick={() => setEditing(true)} type="button">
              Edit
            </button>
          ) : null}
          <button
            className="as-button"
            disabled={deleting}
            onClick={() => void remove()}
            type="button"
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        </div>
      )}
    </li>
  );
}
