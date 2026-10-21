import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {z} from "zod";

import {maximumCommentBodyCharacters} from "@/components/comments/comment-limits";

/**
 * Frontend-only comment drafts (`project/spec/comment-drafts-spec.md`).
 *
 * Layer 1: a module-level store keyed by composer context, so draft text
 * survives every in-app movement without touching the component tree.
 * Layer 2: a principal-scoped localStorage mirror (7-day lazy expiry,
 * cleared on logout) plus a `beforeunload` prompt while any non-empty
 * draft exists, so a reload or closed tab neither loses nor leaks text.
 */

const draftKeyPrefix = "draft:";
const draftLifetimeMilliseconds = 7 * 24 * 60 * 60 * 1_000;
const mirrorDebounceMilliseconds = 400;

/** One composer context: a reply targets a thread, a new thread a version. */
export interface DraftContext {
  readonly artifactId: string;
  readonly principalId: string;
  readonly threadId: string | null;
  readonly versionId: string | null;
}

export function draftKey(context: DraftContext): string {
  return draftKeyPrefix
    + `${context.principalId}:${context.artifactId}`
    + `:${context.threadId ?? "new"}:${context.versionId ?? "-"}`;
}

const draftAnchorSchema = z.object({
  anchor: z.json(),
  path: z.string(),
});

// The last attempt's idempotency key and the exact body it posted: a retry of
// the unchanged text reuses the key, so a save whose response was lost is not
// duplicated, even after the composer remounts or the page reloads.
const draftRetrySchema = z.object({body: z.string(), key: z.string()});
type DraftRetry = z.infer<typeof draftRetrySchema>;

/**
 * Where a new-thread draft was anchored in the document. A failed
 * in-document save keeps its anchor with the draft so a retry from the
 * sidebar composer still posts an anchored comment.
 */
export type DraftAnchor = z.infer<typeof draftAnchorSchema>;

const memory = new Map<string, string>();
const anchors = new Map<string, DraftAnchor>();
const retries = new Map<string, DraftRetry>();
const mirrorTimers = new Map<string, ReturnType<typeof setTimeout>>();

const storedDraftSchema = z.object({
  a: draftAnchorSchema.optional(),
  b: z.string(),
  r: draftRetrySchema.optional(),
  t: z.number(),
});
type StoredDraft = z.infer<typeof storedDraftSchema>;

function readMirror(key: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed = storedDraftSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || Date.now() - parsed.data.t > draftLifetimeMilliseconds) {
      window.localStorage.removeItem(key);
      return null;
    }
    return parsed.data;
  } catch {
    return null;
  }
}

function writeMirror(key: string, body: string): void {
  const stored: StoredDraft = {b: body, t: Date.now()};
  const anchor = anchors.get(key);
  if (anchor !== undefined) stored.a = anchor;
  const retry = retries.get(key);
  if (retry !== undefined) stored.r = retry;
  try {
    window.localStorage.setItem(key, JSON.stringify(stored));
  } catch {
    // A full or unavailable store never interrupts composing.
  }
}

function removeMirror(key: string): void {
  const timer = mirrorTimers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    mirrorTimers.delete(key);
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignored for the same reason as writes.
  }
}

/** The draft for one context: memory first, then the surviving mirror. */
export function readDraft(context: DraftContext): string {
  const key = draftKey(context);
  const held = memory.get(key);
  if (held !== undefined) return held;
  const mirrored = readMirror(key);
  if (mirrored === null) return "";
  memory.set(key, mirrored.b);
  if (mirrored.a !== undefined) anchors.set(key, mirrored.a);
  if (mirrored.r !== undefined) retries.set(key, mirrored.r);
  return mirrored.b;
}

/** The anchor a new-thread draft keeps from a failed in-document save. */
export function readDraftAnchor(context: DraftContext): DraftAnchor | null {
  readDraft(context);
  return anchors.get(draftKey(context)) ?? null;
}

/**
 * The idempotency key for posting `body` from this context: the last
 * attempt's key while the body is unchanged, otherwise a new key, kept with
 * the draft before the request leaves so a lost response cannot orphan it.
 */
export function draftAttemptKey(context: DraftContext, body: string): string {
  readDraft(context);
  const key = draftKey(context);
  const kept = retries.get(key);
  if (kept?.body === body) return kept.key;
  const attempt = {body, key: crypto.randomUUID()};
  retries.set(key, attempt);
  const held = memory.get(key);
  if (held !== undefined) writeMirror(key, held);
  return attempt.key;
}

/**
 * Keep a failed in-document comment as this context's draft, with its anchor
 * (when it had one) and the attempt's key for an unchanged retry.
 */
