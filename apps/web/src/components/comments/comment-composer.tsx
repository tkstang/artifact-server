import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/**
 * Bounded comment body editor.
 *
 * One mounted composer is one compose attempt: its idempotency key is minted
 * on the first submission and reused for every retry until the server accepts
 * the text, so a retried create can never duplicate a comment. A drafted
 * composer takes its key from the draft instead, which outlives a remount.
 *
 * Every composer speaks the same way: an "Add a comment…" style prompt and
 * Cmd/Ctrl+Enter to submit. A collapsible one rests as a one-line field and
 * opens on focus, so it does not push the conversation below the fold.
 */
export function CommentComposer({
  cancelLabel,
  collapsible = false,
  draftRestored = false,
  idempotencyKeyFor,
  initialBody,
  inputId,
  label,
  maximumCharacters,
  onBodyChange,
  onCancel,
  onDiscardDraft,
  onSubmit,
  placeholder = "Add a comment…",
  submitLabel,
}: {
  readonly cancelLabel: string | null;
  /** Rest as a one-line field until focused or holding text. */
  readonly collapsible?: boolean;
  /** True when `initialBody` came out of the draft store, not the caller. */
  readonly draftRestored?: boolean;
  /** The key for posting this exact body, when a draft keeps attempts. */
  readonly idempotencyKeyFor?: (body: string) => string;
  readonly initialBody: string;
  readonly inputId: string;
  readonly label: string;
  readonly maximumCharacters: number;
  /** Draft wiring: hears every edit, including the clearing submit/discard. */
  readonly onBodyChange?: (body: string) => void;
  readonly onCancel: (() => void) | null;
  readonly onDiscardDraft?: () => void;
  readonly onSubmit: (body: string, idempotencyKey: string) => Promise<boolean>;
  readonly placeholder?: string;
  readonly submitLabel: string;
}) {
  const [body, setBody] = useState(initialBody);
  const [pending, setPending] = useState(false);
  const [focused, setFocused] = useState(false);
  const attemptKey = useRef<string | null>(null);
  const trimmed = body.trim();
  const tooLong = trimmed.length > maximumCharacters;
  const collapsed = collapsible && !focused && !pending && body === "";

  const submit = async () => {
    if (trimmed === "" || tooLong) return;
    const key = idempotencyKeyFor === undefined
      ? (attemptKey.current ??= crypto.randomUUID())
      : idempotencyKeyFor(trimmed);
    setPending(true);
    const accepted = await onSubmit(trimmed, key);
    setPending(false);
    if (!accepted) return;
    attemptKey.current = null;
    setBody("");
    onBodyChange?.("");
  };

  const discardDraft = () => {
    setBody("");
    onDiscardDraft?.();
  };

  return (
    <div
      className="as-comment-composer grid gap-2"
      data-collapsed={collapsible ? String(collapsed) : undefined}
    >
      <div className="as-comment-composer__header flex items-baseline justify-between gap-2">
        <Label className="as-comment-composer__label" htmlFor={inputId}>
          {label}
        </Label>
        {draftRestored && trimmed !== "" ? (
          <span className="flex items-baseline gap-2">
            <span className="text-xs text-muted-foreground" data-draft-marker>
              Draft
            </span>
            {onDiscardDraft === undefined ? null : (
              <button
                className="text-xs text-muted-foreground underline"
                onClick={discardDraft}
                type="button"
              >
                Discard
              </button>
            )}
          </span>
        ) : null}
      </div>
      <Textarea
        aria-describedby={tooLong ? `${inputId}-limit` : undefined}
        aria-invalid={tooLong}
        className="as-comment-composer__input"
        disabled={pending}
        aria-keyshortcuts="Meta+Enter Control+Enter"
        id={inputId}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          setBody(event.currentTarget.value);
          onBodyChange?.(event.currentTarget.value);
        }}
        onFocus={() => setFocused(true)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
          event.preventDefault();
          void submit();
        }}
        placeholder={placeholder}
        rows={collapsed ? 1 : undefined}
        value={body}
      />
      {tooLong
        ? (
          <p className="text-xs text-destructive" id={`${inputId}-limit`}>
            {`A comment holds at most ${maximumCharacters} characters. Remove ${
              trimmed.length - maximumCharacters
            }.`}
          </p>
        )
        : null}
      {collapsed ? null : (
        <div className="as-comment-composer__actions flex flex-wrap gap-2">
          <Button
            disabled={pending || trimmed === "" || tooLong}
            onClick={() => void submit()}
            size="xs"
            type="button"
          >
            {pending ? "Saving…" : submitLabel}
          </Button>
          {onCancel === null || cancelLabel === null
            ? null
            : (
              <Button
                disabled={pending}
                onClick={onCancel}
                size="xs"
                type="button"
                variant="ghost"
              >
                {cancelLabel}
              </Button>
            )}
        </div>
      )}
    </div>
  );
}
