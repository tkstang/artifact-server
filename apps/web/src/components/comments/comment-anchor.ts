import type {CommentThread} from "@/api/client";
import {reviewAnchorSchema, type ReviewAnchor} from "@/review-frame/protocol";

/**
 * The document position a thread was written against, or null for a general
 * (whole-version) comment. Only an anchor this client can place counts: a
 * `{kind: "page"}` anchor or no anchor at all means the comment is about the
 * version as a whole, never a location that failed to restore.
 */
export function documentAnchorOf(thread: CommentThread): ReviewAnchor | null {
  const parsed = reviewAnchorSchema.safeParse(thread.anchor);
  if (!parsed.success) return null;
  const anchor = parsed.data;
  const placeable = anchor.htmlAnchor !== null
    || anchor.markdownSource !== undefined
    || anchor.originalText.trim() !== "";
  return placeable ? anchor : null;
}

/** The passage an anchored comment is about, as the reader selected it. */
export function quotedPassage(anchor: ReviewAnchor): string {
  const text = anchor.originalText.trim()
    || anchor.htmlAnchor?.text?.trim()
    || anchor.markdownSource?.sourceText.trim()
    || "";
  return text.replaceAll(/\s+/gu, " ");
}

/**
 * Reading order for a list of open comments: anchored comments first, by
 * Markdown source line where the anchor records one, then by when they were
 * written; general comments after them, newest first as the server lists
 * them. Only the display order changes; counts and sends use the full set.
 */
export function inDocumentOrder(
  threads: readonly CommentThread[],
): readonly CommentThread[] {
  const keyed = threads.map((thread, index) => {
    const anchor = documentAnchorOf(thread);
    return {
      anchored: anchor !== null,
      index,
      line: anchor?.markdownSource?.startLine ?? Number.POSITIVE_INFINITY,
      thread,
    };
  });
  return keyed
    .toSorted((left, right) => {
      if (left.anchored !== right.anchored) return left.anchored ? -1 : 1;
      if (!left.anchored) return left.index - right.index;
      return left.line - right.line
        || left.thread.createdAt.localeCompare(right.thread.createdAt)
        || left.index - right.index;
    })
    .map(({thread}) => thread);
}
