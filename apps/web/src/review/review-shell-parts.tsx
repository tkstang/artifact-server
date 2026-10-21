import {useId, useState} from "react";
import {
  Download04Icon,
  Edit02Icon,
  ExternalLinkIcon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import {HugeiconsIcon} from "@hugeicons/react";
import {Menu} from "@base-ui/react/menu";

import type {ArtifactComparison} from "@/api/client";

/*
 * Self-contained presentational parts of the review shell. They take
 * everything through props, so the controller in review-app.tsx stays
 * focused on state.
 */

export interface ReviewDownload {
  readonly href: string;
  readonly title: string;
}

const commentingModeDescription = "Click an element or select text to comment. Press Escape to read.";
const readingModeDescription = "Links and controls work normally. Select text, or turn commenting back on, to comment.";

/**
 * Switch between commenting on the document and using it. The visible label
 * says what the reader is doing and is the accessible name, even where a
 * narrow header hides it; the longer instructions are its description.
 */
export function AnnotateModeToggle({
  active,
  className,
  onToggle,
}: {
  readonly active: boolean;
  readonly className: string;
  readonly onToggle: () => void;
}) {
  const id = useId();
  const description = active ? commentingModeDescription : readingModeDescription;
  return (
    <button
      aria-describedby={`${id}-description`}
      aria-labelledby={`${id}-label`}
      aria-pressed={active}
      className={className}
      data-active={active}
      onClick={onToggle}
      title={description}
      type="button"
    >
      <HugeiconsIcon aria-hidden="true" icon={Edit02Icon} strokeWidth={1.8} />
      <span className="as-button__label" id={`${id}-label`}>
        {active ? "Commenting" : "Reading"}
      </span>
      <span className="as-visually-hidden" id={`${id}-description`}>{description}</span>
    </button>
  );
}

/** Secondary document actions that do not need a permanent place in the header. */
export function ReviewMoreActions({
  download,
  onOpenRawArtifact,
  opening,
  rawDisabled,
}: {
  readonly download: ReviewDownload | null;
  readonly onOpenRawArtifact: () => void;
  readonly opening: boolean;
  readonly rawDisabled: boolean;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={(
          <button
            aria-label="More actions"
            className="as-icon-button"
            title="More actions"
            type="button"
          />
        )}
      >
        <HugeiconsIcon aria-hidden="true" icon={MoreHorizontalIcon} strokeWidth={1.8} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" className="as-more-actions__positioner" sideOffset={6}>
          <Menu.Popup className="as-more-actions">
            <Menu.Item
              className="as-more-actions__item"
              disabled={rawDisabled || opening}
              label="Open raw artifact"
              onClick={onOpenRawArtifact}
            >
              <HugeiconsIcon aria-hidden="true" icon={ExternalLinkIcon} strokeWidth={1.8} />
              {opening ? "Opening…" : "Open raw artifact"}
            </Menu.Item>
            {download === null ? (
              <Menu.Item className="as-more-actions__item" disabled label="Download">
                <HugeiconsIcon aria-hidden="true" icon={Download04Icon} strokeWidth={1.8} />
                Download
              </Menu.Item>
            ) : (
              <Menu.LinkItem
                className="as-more-actions__item"
                closeOnClick
                download
                href={download.href}
                label="Download"
                title={download.title}
              >
                <HugeiconsIcon aria-hidden="true" icon={Download04Icon} strokeWidth={1.8} />
                Download
              </Menu.LinkItem>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** At most this many lines of each side of a change region are drawn. */
const comparedLineLimit = 40;

/** One changed file: its changed lines before and after, or why they are not shown. */
export function ComparedFileChange({
  file,
  fromNumber,
  toNumber,
}: {
  readonly file: ArtifactComparison["changed"][number];
  readonly fromNumber: number;
  readonly toNumber: number;
}) {
  const {detail} = file;
  return (
    <article className="as-compare-file">
      <header>
        <code>{file.after.path}</code>
      </header>
      {detail.kind === "binary" ? (
        <p className="as-inspector-empty">
          {detail.reason === "text_limit_exceeded"
            ? "Too large to compare line by line."
            : "Not a text file, so its lines cannot be compared."}
        </p>
      ) : detail.change === null ? (
        <p className="as-inspector-empty">The lines are the same; only the file's details changed.</p>
      ) : (
        <>
          <ComparedLines
            label={`Version ${fromNumber}`}
            lines={detail.change.before}
            side="before"
            startLine={detail.change.beforeStartLine}
          />
          <ComparedLines
            label={`Version ${toNumber}`}
            lines={detail.change.after}
            side="after"
            startLine={detail.change.afterStartLine}
          />
        </>
      )}
    </article>
  );
}

function ComparedLines({
  label,
  lines,
  side,
  startLine,
}: {
  readonly label: string;
  readonly lines: readonly string[];
  readonly side: "after" | "before";
  readonly startLine: number;
}) {
  const headingId = useId();
  const shown = lines.slice(0, comparedLineLimit);
  const lineRange = lines.length === 0
    ? `nothing at line ${startLine}`
    : lines.length === 1
      ? `line ${startLine}`
      : `lines ${startLine}–${startLine + lines.length - 1}`;
  return (
    <section aria-labelledby={headingId} className="as-compare-lines" data-side={side}>
      <h3 id={headingId}>
        {side === "before" ? "Before" : "After"} · {label}, {lineRange}
      </h3>
      {shown.length === 0 ? null : (
        <ol start={startLine}>
          {shown.map((line, index) => (
            <li key={`${startLine + index}`}><code>{line === "" ? "\u00a0" : line}</code></li>
          ))}
        </ol>
      )}
      {lines.length > shown.length ? (
        <p className="as-inspector-empty">
          {lines.length - shown.length} more line{lines.length - shown.length === 1 ? "" : "s"} not shown.
        </p>
      ) : null}
    </section>
  );
}

/** The one empty state of a project with nothing published: how to publish here. */
export function EmptyProjectState({projectId}: {readonly projectId: string}) {
  const command = `artifactserver publish report.html --project ${projectId}`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="as-catalog-empty" role="status">
      <strong>No artifacts yet</strong>
      <p>Publish a file or a finished folder from your terminal:</p>
      <div className="as-catalog-empty__command">
        <code>{command}</code>
        <button
          className="as-button as-button--secondary"
          onClick={() => {
            void navigator.clipboard.writeText(command).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
          type="button"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p>
        Or connect an agent in <a href="/review/settings/mcp">Settings → MCP</a> and
        ask it to publish here.
      </p>
    </div>
  );
}
