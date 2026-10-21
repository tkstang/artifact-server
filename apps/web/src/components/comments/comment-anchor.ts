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