export function writeFailedDraft(
  context: DraftContext,
  body: string,
  {anchor, retry}: {
    readonly anchor: {readonly anchor: unknown; readonly path: string} | null;
    readonly retry: DraftRetry;
  },
): void {
  if (body.trim() === "") return;
  const key = draftKey(context);
  const parsed = draftAnchorSchema.safeParse(anchor);
  if (parsed.success) anchors.set(key, parsed.data);
  else anchors.delete(key);
  retries.set(key, retry);
  writeDraft(context, body);
}

export function writeDraft(context: DraftContext, body: string): void {
  const key = draftKey(context);
  const bounded = body.slice(0, maximumCommentBodyCharacters);
  if (bounded.trim() === "") {
    clearDraft(context);
    return;
  }
  memory.set(key, bounded);
  const pending = mirrorTimers.get(key);
  if (pending !== undefined) clearTimeout(pending);
  mirrorTimers.set(key, setTimeout(() => {
    mirrorTimers.delete(key);
    writeMirror(key, bounded);
  }, mirrorDebounceMilliseconds));
}

export function clearDraft(context: DraftContext): void {
  const key = draftKey(context);
  memory.delete(key);
  anchors.delete(key);
  retries.delete(key);
  removeMirror(key);
}

function hasNonEmptyDraft(): boolean {
  for (const body of memory.values()) {
    if (body.trim() !== "") return true;
  }
  return false;
}

/** Flush every pending mirror write synchronously (used before unload). */
function flushMirrors(): void {
  for (const [key, timer] of mirrorTimers) {
    clearTimeout(timer);
    const body = memory.get(key);
    if (body !== undefined) writeMirror(key, body);
  }
  mirrorTimers.clear();
}

let currentPrincipalId: string | null = null;

/** The signed-in principal whose drafts a logout purges; null clears it. */
export function setDraftPrincipal(principalId: string | null): void {
  currentPrincipalId = principalId;
}

/** Remove one principal's drafts everywhere; other principals' keys stay. */
function purgePrincipalDrafts(principalId: string): void {
  const prefix = `${draftKeyPrefix}${principalId}:`;
  // Deleting the current entry while iterating a Map is well-defined.
  for (const key of memory.keys()) {
    if (key.startsWith(prefix)) {
      memory.delete(key);
      anchors.delete(key);
      retries.delete(key);
      const timer = mirrorTimers.get(key);
      if (timer !== undefined) clearTimeout(timer);
      mirrorTimers.delete(key);
    }
  }
  try {
    const doomed: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key !== null && key.startsWith(prefix)) doomed.push(key);
    }
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    // An unavailable store has nothing to purge.
  }
}

/**
 * App-global guard: prompt before the tab closes over a non-empty draft
 * (mirrors are flushed first, so an accepted reload still restores), and
 * purge the departing principal's drafts when the session logs out.
 */
export function installDraftGuard(): () => void {
  const beforeUnload = (event: BeforeUnloadEvent): void => {
    if (!hasNonEmptyDraft()) return;
    flushMirrors();
    event.preventDefault();
    // Safari and older Firefox key the prompt off returnValue, not the default.
    event.returnValue = "";
  };
  const onLogout = (): void => {
    if (currentPrincipalId !== null) purgePrincipalDrafts(currentPrincipalId);
    currentPrincipalId = null;
  };
  window.addEventListener("beforeunload", beforeUnload);
  window.addEventListener("artifact-session-logout", onLogout);
  return () => {
    window.removeEventListener("beforeunload", beforeUnload);
    window.removeEventListener("artifact-session-logout", onLogout);
  };
}

export interface CommentDraft {
  /** The key for posting this body: reused while an unchanged retry. */
  readonly attemptKey: (body: string) => string;
  readonly initialBody: string;
  readonly onBodyChange: (body: string) => void;
  readonly onDiscard: () => void;
  readonly onPosted: () => void;
  readonly restored: boolean;
}

/** Wire one composer context to the draft store. */
export function useCommentDraft(context: DraftContext): CommentDraft {
  const contextRef = useRef(context);
  contextRef.current = context;
  const [initialBody] = useState(() => readDraft(context));
  const onBodyChange = useCallback((body: string) => {
    writeDraft(contextRef.current, body);
  }, []);
  const onPosted = useCallback(() => {
    clearDraft(contextRef.current);
  }, []);
  const attemptKey = useCallback(
    (body: string) => draftAttemptKey(contextRef.current, body),
    [],
  );
  useEffect(() => () => {
    // Unmounting mid-debounce must not lose the mirror write.
    const key = draftKey(contextRef.current);
    const timer = mirrorTimers.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      mirrorTimers.delete(key);
      const body = memory.get(key);
      if (body !== undefined) writeMirror(key, body);
    }
  }, []);
  return useMemo(() => ({
    attemptKey,
    initialBody,
    onBodyChange,
    onDiscard: onPosted,
    onPosted,
    restored: initialBody.trim() !== "",
  }), [attemptKey, initialBody, onBodyChange, onPosted]);
}
