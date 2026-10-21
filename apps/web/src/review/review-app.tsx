import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  ArrowShrinkIcon,
  BookOpen01Icon,
  Cancel01Icon,
  Comment01Icon,
  Download04Icon,
  Edit02Icon,
  ExternalLinkIcon,
  File01Icon,
  FilterIcon,
  FullScreenIcon,
  GithubIcon,
  Home01Icon,
  KeyboardIcon,
  LayoutLeftIcon,
  Moon02Icon,
  MoreHorizontalIcon,
  PanelRightIcon,
  RefreshIcon,
  Search01Icon,
  Settings02Icon,
  Sun03Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {Dialog} from "@base-ui/react/dialog";
import {Menu} from "@base-ui/react/menu";
import {Popover} from "@base-ui/react/popover";
import {motion} from "motion/react";

import {
  readDraftAnchor,
  setDraftPrincipal,
  writeFailedDraft,
  type DraftContext,
} from "@/components/comments/comment-drafts";
import {useCommentPoll} from "@/components/comments/comment-poll";
import {
  api,
  ApiError,
  type AccessContext,
  type ArtifactAction,
  type ArtifactComparison,
  type ArtifactDetails,
  type ArtifactPage,
  type ArtifactVersion,
  type Project,
  type Session,
  type Version,
} from "@/api/client";
import {
  actionLabel,
  failureMessage,
  formatBytes,
  formatRelativeTime,
  formatTimestamp,
  sourceDriftDescription,
  sourceFreshnessLabel,
  versionLabel,
} from "@/lib/presentation";
import {useHorizontalOverflow} from "@/lib/use-horizontal-overflow";
import {reviewAnchorSchema} from "@/review-frame/protocol";
import artifactServerAnimationUrl from "./assets/artifact-server.svg";
import {ArtifactMark} from "./artifact-mark.tsx";
import {
  useReviewComments,
  ReviewCommentsInspector,
  type ReviewCommentsInspectorHandle,
} from "./review-comments.tsx";
import { ReviewPreview } from "./review-preview.tsx";
import {ReviewProjectPicker} from "./review-project-picker.tsx";
import {isSettingsPath} from "./review-routes.ts";
import {ReviewSettings} from "./review-settings.tsx";
import {ReviewPanelEdge} from "./review-panel-edge.tsx";
import {AgentLogos, ReviewShareControl} from "./review-share.tsx";
import {useReviewPanelMotion} from "./use-review-panel-motion.ts";
import {useReviewResizablePanel} from "./use-review-resizable-panel.ts";
import {useWebmcp, type WebmcpBindings} from "./webmcp.tsx";

export type ReviewTheme = "dawn" | "moon";
type InspectorTab = "activity" | "comments" | "compare" | "details" | "files" | "versions";
/** Inspector tabs in visual order; Compare joins the end when a comparison exists. */
const inspectorTabOrder: readonly InspectorTab[] = [
  "comments",
  "details",
  "files",
  "versions",
  "activity",
];
type ArtifactListLoadResult = "failed" | "loaded" | "skipped";
type CatalogCommentFilter = "all" | "with" | "without";
type CatalogRefreshState = "complete" | "idle" | "loading";
type CatalogSort = "comments" | "newest";
const catalogDefaultWidth = 336;
const catalogMinimumWidth = 240;
const catalogMaximumWidth = 520;
const inspectorDefaultWidth = 352;
const inspectorMinimumWidth = 240;
const inspectorMaximumWidth = 480;
const inspectorGapPixels = 12;
const catalogRefreshConfirmationMilliseconds = 1_600;
// Below these widths the panel overlays the artifact instead of sitting beside it
// (review.css keeps the matching media queries).
const catalogOverlayQuery = "(max-width: 720px)";
const inspectorOverlayQuery = "(max-width: 1180px)";

function reviewShortcutBlocked(event: KeyboardEvent): boolean {
  // Escape closes layers from anywhere except fields and open popups; letter
  // and arrow shortcuts also stay out of composite widgets that use them.
  const escape = event.key === "Escape";
  if (
    event.defaultPrevented
    || event.isComposing
    || event.altKey
    || event.ctrlKey
    || event.metaKey
    || event.shiftKey
  ) {
    return true;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest([
    "input",
    "textarea",
    "select",
    "[contenteditable]:not([contenteditable='false'])",
    "[role='dialog']",
    "[role='listbox']",
    "[role='menu']",
    ...escape ? [] : ["[role='radiogroup']", "[role='slider']", "[role='tablist']"],
  ].join(", "))) {
    return true;
  }

  return document.querySelector([
    ".as-catalog-filter-popover[data-open]",
    "[data-slot='popover-content'][data-open]",
    "[role='dialog'][data-open]",
    "[role='listbox'][data-open]",
    "[role='menu'][data-open]",
  ].join(", ")) !== null;
}

/** A catalog row; the comment total is unknown for an artifact outside the loaded pages. */
type CatalogItem = Omit<ArtifactPage["artifacts"][number], "commentCount"> & {
  readonly commentCount: number | null;
};

interface VersionListItem {
  readonly links: {readonly review: string; readonly version: string};
  readonly version: Version;
}

interface ReviewDownload {
  readonly href: string;
  readonly title: string;
}

interface ReviewLocation {
  readonly artifactId: string | null;
  readonly path: string | null;
  readonly projectId: string | null;
  readonly versionId: string | null;
  readonly view: "focus" | null;
}

function CatalogFilters({
  commentFilter,
  knownTags,
  onCommentFilterChange,
  onTagFiltersChange,
  tagFilters,
}: {
  readonly commentFilter: CatalogCommentFilter;
  readonly knownTags: readonly string[];
  readonly onCommentFilterChange: (filter: CatalogCommentFilter) => void;
  readonly onTagFiltersChange: (tags: readonly string[]) => void;
  readonly tagFilters: readonly string[];
}) {
  const activeFilterCount = Number(commentFilter !== "all") + tagFilters.length;
  let triggerLabel = "All artifacts";
  if (commentFilter === "all" && tagFilters.length === 1) {
    triggerLabel = tagFilters[0] ?? "1 tag";
  } else if (commentFilter === "all" && tagFilters.length > 1) {
    triggerLabel = `${tagFilters.length} tags`;
  } else if (commentFilter === "with" && tagFilters.length === 0) {
    triggerLabel = "With comments";
  } else if (commentFilter === "without" && tagFilters.length === 0) {
    triggerLabel = "No comments";
  } else if (activeFilterCount > 0) {
    triggerLabel = `${activeFilterCount} filters`;
  }
  const tags = [...new Set([...knownTags, ...tagFilters])].toSorted();
  const toggleTag = (tag: string): void => {
    onTagFiltersChange(
      tagFilters.includes(tag)
        ? tagFilters.filter((selected) => selected !== tag)
        : [...tagFilters, tag].toSorted(),
    );
  };

  return (
    <Popover.Root>
      <Popover.Trigger
        render={(
          <button
            aria-label={`Filter artifacts. ${activeFilterCount === 0 ? "No filters applied" : `${activeFilterCount} applied`}.`}
            className="as-catalog-filter-trigger"
            type="button"
          />
        )}
      >
        <HugeiconsIcon aria-hidden="true" icon={FilterIcon} strokeWidth={1.8} />
        <span>{triggerLabel}</span>
        {activeFilterCount === 0 ? null : (
          <span aria-hidden="true" className="as-catalog-filter-trigger__count">
            {activeFilterCount}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="start"
          className="as-catalog-filter-positioner"
          sideOffset={6}
        >
          <Popover.Popup aria-label="Filter artifacts" className="as-catalog-filter-popover">
            {activeFilterCount === 0 ? null : (
              <div className="as-catalog-filter-popover__actions">
                <button
                  className="as-catalog-filter-popover__clear"
                  onClick={() => {
                    onCommentFilterChange("all");
                    onTagFiltersChange([]);
                  }}
                  type="button"
                >
                  Clear filters
                </button>
              </div>
            )}
            <fieldset>
              <legend>Comments</legend>
              {([
                ["all", "All artifacts"],
                ["with", "With comments"],
                ["without", "No comments"],
              ] as const).map(([value, label]) => (
                <label className="as-catalog-filter-option" data-selected={commentFilter === value} key={value}>
                  <input
                    checked={commentFilter === value}
                    name="catalog-comment-filter"
                    onChange={() => onCommentFilterChange(value)}
                    type="radio"
                    value={value}
                  />
                  <span>{label}</span>
                  {commentFilter === value ? (
                    <HugeiconsIcon aria-hidden="true" icon={Tick02Icon} strokeWidth={2} />
                  ) : null}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Tags</legend>
              <button
                aria-pressed={tagFilters.length === 0}
                className="as-catalog-filter-option"
                data-selected={tagFilters.length === 0}
                onClick={() => onTagFiltersChange([])}
                type="button"
              >
                <span>Any tag</span>
                {tagFilters.length === 0 ? (
                  <HugeiconsIcon aria-hidden="true" icon={Tick02Icon} strokeWidth={2} />
                ) : null}
              </button>
              {tags.length === 0 ? (
                <p className="as-catalog-filter-popover__empty">No tags in the loaded catalog.</p>
              ) : tags.map((tag) => (
                <label className="as-catalog-filter-option" data-selected={tagFilters.includes(tag)} key={tag}>
                  <input
                    checked={tagFilters.includes(tag)}
                    name="catalog-tag-filter"
                    onChange={() => toggleTag(tag)}
                    type="checkbox"
                    value={tag}
                  />
                  <span>{tag}</span>
                  {tagFilters.includes(tag) ? (
                    <HugeiconsIcon aria-hidden="true" icon={Tick02Icon} strokeWidth={2} />
                  ) : null}
                </label>
              ))}
            </fieldset>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ReviewKeyboardShortcuts() {
  return (
    <Popover.Root>
      <Popover.Trigger
        render={(
          <button
            aria-label="Keyboard shortcuts"
            className="as-keyboard-shortcuts__trigger"
            title="Keyboard shortcuts"
            type="button"
          />
        )}
      >
        <HugeiconsIcon aria-hidden="true" icon={KeyboardIcon} strokeWidth={1.8} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="end"
          className="as-keyboard-shortcuts__positioner"
          side="top"
          sideOffset={8}
        >
          <Popover.Popup className="as-keyboard-shortcuts">
            <Popover.Title className="as-keyboard-shortcuts__title">
              Keyboard shortcuts
            </Popover.Title>
            <section aria-labelledby="review-shortcuts-navigation">
              <h3 id="review-shortcuts-navigation">Navigate</h3>
              <dl>
                <div>
                  <dt>Previous artifact</dt>
                  <dd><kbd>K</kbd><span>or</span><kbd>↑</kbd></dd>
                </div>
                <div>
                  <dt>Next artifact</dt>
                  <dd><kbd>J</kbd><span>or</span><kbd>↓</kbd></dd>
                </div>
              </dl>
            </section>
            <section aria-labelledby="review-shortcuts-layout">
              <h3 id="review-shortcuts-layout">Layout</h3>
              <dl>
                <div>
                  <dt>Artifact catalog</dt>
                  <dd><kbd>[</kbd></dd>
                </div>
                <div>
                  <dt>Inspector or comments</dt>
                  <dd><kbd>]</kbd></dd>
                </div>
                <div>
                  <dt>Full screen</dt>
                  <dd><kbd>F</kbd></dd>
                </div>
                <div>
                  <dt>Back or close current layer</dt>
                  <dd><kbd>Esc</kbd></dd>
                </div>
                <div>
                  <dt>Reveal hidden viewer controls</dt>
                  <dd><kbd>⌘ / Ctrl</kbd><span>+</span><kbd>\</kbd></dd>
                </div>
              </dl>
            </section>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Start the artifact-first Artifact Server review application. */
export function ReviewApp() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    setDraftPrincipal(session?.principal.id ?? null);
  }, [session]);
  const accessContextRef = useRef<AccessContext | null>(null);
  const bootstrapInFlightRef = useRef(false);
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [sessionState, setSessionState] = useState<
    "loading" | "ready" | "unauthenticated"
  >("loading");
  const [error, setError] = useState<Error | null>(null);
  const [theme, setTheme] = useState<ReviewTheme>(initialReviewTheme);

  const bootstrap = useCallback(async (): Promise<void> => {
    if (bootstrapInFlightRef.current) return;
    bootstrapInFlightRef.current = true;
    setSessionState("loading");
    setError(null);
    try {
      const [loadedAccessContext, initialSession] = await Promise.all([
        api.accessContext(),
        api.session().then(
          (value) => ({kind: "authenticated" as const, value}),
          (cause: unknown) => ({cause, kind: "failed" as const}),
        ),
      ]);
      accessContextRef.current = loadedAccessContext;
      let loadedSession: Session;
      if (initialSession.kind === "authenticated") {
        loadedSession = initialSession.value;
      } else if (
        loadedAccessContext.accessMode === "local_owner"
        && initialSession.cause instanceof ApiError
        && initialSession.cause.status === 401
      ) {
        await api.localOwnerSession();
        loadedSession = await api.session();
      } else {
        throw initialSession.cause;
      }
      const loadedProjects = await api.projects();
      setSession(loadedSession);
      setProjects(loadedProjects);
      setSessionState("ready");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setSession(null);
        setSessionState("unauthenticated");
      } else {
        setError(
          caught instanceof Error
            ? caught
            : new Error("Artifact Server could not start."),
        );
        setSessionState("ready");
      }
    } finally {
      bootstrapInFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    void bootstrap();
    const expire = (): void => {
      if (accessContextRef.current?.accessMode === "local_owner") {
        void bootstrap();
        return;
      }
      setSession(null);
      setSessionState("unauthenticated");
    };
    window.addEventListener("artifact-session-expired", expire);
    return () => window.removeEventListener("artifact-session-expired", expire);
  }, [bootstrap]);

  useEffect(() => {
    document.documentElement.dataset["reviewTheme"] = theme;
    document.documentElement.classList.toggle("dark", theme === "moon");
    window.localStorage.setItem("artifact-review-theme", theme);
  }, [theme]);

  const createProject = useCallback(async (name: string): Promise<Project> => {
    const created = await api.createProject(name);
    setProjects((current) => [
      ...current.filter((project) => project.id !== created.id),
      created,
    ]);
    return created;
  }, []);
  const loadProjects = useCallback(async (): Promise<readonly Project[]> => {
    const loaded = await api.projects();
    setProjects(loaded);
    return loaded;
  }, []);

  if (sessionState === "loading") {
    return <ReviewGate description="Opening the local artifact catalog." title="Loading Artifact Server" />;
  }
  if (sessionState === "unauthenticated") {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    return (
      <ReviewGate
        action={(
          <a className="as-button as-button--primary" href={`/auth/login?returnTo=${encodeURIComponent(returnTo)}`}>
            Sign in
          </a>
        )}
        description="This installation requires an authenticated browser session."
        title="Sign in required"
      />
    );
  }
  if (error !== null) {
    return (
      <ReviewGate
        action={<button className="as-button" onClick={() => void bootstrap()} type="button">Try again</button>}
        description={failureMessage(error)}
        title="Artifact Server unavailable"
      />
    );
  }
  if (session === null) return null;

  if (isSettingsPath(window.location.pathname)) {
    return (
      <ReviewSettings
        onProjectsChanged={loadProjects}
        onThemeChange={() => setTheme((current) => current === "moon" ? "dawn" : "moon")}
        projects={projects}
        session={session}
        theme={theme}
      />
    );
  }

  return (
    <ArtifactReview
      onCreateProject={createProject}
      onThemeChange={() => setTheme((current) => current === "moon" ? "dawn" : "moon")}
      projects={projects}
      session={session}
      theme={theme}
    />
  );
}

function ArtifactReview({
  onCreateProject,
  onThemeChange,
  projects,
  session,
  theme,
}: {
  readonly onCreateProject: (name: string) => Promise<Project>;
  readonly onThemeChange: () => void;
  readonly projects: readonly Project[];
  readonly session: Session;
  readonly theme: ReviewTheme;
}) {
  const initialLocation = useMemo(readReviewLocation, []);
  const initialProjectId = initialLocation.projectId
    ?? projects.find((project) => project.archivedAt === null)?.id
    ?? projects[0]?.id
    ?? "";
  const [projectId, setProjectId] = useState(initialProjectId);
  const [items, setItems] = useState<ArtifactPage["artifacts"]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(
    initialLocation.artifactId,
  );
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    initialLocation.versionId,
  );
  const [selectedPath, setSelectedPath] = useState<string | null>(
    initialLocation.path,
  );
  const [query, setQuery] = useState("");
  const searchQuery = useDeferredValue(query.trim());
  const [catalogCommentFilter, setCatalogCommentFilter] = useState<CatalogCommentFilter>("all");
  const [catalogTagFilters, setCatalogTagFilters] = useState<readonly string[]>([]);
  const [catalogKnownTags, setCatalogKnownTags] = useState<readonly string[]>([]);
  const [catalogSort, setCatalogSort] = useState<CatalogSort>("newest");
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<Error | null>(null);
  const [catalogRefreshState, setCatalogRefreshState] = useState<CatalogRefreshState>(
    "idle",
  );
  const [details, setDetails] = useState<ArtifactDetails | null>(null);
  const [versions, setVersions] = useState<readonly VersionListItem[]>([]);
  const [actions, setActions] = useState<readonly ArtifactAction[]>([]);
  const [actionNextCursor, setActionNextCursor] = useState<string | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState<Error | null>(null);
  const [comparison, setComparison] = useState<ArtifactComparison | null>(null);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState<Error | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<ArtifactVersion | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<Error | null>(null);
  // The workspace opens on the conversation; Details is one tab away.
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("comments");
  const [catalogOpen, setCatalogOpen] = useState(() => readInitialCatalogOpen(initialLocation));
  const [inspectorOpen, setInspectorOpen] = useState(readInitialInspectorOpen);
  const [opening, setOpening] = useState(false);
  const [focusMode, setFocusMode] = useState(initialLocation.view === "focus");
  const [focusCommentsOpen, setFocusCommentsOpen] = useState(false);
  const [focusControlsCollapsed, setFocusControlsCollapsed] = useState(false);
  const [focusControlsHoverArmed, setFocusControlsHoverArmed] = useState(true);
  const [focusControlsInstant, setFocusControlsInstant] = useState(false);
  const [htmlAnnotateModeActive, setHtmlAnnotateModeActive] = useState(true);
  const [homeOpen, setHomeOpen] = useState(false);
  const [previewRetryToken, setPreviewRetryToken] = useState(0);
  // Remounts the comments panel so a draft restored from a failed
  // in-document save appears in its composer.
  const [restoredDraftGeneration, setRestoredDraftGeneration] = useState(0);
  const focusCommentsButtonRef = useRef<HTMLButtonElement>(null);
  const openCatalogButtonRef = useRef<HTMLButtonElement>(null);
  const openInspectorButtonRef = useRef<HTMLButtonElement>(null);
  // The panel Escape just closed while it held focus; once it has closed,
  // focus returns to the control that reopens it instead of the page body.
  const returnFocusFromRef = useRef<"catalog" | "focus-comments" | "inspector" | null>(null);
  const inspectorTabListRef = useRef<HTMLDivElement>(null);
  const focusControlsRestoreRef = useRef<HTMLButtonElement>(null);
  const previewPanelRef = useRef<HTMLElement>(null);
  const commentsInspectorRef = useRef<ReviewCommentsInspectorHandle>(null);
  const catalogRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const catalogRequestGenerationRef = useRef(0);
  const catalogWidthApplyRef = useRef<(width: number) => void>(() => undefined);
  const inspectorWidthApplyRef = useRef<(width: number) => void>(() => undefined);
  const catalogResize = useReviewResizablePanel({
    apply: (width) => catalogWidthApplyRef.current(width),
    defaultWidth: catalogDefaultWidth,
    maxWidth: catalogMaximumWidth,
    minWidth: catalogMinimumWidth,
    onClick: () => setCatalogOpen(false),
    onSnapClose: () => setCatalogOpen(false),
    onSnapOpen: () => setCatalogOpen(true),
    side: "left",
    storageKey: "artifact-review-catalog-width",
  });
  const inspectorResize = useReviewResizablePanel({
    apply: (width) => inspectorWidthApplyRef.current(width),
    defaultWidth: inspectorDefaultWidth,
    maxWidth: inspectorMaximumWidth,
    minWidth: inspectorMinimumWidth,
    onClick: () => setInspectorOpen(false),
    onSnapClose: () => setInspectorOpen(false),
    onSnapOpen: () => setInspectorOpen(true),
    side: "right",
    storageKey: "artifact-review-inspector-width",
  });
  const catalogMotion = useReviewPanelMotion(catalogOpen, catalogResize.width);
  const inspectorMotion = useReviewPanelMotion(
    inspectorOpen,
    inspectorResize.width,
    inspectorGapPixels,
  );
  const inspectorTabOverflow = useHorizontalOverflow(
    inspectorTabListRef,
    `${inspectorMotion.mounted}:${comparison === null ? "" : "compare"}`,
  );
  useEffect(() => {
    // Clearing a comparison removes its tab; select one that still exists so
    // the tab list keeps a focusable tab and the panel keeps its label.
    if (comparison === null) {
      setInspectorTab((tab) => tab === "compare" ? "comments" : tab);
    }
  }, [comparison]);
  useEffect(() => {
    // Keep the selected tab in view when the strip scrolls.
    inspectorTabListRef.current
      ?.querySelector<HTMLElement>(`#review-inspector-tab-${inspectorTab}`)
      ?.scrollIntoView({block: "nearest", inline: "nearest"});
  }, [inspectorMotion.mounted, inspectorTab]);
  useEffect(() => {
    catalogWidthApplyRef.current = (width) => catalogMotion.width.set(width);
    inspectorWidthApplyRef.current = (width) => inspectorMotion.width.set(width);
  }, [catalogMotion.width, inspectorMotion.width]);
  const followCommentVersion = useCallback((versionId: string): void => {
    setDetailError(null);
    setSelectedVersionId(versionId);
    setSelectedPath(null);
  }, []);
  const comments = useReviewComments({
    artifactId: selectedArtifactId,
    onVersionChanged: followCommentVersion,
    projectId,
    versionId: selectedVersionId,
  });
  useEffect(() => {
    if (details === null || details.artifact.tags.length === 0) return;
    setCatalogKnownTags((current) => [
      ...new Set([...current, ...details.artifact.tags]),
    ].toSorted());
  }, [details]);
  // "Show in page" selects a thread to reveal its anchor; a panel that
  // overlays the artifact would cover it, so it steps aside first.
  const revealThreadInDocument = (threadId: string | null): void => {
    comments.selectThread(threadId);
    if (threadId === null) return;
    if (focusMode) {
      if (panelOverlays(catalogOverlayQuery)) setFocusCommentsOpen(false);
    } else if (panelOverlays(inspectorOverlayQuery)) {
      setInspectorOpen(false);
    }
  };
  const newThreadDraftContext: DraftContext | null = selectedArtifactId === null
    ? null
    : {
      artifactId: selectedArtifactId,
      principalId: session.principal.id,
      threadId: null,
      versionId: selectedVersionId,
    };
  // A new-thread draft restored from a failed in-document save still carries
  // its anchor; posting it from the sidebar composer keeps that anchor. The
  // composer's key is the draft's, so unchanged text retries that attempt.
  const submitWithDraftAnchor: typeof comments.submit = (body, anchor, path, idempotencyKey) => {
    const kept = anchor === null && newThreadDraftContext !== null
      ? readDraftAnchor(newThreadDraftContext)
      : null;
    const keptAnchor = kept === null ? null : reviewAnchorSchema.safeParse(kept.anchor);
    const posted = keptAnchor?.success === true && kept !== null
      ? comments.submit(body, keptAnchor.data, kept.path, idempotencyKey)
      : comments.submit(body, anchor, path, idempotencyKey);
    return posted.then((saved) => {
      if (saved) countPostedComment();
      return saved;
    });
  };
  const inspectorComments = {
    ...comments,
    selectThread: revealThreadInDocument,
    submit: submitWithDraftAnchor,
  };
  const openCommentCount = comments.threads.filter(
    (thread) => thread.state === "open",
  ).length;
  // A failed first read leaves no threads: show no count rather than a false 0.
  const commentCountKnown = comments.loadError === null || comments.threads.length > 0;

  // Browser agent tools (WebMCP): the ref hands the adapter live view state
  // each render; registration itself lives entirely in webmcp.tsx.
  const webmcpRef = useRef<WebmcpBindings>({
    getSnapshot: () => webmcpSnapshot(),
    openArtifact: () => undefined,
    reloadComments: () => Promise.resolve(),
  });
  const webmcpSnapshot = (): ReturnType<WebmcpBindings["getSnapshot"]> => ({
    artifact: details === null ? null : {
      currentVersionId: details.artifact.currentVersionId,
      id: details.artifact.id,
      name: details.artifact.name,
    },
    loading: detailLoading || comments.loading
      || (selectedArtifactId !== null && selectedVersion === null),
    projectId,
    projectName: projects.find((project) => project.id === projectId)?.name ?? null,
    replies: comments.repliesByThread,
    threads: comments.threads,
    version: selectedVersion === null ? null : {
      createdAt: selectedVersion.version.createdAt,
      id: selectedVersion.version.id,
    },
  });
  webmcpRef.current = {
    getSnapshot: webmcpSnapshot,
    openArtifact: (artifactId, versionId) => {
      setDetailError(null);
      setSelectedArtifactId(artifactId);
      setSelectedVersionId(versionId);
      setSelectedPath(null);
    },
    reloadComments: comments.reload,
  };
  useWebmcp(webmcpRef);

  const selectedProject = projects.find((project) => project.id === projectId) ?? null;
  const catalogItems = useMemo<readonly CatalogItem[]>(() => {
    if (
      details === null
      || searchQuery !== ""
      || catalogCommentFilter !== "all"
      || catalogTagFilters.length > 0
      || items.some(({artifact}) => artifact.id === details.artifact.id)
    ) return items;
    return [{
      artifact: details.artifact,
      commentCount: null,
      links: details.links,
      versionCount: versions.length,
    }, ...items];
  }, [
    catalogCommentFilter,
    catalogTagFilters.length,
    details,
    items,
    searchQuery,
    versions.length,
  ]);
  const selectedIndex = catalogItems.findIndex(
    ({artifact}) => artifact.id === selectedArtifactId,
  );
  const selectedItem = selectedIndex < 0 ? null : catalogItems[selectedIndex] ?? null;
  const catalogFiltered = query !== "" || catalogCommentFilter !== "all" || catalogTagFilters.length > 0;
  const catalogEmpty = !listLoading && listError === null && catalogItems.length === 0;
  // An empty project says so once, in the catalog; the canvas and the
  // inspector stay quiet instead of repeating "nothing selected".
  const projectEmpty = catalogEmpty && !catalogFiltered && selectedArtifactId === null;
  // With nothing published there is nothing to inspect: the inspector closes
  // rather than show empty tabs beside the empty catalog.
  useEffect(() => {
    if (projectEmpty) setInspectorOpen(false);
  }, [projectEmpty]);
  const loadArtifacts = useCallback(async (
    cursor: string | null,
    replace: boolean,
  ): Promise<ArtifactListLoadResult> => {
    if (projectId === "") return "skipped";
    const requestGeneration = ++catalogRequestGenerationRef.current;
    setListLoading(true);
    setListError(null);
    try {
      const page = await api.artifacts(projectId, cursor, catalogTagFilters, searchQuery, {
        comments: catalogCommentFilter,
        sort: catalogSort,
      });
      if (requestGeneration !== catalogRequestGenerationRef.current) return "skipped";
      setCatalogKnownTags((current) => {
        const next = new Set(current);
        for (const {artifact} of page.artifacts) {
          for (const tag of artifact.tags) next.add(tag);
        }
        return [...next].toSorted();
      });
      setItems((current) => replace ? page.artifacts : [...current, ...page.artifacts]);
      setNextCursor(page.nextCursor);
      if (replace) {
        setSelectedArtifactId((current) => {
          return current ?? page.artifacts[0]?.artifact.id ?? null;
        });
      }
      return "loaded";
    } catch (caught) {
      if (requestGeneration === catalogRequestGenerationRef.current) {
        setListError(
          caught instanceof Error ? caught : new Error("Artifact list failed."),
        );
      }
      return "failed";
    } finally {
      if (requestGeneration === catalogRequestGenerationRef.current) {
        setListLoading(false);
      }
    }
  }, [catalogCommentFilter, catalogSort, catalogTagFilters, projectId, searchQuery]);

  const refreshArtifacts = useCallback(async (): Promise<void> => {
    if (listLoading) return;
    if (catalogRefreshTimerRef.current !== null) {
      clearTimeout(catalogRefreshTimerRef.current);
      catalogRefreshTimerRef.current = null;
    }
    setCatalogRefreshState("loading");
    const result = await loadArtifacts(null, true);
    if (result !== "loaded") {
      setCatalogRefreshState("idle");
      return;
    }
    setCatalogRefreshState("complete");
    catalogRefreshTimerRef.current = setTimeout(() => {
      catalogRefreshTimerRef.current = null;
      setCatalogRefreshState("idle");
    }, catalogRefreshConfirmationMilliseconds);
  }, [listLoading, loadArtifacts]);

  useEffect(() => () => {
    if (catalogRefreshTimerRef.current !== null) {
      clearTimeout(catalogRefreshTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (catalogRefreshTimerRef.current !== null) {
      clearTimeout(catalogRefreshTimerRef.current);
      catalogRefreshTimerRef.current = null;
    }
    setCatalogRefreshState("idle");
    setItems([]);
    void loadArtifacts(null, true);
  }, [loadArtifacts]);

  useEffect(() => {
    if (selectedArtifactId === null || projectId === "") {
      setDetails(null);
      setVersions([]);
      setActions([]);
      setActionNextCursor(null);
      setComparison(null);
      setSelectedVersion(null);
      return undefined;
    }
    let current = true;
    setActions([]);
    setActionNextCursor(null);
    setComparison(null);
    setDetailLoading(true);
    setDetailError(null);
    void (async () => {
      try {
        const [loadedDetails, loadedVersions] = await Promise.all([
          api.artifact(projectId, selectedArtifactId),
          api.versions(projectId, selectedArtifactId),
        ]);
        if (!current) return;
        setDetails(loadedDetails);
        setVersions(loadedVersions);
        setSelectedVersionId((selected) => {
          return selected ?? loadedDetails.current.version.id;
        });
      } catch (caught) {
        if (!current) return;
        setDetails(null);
        setVersions([]);
        setSelectedVersion(null);
        setDetailError(
          caught instanceof Error ? caught : new Error("Artifact details failed."),
        );
      } finally {
        if (current) setDetailLoading(false);
      }
    })();
    return () => {
      current = false;
    };
  }, [projectId, selectedArtifactId]);

  const refreshLinkedDetails = useCallback(async (): Promise<void> => {
    if (selectedArtifactId === null || projectId === "") return;
    try {
      setDetails(await api.artifact(projectId, selectedArtifactId));
    } catch {
      // Ambient freshness never replaces the last readable artifact state.
    }
  }, [projectId, selectedArtifactId]);

  useCommentPoll(
    refreshLinkedDetails,
    session.capabilities.linkedArtifacts && details?.sourceBinding !== undefined,
  );

  const loadActions = useCallback(async (cursor: string | null): Promise<void> => {
    if (selectedArtifactId === null || projectId === "") return;
    setActivityLoading(true);
    setActivityError(null);
    try {
      const page = await api.actions(projectId, selectedArtifactId, cursor);
      setActions((current) => cursor === null ? page.actions : [...current, ...page.actions]);
      setActionNextCursor(page.nextCursor);
    } catch (caught) {
      setActivityError(caught instanceof Error ? caught : new Error("Activity loading failed."));
    } finally {
      setActivityLoading(false);
    }
  }, [projectId, selectedArtifactId]);

  useEffect(() => {
    if (inspectorTab === "activity" && actions.length === 0 && !activityLoading) {
      void loadActions(null);
    }
  }, [actions.length, activityLoading, inspectorTab, loadActions]);

  useEffect(() => {
    if (
      details === null
      || selectedArtifactId === null
      || selectedVersionId === null
    ) {
      setSelectedVersion(null);
      return undefined;
    }
    if (selectedVersionId === details.current.version.id) {
      setSelectedVersion(details.current);
      return undefined;
    }
    let current = true;
    setSelectedVersion(null);
    void (async () => {
      try {
        const loaded = await api.version(
          projectId,
          selectedArtifactId,
          selectedVersionId,
        );
        if (current) setSelectedVersion(loaded);
      } catch (caught) {
        if (!current) return;
        setDetailError(
          caught instanceof Error ? caught : new Error("Version loading failed."),
        );
      }
    })();
    return () => {
      current = false;
    };
  }, [details, projectId, selectedArtifactId, selectedVersionId]);

  useEffect(() => {
    const href = reviewHref({
      artifactId: selectedArtifactId,
      path: selectedPath,
      projectId,
      versionId: selectedVersionId,
      view: focusMode ? "focus" : null,
    });
    window.history.replaceState(null, "", href);
    window.sessionStorage.setItem("artifact-review-return-url", href);
  }, [focusMode, projectId, selectedArtifactId, selectedPath, selectedVersionId]);

  useEffect(() => {
    const restoreLocation = (): void => {
      const restored = readReviewLocation();
      if (restored.projectId !== null) {
        setCatalogKnownTags([]);
        setCatalogTagFilters([]);
        setProjectId(restored.projectId);
      }
      setSelectedArtifactId(restored.artifactId);
      setSelectedVersionId(restored.versionId);
      setSelectedPath(restored.path);
      setFocusMode(restored.view === "focus");
    };
    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, []);

  const openRawArtifact = async (): Promise<void> => {
    if (selectedArtifactId === null || selectedVersionId === null) return;
    const popup = window.open("about:blank", "_blank");
    setOpening(true);
    setDetailError(null);
    try {
      const issued = await api.contentSession(
        projectId,
        selectedArtifactId,
        selectedVersionId,
      );
      if (popup === null) {
        window.location.assign(issued.bootstrapUrl);
      } else {
        popup.opener = null;
        popup.location.replace(issued.bootstrapUrl);
      }
    } catch (caught) {
      popup?.close();
      setDetailError(
        caught instanceof Error ? caught : new Error("Artifact opening failed."),
      );
    } finally {
      setOpening(false);
    }
  };

  const canComment = selectedProject?.archivedAt === null
    && (
      (
        session.principal.kind === "human"
        && session.principal.authorizedByPrincipalId === null
      )
      || session.principal.capabilities.includes("comment:write")
    );
  const canManageProjects = (
    session.principal.kind === "human"
    && session.principal.authorizedByPrincipalId === null
  ) || session.principal.capabilities.includes("project:manage");
  const canManageArtifacts = selectedProject?.archivedAt === null && (
    (
      session.principal.kind === "human"
      && session.principal.authorizedByPrincipalId === null
    )
    || session.principal.capabilities.includes("artifact:manage:any")
  );
  const canDeleteAnyComment = (
    session.principal.kind === "human"
    && session.principal.authorizedByPrincipalId === null
    && session.principal.membershipRole === "administrator"
  ) || session.principal.capabilities.includes("artifact:manage:any");
  const previewKind = reviewPreviewKind(selectedVersion, selectedPath);
  const download = reviewDownload(
    projectId,
    selectedArtifactId,
    selectedVersion,
  );
  const selectArtifact = useCallback((artifactId: string, versionId?: string): void => {
    setDetailError(null);
    setSelectedArtifactId(artifactId);
    setSelectedVersionId(versionId ?? null);
    setSelectedPath(null);
  }, []);
  const selectProject = (nextProjectId: string): void => {
    if (nextProjectId !== projectId) {
      setCatalogKnownTags([]);
      setCatalogTagFilters([]);
      setSelectedArtifactId(null);
      setSelectedVersionId(null);
      setSelectedPath(null);
    }
    setProjectId(nextProjectId);
  };
  const selectManifestPath = (path: string): void => {
    window.history.pushState(null, "", reviewHref({
      artifactId: selectedArtifactId,
      path,
      projectId,
      versionId: selectedVersionId,
      view: focusMode ? "focus" : null,
    }));
    setSelectedPath(path);
  };
  const changeTags = async (tags: readonly string[]): Promise<void> => {
    if (details === null) return;
    const changed = await api.changeTags(
      details.artifact.projectId,
      details.artifact.id,
      details.artifact.currentVersionId,
      tags,
      crypto.randomUUID(),
    );
    updateArtifact(changed.artifact);
  };
  const updateArtifact = (artifact: ArtifactDetails["artifact"]): void => {
    setCatalogKnownTags((current) => [...new Set([...current, ...artifact.tags])].toSorted());
    setDetails((current) => current?.artifact.id === artifact.id
      ? {...current, artifact}
      : current);
    setItems((current) => current.map((item) => item.artifact.id === artifact.id
      ? {...item, artifact}
      : item));
  };
  // The catalog total counts every comment on every version; one posted from
  // this page adds to it, and nothing else here changes its scope.
  const countPostedComment = (): void => {
    if (selectedArtifactId === null) return;
    setItems((current) => current.map((item) => item.artifact.id === selectedArtifactId
      ? {...item, commentCount: item.commentCount + 1}
      : item));
  };
  const makeVersionCurrent = async (
    versionId: string,
    expectedCurrentVersionId: string,
  ): Promise<boolean> => {
    if (details === null) return false;
    setDetailError(null);
    try {
      const restored = await api.restore(
        details.artifact.projectId,
        details.artifact.id,
        expectedCurrentVersionId,
        versionId,
        crypto.randomUUID(),
      );
      updateArtifact(restored.artifact);
      const [loadedDetails, loadedVersions] = await Promise.all([
        api.artifact(details.artifact.projectId, details.artifact.id),
        api.versions(details.artifact.projectId, details.artifact.id),
      ]);
      setDetails(loadedDetails);
      setVersions(loadedVersions);
      return true;
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        try {
          const [loadedDetails, loadedVersions] = await Promise.all([
            api.artifact(details.artifact.projectId, details.artifact.id),
            api.versions(details.artifact.projectId, details.artifact.id),
          ]);
          setDetails(loadedDetails);
          setVersions(loadedVersions);
          updateArtifact(loadedDetails.artifact);
        } catch {
          // Keep the original conflict visible when refreshing pointer state fails.
        }
        setDetailError(new Error(
          "The current version changed before this action completed. Nothing was changed; the latest version state has been reloaded.",
        ));
        return false;
      }
      setDetailError(
        caught instanceof Error ? caught : new Error("The version could not be made current."),
      );
      return false;
    }
  };
  const compareVersions = async (fromVersionId: string, toVersionId: string): Promise<void> => {
    if (details === null || fromVersionId === toVersionId) return;
    setComparisonLoading(true);
    setComparisonError(null);
    try {
      setComparison(await api.comparison(
        details.artifact.projectId,
        details.artifact.id,
        fromVersionId,
        toVersionId,
      ));
      setInspectorTab("compare");
    } catch (caught) {
      setComparisonError(caught instanceof Error ? caught : new Error("Version comparison failed."));
    } finally {
      setComparisonLoading(false);
    }
  };
  const captureLinkedArtifact = async (): Promise<void> => {
    if (details === null) return;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const captured = await api.captureArtifact(
        details.artifact.projectId,
        details.artifact.id,
        details.artifact.currentVersionId,
        crypto.randomUUID(),
      );
      const [loadedDetails, loadedVersions] = await Promise.all([
        api.artifact(details.artifact.projectId, details.artifact.id),
        api.versions(details.artifact.projectId, details.artifact.id),
      ]);
      setDetails(loadedDetails);
      setVersions(loadedVersions);
      setSelectedVersionId(captured.version.id);
      updateArtifact(loadedDetails.artifact);
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught : new Error("Linked artifact capture failed."));
    } finally {
      setDetailLoading(false);
    }
  };
  const openLinkedArtifact = async (): Promise<void> => {
    if (details === null) return;
    const popup = window.open("about:blank", "_blank");
    setDetailError(null);
    try {
      const issued = await api.liveSession(details.artifact.projectId, details.artifact.id);
      if (popup === null) window.location.assign(issued.bootstrapUrl);
      else {
        popup.opener = null;
        popup.location.replace(issued.bootstrapUrl);
      }
    } catch (caught) {
      popup?.close();
      setDetailError(caught instanceof Error ? caught : new Error("Live artifact opening failed."));
    }
  };
  const tombstoneArtifact = async (): Promise<boolean> => {
    if (details === null) return false;
    setDetailError(null);
    try {
      await api.deleteArtifact(
        details.artifact.projectId,
        details.artifact.id,
        details.artifact.currentVersionId,
        crypto.randomUUID(),
      );
      setItems((current) => current.filter(({artifact}) => artifact.id !== details.artifact.id));
      setSelectedArtifactId(null);
      setSelectedVersionId(null);
      setSelectedPath(null);
      setDetails(null);
      setVersions([]);
      void loadArtifacts(null, true);
      return true;
    } catch (caught) {
      setDetailError(caught instanceof Error ? caught : new Error("Artifact deletion failed."));
      return false;
    }
  };
  const enterFocusMode = useCallback((): void => {
    window.history.pushState(null, "", reviewHref({
      artifactId: selectedArtifactId,
      path: selectedPath,
      projectId,
      versionId: selectedVersionId,
      view: "focus",
    }));
    setFocusCommentsOpen(false);
    setFocusControlsCollapsed(false);
    setFocusMode(true);
  }, [projectId, selectedArtifactId, selectedPath, selectedVersionId]);
  const exitFocusMode = useCallback((): void => {
    window.history.pushState(null, "", reviewHref({
      artifactId: selectedArtifactId,
      path: selectedPath,
      projectId,
      versionId: selectedVersionId,
      view: null,
    }));
    setFocusCommentsOpen(false);
    setFocusControlsCollapsed(false);
    setFocusMode(false);
  }, [projectId, selectedArtifactId, selectedPath, selectedVersionId]);
  useEffect(() => {
    const handleReviewShortcut = (event: KeyboardEvent): void => {
      if (homeOpen || reviewShortcutBlocked(event)) return;

      const key = event.key.toLowerCase();
      if (key === "escape") {
        const closeOverlay = (
          panel: string,
          returnFrom: "catalog" | "focus-comments" | "inspector",
          close: () => void,
        ): void => {
          event.preventDefault();
          const focusWasInside = (document.activeElement?.closest(panel) ?? null) !== null;
          if (focusWasInside) returnFocusFromRef.current = returnFrom;
          close();
        };
        if (focusCommentsOpen) {
          closeOverlay(".as-focus-comments", "focus-comments", () => setFocusCommentsOpen(false));
        } else if (!focusMode && catalogOpen && panelOverlays(catalogOverlayQuery)) {
          closeOverlay(".as-catalog", "catalog", () => setCatalogOpen(false));
        } else if (!focusMode && inspectorOpen && panelOverlays(inspectorOverlayQuery)) {
          closeOverlay(".as-inspector", "inspector", () => setInspectorOpen(false));
        } else if (htmlAnnotateModeActive) {
          event.preventDefault();
          setHtmlAnnotateModeActive(false);
        } else if (focusMode) {
          event.preventDefault();
          exitFocusMode();
        }
        return;
      }

      if (key === "f" && selectedVersionId !== null) {
        event.preventDefault();
        if (focusMode) exitFocusMode();
        else enterFocusMode();
        return;
      }

      if (key === "]") {
        event.preventDefault();
        if (focusMode) setFocusCommentsOpen((current) => !current);
        else setInspectorOpen((current) => !current);
        return;
      }

      if (key === "[" && !focusMode) {
        event.preventDefault();
        setCatalogOpen((current) => !current);
        return;
      }

      const direction = key === "j" || key === "arrowdown"
        ? 1
        : key === "k" || key === "arrowup"
          ? -1
          : 0;
      if (direction === 0) return;

      event.preventDefault();
      const next = catalogItems[selectedIndex + direction];
      if (next !== undefined) {
        selectArtifact(next.artifact.id, next.artifact.currentVersionId);
      }
    };

    window.addEventListener("keydown", handleReviewShortcut);
    return () => window.removeEventListener("keydown", handleReviewShortcut);
  }, [
    catalogItems,
    catalogOpen,
    enterFocusMode,
    exitFocusMode,
    focusCommentsOpen,
    focusMode,
    homeOpen,
    htmlAnnotateModeActive,
    inspectorOpen,
    selectArtifact,
    selectedIndex,
    selectedVersionId,
  ]);
  useEffect(() => {
    const returnFrom = returnFocusFromRef.current;
    if (returnFrom === null) return;
    const open = returnFrom === "catalog" ? catalogOpen
      : returnFrom === "inspector" ? inspectorOpen
      : focusCommentsOpen;
    if (open) return;
    returnFocusFromRef.current = null;
    const target = returnFrom === "catalog" ? openCatalogButtonRef.current
      : returnFrom === "inspector" ? openInspectorButtonRef.current
      : focusCommentsButtonRef.current;
    (target ?? previewPanelRef.current)?.focus({preventScroll: true});
  }, [catalogOpen, focusCommentsOpen, inspectorOpen]);
  const hideFocusControls = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    previewPanelRef.current?.focus({preventScroll: true});
    setFocusControlsHoverArmed(event.detail === 0);
    setFocusControlsCollapsed(true);
    if (event.detail === 0) {
      window.requestAnimationFrame(() => {
        focusControlsRestoreRef.current?.focus({preventScroll: true});
      });
    }
  };
  const showFocusControls = (): void => {
    setFocusControlsHoverArmed(true);
    setFocusControlsCollapsed(false);
    window.requestAnimationFrame(() => focusCommentsButtonRef.current?.focus({preventScroll: true}));
  };
  useEffect(() => {
    if (!focusMode) return undefined;
    const revealFocusControls = (event: KeyboardEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      const isShortcut = (event.metaKey || event.ctrlKey)
        && !event.altKey
        && !event.shiftKey
        && (event.code === "Backslash" || event.key === "\\");
      if (
        !isShortcut
        || event.defaultPrevented
        || event.isComposing
        || target?.closest('[role="dialog"], [data-slot="popover-content"]')
      ) {
        return;
      }
      event.preventDefault();
      setFocusControlsInstant(true);
      setFocusControlsCollapsed(false);
      window.requestAnimationFrame(() => {
        focusCommentsButtonRef.current?.focus({preventScroll: true});
        window.requestAnimationFrame(() => setFocusControlsInstant(false));
      });
    };
    window.addEventListener("keydown", revealFocusControls);
    return () => window.removeEventListener("keydown", revealFocusControls);
  }, [focusMode]);
  const artifactTitle = details?.artifact.name ?? selectedItem?.artifact.name ?? null;
  const reviewTargetUnavailable = selectedArtifactId !== null
    && detailError !== null
    && selectedVersion === null
    && !(detailLoading && details === null);
  const versionIdentity = selectedVersion === null || details === null
    ? null
    : {
      label: versionLabel(
        selectedVersion.version.number,
        versions.length,
        selectedVersion.version.id === details.artifact.currentVersionId,
      ),
      savedAt: selectedVersion.version.createdAt,
    };
  const returnHome = (event: ReactMouseEvent<HTMLAnchorElement>): void => {
    if (
      event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }
    event.preventDefault();
    setHomeOpen(true);
  };

  return (
    <div
      className="as-app"
      data-catalog-open={catalogOpen}
      data-focus-mode={focusMode}
      data-html-annotate-mode={htmlAnnotateModeActive}
      data-inspector-open={inspectorOpen}
      data-panel-resizing={catalogResize.isDragging || inspectorResize.isDragging}
    >
      <a className="as-skip-link" href="#review-preview">Skip to artifact preview</a>

      <Dialog.Root onOpenChange={setHomeOpen} open={homeOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop className="as-home-overlay__backdrop" />
          <Dialog.Popup className="as-home-overlay">
            <Dialog.Title className="as-visually-hidden">Artifact Server home</Dialog.Title>
            <Dialog.Close
              aria-label="Close Artifact Server home"
              className="as-icon-button as-home-overlay__close"
              title="Close Artifact Server home"
            >
              <HugeiconsIcon aria-hidden="true" icon={Cancel01Icon} strokeWidth={1.8} />
            </Dialog.Close>
            <div className="as-home-overlay__content">
            <img
              alt=""
              aria-hidden="true"
                className="as-home-overlay__animation"
              src={artifactServerAnimationUrl}
            />
              <nav aria-label="Artifact Server resources" className="as-home-resources">
                <a
                  className="as-home-resources__link"
                  href="https://github.com/plannotator/artifact-server"
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="as-home-resources__icon">
                    <HugeiconsIcon aria-hidden="true" icon={GithubIcon} strokeWidth={1.8} />
                  </span>
                  <span className="as-home-resources__identity">
                    <strong>GitHub</strong>
                    <span>Source and releases</span>
                  </span>
                  <HugeiconsIcon aria-hidden="true" icon={ExternalLinkIcon} strokeWidth={1.8} />
                </a>
                <a
                  className="as-home-resources__link"
                  href="https://artifactserver.com/"
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="as-home-resources__icon">
                    <HugeiconsIcon aria-hidden="true" icon={Home01Icon} strokeWidth={1.8} />
                  </span>
                  <span className="as-home-resources__identity">
                    <strong>Homepage</strong>
                    <span>Product overview</span>
                  </span>
                  <HugeiconsIcon aria-hidden="true" icon={ExternalLinkIcon} strokeWidth={1.8} />
                </a>
                <a
                  className="as-home-resources__link"
                  href="https://artifactserver.com/docs/"
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="as-home-resources__icon">
                    <HugeiconsIcon aria-hidden="true" icon={BookOpen01Icon} strokeWidth={1.8} />
                  </span>
                  <span className="as-home-resources__identity">
                    <strong>Docs</strong>
                    <span>Install and deploy</span>
                  </span>
                  <HugeiconsIcon aria-hidden="true" icon={ExternalLinkIcon} strokeWidth={1.8} />
                </a>
                {/* TODO(open-source-launch): publish the dedicated agent-connection guide at this canonical route. */}
                <a
                  className="as-home-resources__link"
                  href="https://artifactserver.com/docs/connect-agents/"
                  rel="noreferrer"
                  target="_blank"
                >
                  <span
                    aria-hidden="true"
                    className="as-home-resources__icon as-home-resources__icon--agents"
                  >
                    <AgentLogos />
                  </span>
                  <span className="as-home-resources__identity">
                    <strong>Connect agents</strong>
                    <span>MCP and client setup</span>
                  </span>
                  <HugeiconsIcon aria-hidden="true" icon={ExternalLinkIcon} strokeWidth={1.8} />
                </a>
              </nav>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>

      {!focusMode && catalogOpen ? (
        // Shown only where the catalog overlays the artifact (review.css and
        // calm/shell.css keep the breakpoint); a click outside closes it.
        <div
          aria-hidden="true"
          className="as-overlay-scrim"
          data-panel="catalog"
          onClick={() => setCatalogOpen(false)}
        />
      ) : null}
      {!focusMode && catalogMotion.mounted ? (
        <div className="as-panel-assembly" data-side="left">
          <motion.div
            className="as-panel-clip as-catalog-clip"
            data-side="left"
            style={{width: catalogMotion.outerWidth}}
          >
            <motion.aside
              aria-label="Artifact catalog"
              className="as-catalog"
              style={{width: catalogMotion.width}}
            >
        <header className="as-pane-header as-catalog__header">
          <div className="as-catalog__context">
            <a
              aria-label="Artifact Server"
              className="as-catalog__brand"
              href="/review"
              onClick={returnHome}
              title="Artifact Server"
            >
              <ArtifactMark className="as-catalog__brand-mark" />
            </a>
            <ReviewProjectPicker
              canCreate={canManageProjects}
              onCreate={onCreateProject}
              onSelect={selectProject}
              projects={projects}
              selectedProjectId={projectId}
            />
          </div>
          <div className="as-catalog__header-actions">
            <IconButton
              label={theme === "moon" ? "Use light theme" : "Use dark theme"}
              onClick={onThemeChange}
            >
              <HugeiconsIcon icon={theme === "moon" ? Sun03Icon : Moon02Icon} strokeWidth={1.8} />
            </IconButton>
            <a
              aria-label="Open settings"
              className="as-icon-button"
              href={selectedProject === null
                ? "/review/settings/projects"
                : `/review/settings/projects/${encodeURIComponent(selectedProject.id)}`}
              title="Open settings"
            >
              <HugeiconsIcon icon={Settings02Icon} strokeWidth={1.8} />
            </a>
            <IconButton
              keyShortcuts="["
              label="Collapse artifact catalog"
              onClick={() => setCatalogOpen(false)}
              title="Collapse artifact catalog ([)"
            >
              <HugeiconsIcon icon={LayoutLeftIcon} strokeWidth={1.8} />
            </IconButton>
          </div>
        </header>

        <div className="as-catalog__tools">
          <div className="as-search-group">
            <label className="as-search">
              <span className="as-visually-hidden">Search artifacts</span>
              <HugeiconsIcon aria-hidden="true" icon={Search01Icon} strokeWidth={1.8} />
              <input
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search artifacts…"
                type="search"
                value={query}
              />
              {query === "" ? null : (
                <button aria-label="Clear search" onClick={() => setQuery("")} type="button">
                  <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.8} />
                </button>
              )}
            </label>
            <div className="as-catalog-query-controls">
              <CatalogFilters
                commentFilter={catalogCommentFilter}
                knownTags={catalogKnownTags}
                onCommentFilterChange={setCatalogCommentFilter}
                onTagFiltersChange={setCatalogTagFilters}
                tagFilters={catalogTagFilters}
              />
              <label>
                <span className="as-visually-hidden">Sort artifacts</span>
                <select
                  aria-label="Sort artifacts"
                  onChange={(event) => {
                    const value = event.currentTarget.value;
                    if (value === "comments" || value === "newest") setCatalogSort(value);
                  }}
                  value={catalogSort}
                >
                  <option value="newest">Newest first</option>
                  <option value="comments">Most comments</option>
                </select>
              </label>
            </div>
          </div>
        </div>

        <div className="as-catalog__list">
          {listError === null ? null : (
            <InlineState description={failureMessage(listError)} title="Catalog unavailable" tone="error" />
          )}
          {listLoading && items.length === 0 ? (
            <InlineState description="Reading this project." title="Loading artifacts" />
          ) : null}
          {catalogEmpty && catalogFiltered ? (
            <InlineState
              description="Try clearing a filter or using a wider search."
              title="No matching artifacts"
            />
          ) : null}
          {catalogEmpty && !catalogFiltered ? (
            <EmptyProjectState projectId={projectId} />
          ) : null}
          {catalogItems.map(({artifact, commentCount, versionCount}) => {
            return (
              <button
                aria-current={artifact.id === selectedArtifactId ? "true" : undefined}
                className="as-artifact-card"
                data-selected={artifact.id === selectedArtifactId}
                key={artifact.id}
                onClick={() => selectArtifact(artifact.id, artifact.currentVersionId)}
                type="button"
              >
                <span className="as-artifact-card__title-row">
                  <strong title={artifact.name}>{artifact.name}</strong>
                  <AccessPill access={artifact.accessSetting} />
                </span>
                <span className="as-artifact-card__meta">
                  <span className="as-artifact-card__history">
                    <time dateTime={artifact.createdAt}>{formatTimestamp(artifact.createdAt)}</time>
                    {versionCount > 1 ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{versionCount} versions</span>
                      </>
                    ) : null}
                  </span>
                  {commentCount === null || commentCount === 0 ? null : (
                    <span className="as-artifact-card__counts">
                      <span title={`${commentCount} comment${commentCount === 1 ? "" : "s"} on every version, open, resolved and sent`}>
                        <HugeiconsIcon aria-hidden="true" icon={Comment01Icon} strokeWidth={1.8} />
                        {commentCount} comment{commentCount === 1 ? "" : "s"}
                      </span>
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        <footer className="as-app-footer as-catalog__footer">
          <button
            aria-busy={catalogRefreshState === "loading"}
            aria-label="Refresh artifacts published by agents, the CLI, or other sessions"
            className="as-catalog-refresh"
            data-state={catalogRefreshState}
            disabled={listLoading}
            onClick={() => void refreshArtifacts()}
            title="Refresh artifacts published by agents, the CLI, or other sessions"
            type="button"
          >
            <HugeiconsIcon
              aria-hidden="true"
              className="as-catalog-refresh__icon"
              icon={catalogRefreshState === "complete" ? Tick02Icon : RefreshIcon}
              strokeWidth={1.8}
            />
            <span>
              {catalogRefreshState === "loading"
                ? "Refreshing…"
                : catalogRefreshState === "complete"
                  ? "Refreshed"
                  : "Refresh"}
            </span>
          </button>
          <span aria-live="polite" className="as-visually-hidden">
            {catalogRefreshState === "loading"
              ? "Refreshing artifact catalog."
              : catalogRefreshState === "complete"
                ? "Artifact catalog refreshed."
                : ""}
          </span>
          <div className="as-catalog__footer-actions">
            {nextCursor === null ? null : (
              <button disabled={listLoading} onClick={() => void loadArtifacts(nextCursor, false)} type="button">
                {listLoading ? "Loading…" : "Load more"}
              </button>
            )}
            <ReviewKeyboardShortcuts />
          </div>
        </footer>
            </motion.aside>
          </motion.div>
          {catalogOpen ? (
            <ReviewPanelEdge
              label="Artifact catalog width"
              onCollapse={() => setCatalogOpen(false)}
              resize={catalogResize}
              side="left"
            />
          ) : null}
        </div>
      ) : null}

      <main className="as-workspace">
        <section
          className="as-preview-panel"
          id="review-preview"
          ref={previewPanelRef}
          tabIndex={-1}
        >
          {focusMode ? (
            <>
              <div
                className="as-focus-controls-dock"
                data-collapsed={focusControlsCollapsed}
                data-comments-open={focusCommentsOpen}
                data-hover-armed={focusControlsHoverArmed}
                data-instant={focusControlsInstant}
                onPointerLeave={() => setFocusControlsHoverArmed(true)}
              >
                <span aria-hidden="true" className="as-focus-controls__hover-zone" />
                <div
                  aria-hidden={focusControlsCollapsed}
                  aria-label="Artifact viewer controls"
                  className="as-focus-controls"
                  inert={focusControlsCollapsed}
                  role="toolbar"
                >
                  <span className="as-focus-controls__identity">
                    <strong title={artifactTitle ?? undefined}>{artifactTitle ?? "Artifact"}</strong>
                    {versionIdentity === null ? null : (
                      <span className="as-version-chip">{versionIdentity.label}</span>
                    )}
                  </span>
                  {(previewKind === "html" || previewKind === "markdown") && canComment ? (
                    <AnnotateModeToggle
                      active={htmlAnnotateModeActive}
                      className="as-button as-focus-controls__button"
                      onToggle={() => setHtmlAnnotateModeActive((active) => !active)}
                    />
                  ) : null}
                  <button
                    aria-controls="review-focus-comments"
                    aria-expanded={focusCommentsOpen}
                    aria-keyshortcuts="]"
                    className="as-button as-focus-controls__button"
                    data-active={focusCommentsOpen}
                    onClick={() => setFocusCommentsOpen((current) => !current)}
                    ref={focusCommentsButtonRef}
                    title="Toggle comments (])"
                    type="button"
                  >
                    <HugeiconsIcon aria-hidden="true" icon={Comment01Icon} strokeWidth={1.8} />
                    <span className="as-button__label">Comments</span>
                    {commentCountKnown ? <span
                      className="as-focus-controls__count"
                      title={`${openCommentCount} open comment${openCommentCount === 1 ? "" : "s"} on this version, not yet sent to an agent`}
                    >
                      {openCommentCount}
                      <span className="as-visually-hidden"> open</span>
                    </span> : null}
                  </button>
                  <ReviewShareControl
                    details={details}
                    key={`focus-share-${details?.artifact.id ?? "empty"}`}
                    onArtifactChanged={updateArtifact}
                    selectedPath={selectedPath}
                    selectedVersion={selectedVersion}
                    triggerClassName="as-button as-focus-controls__button"
                  />
                  <ReviewDownloadControl
                    className="as-button as-focus-controls__button"
                    download={download}
                  />
                  <button
                    aria-keyshortcuts="F"
                    className="as-button as-focus-controls__button"
                    onClick={exitFocusMode}
                    title="Exit full screen (F)"
                    type="button"
                  >
                    <HugeiconsIcon aria-hidden="true" icon={ArrowShrinkIcon} strokeWidth={1.8} />
                    <span className="as-button__label">Exit full screen</span>
                  </button>
                  <button
                    aria-label="Hide viewer controls"
                    className="as-icon-button as-focus-controls__collapse"
                    onClick={hideFocusControls}
                    title="Hide viewer controls"
                    type="button"
                  >
                    <HugeiconsIcon aria-hidden="true" icon={ArrowRight01Icon} strokeWidth={1.8} />
                  </button>
                </div>
                <button
                  aria-hidden={!focusControlsCollapsed}
                  aria-keyshortcuts="Meta+\\ Control+\\"
                  aria-label="Show viewer controls"
                  className="as-focus-controls__restore"
                  onClick={showFocusControls}
                  ref={focusControlsRestoreRef}
                  tabIndex={focusControlsCollapsed ? 0 : -1}
                  title="Show viewer controls (Command/Control + \\)"
                  type="button"
                >
                  <HugeiconsIcon aria-hidden="true" icon={ArrowLeft01Icon} strokeWidth={1.8} />
                </button>
              </div>
              <aside
                aria-hidden={!focusCommentsOpen}
                aria-labelledby="review-focus-comments-title"
                className="as-focus-comments"
                data-open={focusCommentsOpen}
                id="review-focus-comments"
                inert={!focusCommentsOpen}
              >
                <header className="as-focus-comments__header">
                  <div>
                    <HugeiconsIcon aria-hidden="true" icon={Comment01Icon} strokeWidth={1.8} />
                    <h2 id="review-focus-comments-title">Comments</h2>
                    {commentCountKnown ? <span>{openCommentCount}</span> : null}
                  </div>
                  <IconButton
                    keyShortcuts="] Escape"
                    label="Close comments"
                    onClick={() => setFocusCommentsOpen(false)}
                    title="Close comments (] or Esc)"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.8} />
                  </IconButton>
                </header>
                <div className="as-focus-comments__body">
                  <ReviewCommentsInspector
                    canComment={canComment}
                    canDeleteAny={canDeleteAnyComment}
                    key={restoredDraftGeneration}
                    principalId={session.principal.id}
                    ref={commentsInspectorRef}
                    session={inspectorComments}
                    versionId={selectedVersionId}
                  />
                </div>
              </aside>
            </>
          ) : null}
          <header className="as-pane-header as-preview-header">
            <div className="as-preview-header__identity">
              {!catalogOpen ? (
                <IconButton
                  keyShortcuts="["
                  label="Open artifact catalog"
                  onClick={() => setCatalogOpen(true)}
                  ref={openCatalogButtonRef}
                  title="Open artifact catalog ([)"
                >
                  <HugeiconsIcon icon={LayoutLeftIcon} strokeWidth={1.8} />
                </IconButton>
              ) : null}
              <div className="as-preview-header__title">
                <h1 title={artifactTitle ?? undefined}>{artifactTitle ?? "Artifact Server"}</h1>
                {versionIdentity === null ? null : (
                  <span className="as-preview-header__meta">
                    <span className="as-version-chip">{versionIdentity.label}</span>
                    <time
                      className="as-preview-header__saved"
                      dateTime={versionIdentity.savedAt}
                      title={`Saved ${formatTimestamp(versionIdentity.savedAt)}`}
                    >
                      Saved {formatRelativeTime(versionIdentity.savedAt, Date.now())}
                    </time>
                  </span>
                )}
              </div>
            </div>
            <div className="as-preview-header__actions">
              {(previewKind === "html" || previewKind === "markdown") && canComment ? (
                <AnnotateModeToggle
                  active={htmlAnnotateModeActive}
                  className="as-button as-annotate-toggle"
                  onToggle={() => setHtmlAnnotateModeActive((active) => !active)}
                />
              ) : null}
              {selectedArtifactId === null ? null : (
                <>
                  <ReviewShareControl
                    details={details}
                    key={`header-share-${details?.artifact.id ?? "empty"}`}
                    onArtifactChanged={updateArtifact}
                    selectedPath={selectedPath}
                    selectedVersion={selectedVersion}
                    triggerClassName="as-button as-button--secondary"
                  />
                  <button
                    aria-label="Full screen"
                    aria-keyshortcuts="F"
                    className="as-icon-button as-preview-header__full-screen"
                    disabled={selectedVersionId === null}
                    onClick={enterFocusMode}
                    title="Full screen (F)"
                    type="button"
                  >
                    <HugeiconsIcon aria-hidden="true" icon={FullScreenIcon} strokeWidth={1.8} />
                  </button>
                  <ReviewMoreActions
                    download={download}
                    onOpenRawArtifact={() => void openRawArtifact()}
                    opening={opening}
                    rawDisabled={selectedVersionId === null}
                  />
                </>
              )}
              {!inspectorOpen ? (
                <IconButton
                  keyShortcuts="]"
                  label="Open inspector"
                  onClick={() => setInspectorOpen(true)}
                  ref={openInspectorButtonRef}
                  title="Open inspector (])"
                >
                  <HugeiconsIcon icon={PanelRightIcon} strokeWidth={1.8} />
                </IconButton>
              ) : null}
            </div>
          </header>

          <div className="as-preview-panel__body" data-preview-kind={previewKind}>
            {detailError === null || reviewTargetUnavailable ? null : (
              <div className="as-preview-error" role="alert">{failureMessage(detailError)}</div>
            )}
            {selectedArtifactId === null ? (
              projectEmpty ? (
                <p className="as-preview-empty-hint">
                  Nothing is published here yet.{" "}
                  {catalogOpen ? "The catalog shows how to publish the first artifact." : (
                    <button className="as-link-button" onClick={() => setCatalogOpen(true)} type="button">
                      Open the catalog to publish the first one.
                    </button>
                  )}
                </p>
              ) : <PreviewWelcome />
            ) : detailLoading && details === null ? (
              <PreviewWelcome description="Loading the artifact." title="Opening artifact" />
            ) : reviewTargetUnavailable ? (
              <PreviewWelcome
                action={(
                  <div className="as-preview-welcome__actions">
                    {details === null ? null : (
                      <button
                        className="as-button as-button--primary"
                        onClick={() => selectArtifact(details.artifact.id, details.artifact.currentVersionId)}
                        type="button"
                      >
                        Open the current version
                      </button>
                    )}
                    <button
                      className={details === null ? "as-button as-button--primary" : "as-button as-button--secondary"}
                      onClick={() => {
                        setDetailError(null);
                        setSelectedArtifactId(null);
                        setSelectedVersionId(null);
                        setSelectedPath(null);
                        setCatalogOpen(true);
                      }}
                      type="button"
                    >
                      Back to the catalog
                    </button>
                  </div>
                )}
                description={details === null
                  ? "This link names an artifact that is not available here. It may have been deleted, belong to another project, or need access you do not have."
                  : "This link names a version of this artifact that is not available here."}
                title="Review target unavailable"
              />
            ) : (
              <ReviewPreview
                annotateModeActive={htmlAnnotateModeActive}
                annotations={comments.annotations}
                artifactId={selectedArtifactId}
                artifactName={details?.artifact.name ?? selectedItem?.artifact.name ?? "Artifact"}
                isLight={theme === "dawn"}
                onOpenRawArtifact={() => void openRawArtifact()}
                onAnnotateModeChange={setHtmlAnnotateModeActive}
                onSelectAnnotation={(threadId) => {
                  comments.selectThread(threadId);
                  if (threadId !== null) {
                    setInspectorTab("comments");
                    if (focusMode) {
                      setFocusCommentsOpen(true);
                    } else {
                      setInspectorOpen(true);
                    }
                  }
                }}
                onSubmitAnnotation={async (rawBody, anchor, path) => {
                  // Post the body the panel composer would post, so a retry of
                  // the restored draft is the same request under the same key.
                  const body = rawBody.trim();
                  const idempotencyKey = crypto.randomUUID();
                  const saved = await comments.submit(body, anchor, path, idempotencyKey);
                  if (!saved && newThreadDraftContext !== null && selectedVersionId !== null) {
                    // The in-frame composer discards its text on failure; keep
                    // it, with its anchor and key, as this version's new-thread
                    // draft and show it in the comments panel.
                    writeFailedDraft(newThreadDraftContext, body, {
                      anchor: anchor === null ? null : {anchor, path},
                      retry: {body, key: idempotencyKey},
                    });
                    setRestoredDraftGeneration((current) => current + 1);
                    setInspectorTab("comments");
                    if (focusMode) setFocusCommentsOpen(true);
                    else setInspectorOpen(true);
                  }
                  if (saved) {
                    countPostedComment();
                    setInspectorTab("comments");
                    if (!focusMode) {
                      setInspectorOpen(true);
                    }
                  }
                  return saved;
                }}
                onUnanchoredChange={comments.updateUnanchored}
                opening={opening}
                projectId={projectId}
                readOnly={!canComment}
                retryToken={previewRetryToken}
                selectedThreadId={comments.selectedThreadId}
                selectedPath={selectedPath}
                version={selectedVersion}
              />
            )}
          </div>

          <footer className="as-app-footer as-preview-footer">
            <div className="as-preview-footer__nav">
              <IconButton
                disabled={selectedIndex <= 0}
                keyShortcuts="K ArrowUp"
                label={selectedIndex <= 0
                  ? "Previous artifact"
                  : `Previous artifact (${selectedIndex} of ${catalogItems.length})`}
                onClick={() => {
                  const previous = catalogItems[selectedIndex - 1];
                  if (previous !== undefined) {
                    selectArtifact(previous.artifact.id, previous.artifact.currentVersionId);
                  }
                }}
                title={selectedIndex <= 0
                  ? "Previous artifact (K or ↑)"
                  : `Previous artifact, ${selectedIndex} of ${catalogItems.length} (K or ↑)`}
              >
                <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={1.8} />
              </IconButton>
              <IconButton
                disabled={selectedIndex < 0 || selectedIndex >= catalogItems.length - 1}
                keyShortcuts="J ArrowDown"
                label={selectedIndex < 0 || selectedIndex >= catalogItems.length - 1
                  ? "Next artifact"
                  : `Next artifact (${selectedIndex + 2} of ${catalogItems.length})`}
                onClick={() => {
                  const next = catalogItems[selectedIndex + 1];
                  if (next !== undefined) {
                    selectArtifact(next.artifact.id, next.artifact.currentVersionId);
                  }
                }}
                title={selectedIndex < 0 || selectedIndex >= catalogItems.length - 1
                  ? "Next artifact (J or ↓)"
                  : `Next artifact, ${selectedIndex + 2} of ${catalogItems.length} (J or ↓)`}
              >
                <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={1.8} />
              </IconButton>
            </div>
            <div className="as-preview-footer__status">
              <span className="as-preview-footer__metadata">
                {selectedVersion === null
                  ? ""
                  : `Version ${selectedVersion.version.number} of ${Math.max(versions.length, selectedVersion.version.number)} · ${selectedVersion.manifest.entries.length} file${selectedVersion.manifest.entries.length === 1 ? "" : "s"}`}
              </span>
              <button
                className="as-button as-preview-footer__reload"
                disabled={comments.loading || selectedVersion === null}
                onClick={() => {
                  setPreviewRetryToken((current) => current + 1);
                  void (commentsInspectorRef.current?.reload() ?? comments.reload());
                }}
                type="button"
              >
                <HugeiconsIcon aria-hidden="true" icon={RefreshIcon} strokeWidth={1.8} />
                {comments.loading ? "Loading…" : "Reload"}
              </button>
            </div>
          </footer>
        </section>

        {!focusMode && inspectorOpen ? (
          <div
            aria-hidden="true"
            className="as-overlay-scrim"
            data-panel="inspector"
            onClick={() => setInspectorOpen(false)}
          />
        ) : null}
        {!focusMode && inspectorMotion.mounted ? (
          <div className="as-panel-assembly" data-side="right">
            {inspectorOpen ? (
              <ReviewPanelEdge
                label="Artifact inspector width"
                onCollapse={() => setInspectorOpen(false)}
                resize={inspectorResize}
                side="right"
              />
            ) : null}
            <motion.div
              className="as-panel-clip as-inspector-clip"
              data-side="right"
              style={{width: inspectorMotion.outerWidth}}
            >
              <motion.aside
                aria-label="Artifact inspector"
                className="as-inspector"
                style={{width: inspectorMotion.width}}
              >
          <header className="as-pane-header as-inspector__header">
            <div
              aria-label="Artifact inspector"
              className="as-tabs"
              data-overflow={inspectorTabOverflow}
              onKeyDown={(event) => {
                const tabs: readonly InspectorTab[] = comparison === null
                  ? inspectorTabOrder
                  : [...inspectorTabOrder, "compare"];
                const index = tabs.indexOf(inspectorTab);
                const next = event.key === "ArrowRight"
                  ? tabs[(index + 1) % tabs.length]
                  : event.key === "ArrowLeft"
                    ? tabs[(index - 1 + tabs.length) % tabs.length]
                    : event.key === "Home"
                      ? tabs[0]
                      : event.key === "End"
                        ? tabs.at(-1)
                        : undefined;
                if (next === undefined) return;
                event.preventDefault();
                setInspectorTab(next);
                document.getElementById(`review-inspector-tab-${next}`)?.focus();
              }}
              ref={inspectorTabListRef}
              role="tablist"
            >
              {commentCountKnown
                ? <InspectorTabButton active={inspectorTab === "comments"} count={openCommentCount} countLabel={`${openCommentCount} open comment${openCommentCount === 1 ? "" : "s"} on this version, not yet sent to an agent`} label="Comments" onClick={() => setInspectorTab("comments")} tab="comments" />
                : <InspectorTabButton active={inspectorTab === "comments"} label="Comments" onClick={() => setInspectorTab("comments")} tab="comments" />}
              <InspectorTabButton active={inspectorTab === "details"} label="Details" onClick={() => setInspectorTab("details")} tab="details" />
              <InspectorTabButton active={inspectorTab === "files"} label="Files" onClick={() => setInspectorTab("files")} tab="files" />
              <InspectorTabButton active={inspectorTab === "versions"} label="Versions" onClick={() => setInspectorTab("versions")} tab="versions" />
              <InspectorTabButton active={inspectorTab === "activity"} label="Activity" onClick={() => setInspectorTab("activity")} tab="activity" />
              {comparison === null ? null : (
                <InspectorTabButton active={inspectorTab === "compare"} label="Compare" onClick={() => setInspectorTab("compare")} tab="compare" />
              )}
            </div>
            <IconButton
              keyShortcuts="]"
              label="Close inspector"
              onClick={() => setInspectorOpen(false)}
              title="Close inspector (])"
            >
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={1.8} />
            </IconButton>
          </header>
          <div
            aria-labelledby={`review-inspector-tab-${inspectorTab}`}
            className="as-inspector__body"
            id="review-inspector-panel"
            role="tabpanel"
            // The panel scrolls on its own; keyboard users need a stop to scroll it.
            tabIndex={0}
          >
            {details === null || selectedVersion === null ? (
              projectEmpty || reviewTargetUnavailable ? null : (
                <InlineState description="Choose an artifact to see its comments and details." title="Nothing selected" />
              )
            ) : inspectorTab === "details" ? (
              <DetailsInspector
                canManage={canManageArtifacts}
                details={details}
                linkedArtifacts={session.capabilities.linkedArtifacts}
                onCapture={captureLinkedArtifact}
                onOpenLive={openLinkedArtifact}
                onTagsChange={changeTags}
                onTombstone={tombstoneArtifact}
                version={selectedVersion}
                versionCount={versions.length}
              />
            ) : inspectorTab === "comments" ? (
              <ReviewCommentsInspector
                canComment={canComment}
                canDeleteAny={canDeleteAnyComment}
                key={restoredDraftGeneration}
                principalId={session.principal.id}
                ref={commentsInspectorRef}
                session={inspectorComments}
                versionId={selectedVersionId}
              />
            ) : inspectorTab === "files" ? (
              <FilesInspector
                onSelect={selectManifestPath}
                selectedPath={selectedPath ?? selectedVersion.manifest.entryPath}
                version={selectedVersion}
              />
            ) : inspectorTab === "versions" ? (
              <VersionsInspector
                canManage={canManageArtifacts}
                comparisonLoading={comparisonLoading}
                currentVersionId={details.artifact.currentVersionId}
                onCompare={compareVersions}
                onMakeCurrent={makeVersionCurrent}
                onSelect={(versionId) => {
                  setDetailError(null);
                  setSelectedVersionId(versionId);
                  setSelectedPath(null);
                }}
                selectedVersionId={selectedVersionId}
                versions={versions}
              />
            ) : inspectorTab === "activity" ? (
              <ActivityInspector
                actions={actions}
                versions={versions}
                error={activityError}
                loading={activityLoading}
                nextCursor={actionNextCursor}
                onLoadMore={() => void loadActions(actionNextCursor)}
              />
            ) : (
              <ComparisonInspector comparison={comparison} error={comparisonError} />
            )}
          </div>
              </motion.aside>
            </motion.div>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function reviewDownload(
  projectId: string,
  artifactId: string | null,
  version: ArtifactVersion | null,
): ReviewDownload | null {
  if (artifactId === null || version === null) return null;
  const entries = version.manifest.entries;
  const onlyEntry = entries.length === 1 ? entries[0] : undefined;
  if (onlyEntry !== undefined) {
    return {
      href: api.versionFileUrl(
        projectId,
        artifactId,
        version.version.id,
        onlyEntry.path,
      ),
      title: `Download ${onlyEntry.path}`,
    };
  }
  return {
    href: api.versionArchiveUrl(projectId, artifactId, version.version.id),
    title: `Download ${entries.length} files as a ZIP`,
  };
}

function ReviewDownloadControl({
  className,
  download,
}: {
  readonly className: string;
  readonly download: ReviewDownload | null;
}) {
  if (download === null) {
    return (
      <button aria-label="Download" className={className} disabled type="button">
        <HugeiconsIcon aria-hidden="true" icon={Download04Icon} strokeWidth={1.8} />
        <span className="as-button__label">Download</span>
      </button>
    );
  }
  return (
    <a
      aria-label="Download"
      className={className}
      download
      href={download.href}
      title={download.title}
    >
      <HugeiconsIcon aria-hidden="true" icon={Download04Icon} strokeWidth={1.8} />
      <span className="as-button__label">Download</span>
    </a>
  );
}

const commentingModeDescription = "Click an element or select text to comment. Press Escape to read.";
const readingModeDescription = "Links and controls work normally. Select text, or turn commenting back on, to comment.";

/**
 * Switch between commenting on the document and using it. The visible label
 * says what the reader is doing and is the accessible name, even where a
 * narrow header hides it; the longer instructions are its description.
 */
function AnnotateModeToggle({
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
function ReviewMoreActions({
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

function DetailsInspector({
  canManage,
  details,
  linkedArtifacts,
  onCapture,
  onOpenLive,
  onTagsChange,
  onTombstone,
  version,
  versionCount,
}: {
  readonly canManage: boolean;
  readonly details: ArtifactDetails;
  readonly linkedArtifacts: boolean;
  readonly onCapture: () => Promise<void>;
  readonly onOpenLive: () => Promise<void>;
  readonly onTagsChange: (tags: readonly string[]) => Promise<void>;
  readonly onTombstone: () => Promise<boolean>;
  readonly version: ArtifactVersion;
  readonly versionCount: number;
}) {
  const linkedDriftDescription = details.sourceBinding === undefined
    ? null
    : sourceDriftDescription(details.sourceBinding.status, "captured");
  return (
    <div className="as-inspector-stack">
      <InspectorSection count={4} title="Artifact">
        <InspectorRow label="Name" title={details.artifact.name} value={details.artifact.name} />
        <InspectorRow
          label="Access"
          value={<AccessPill access={details.artifact.accessSetting} />}
        />
        <InspectorRow
          label="Version"
          value={versionLabel(
            version.version.number,
            versionCount,
            version.version.id === details.artifact.currentVersionId,
          )}
        />
        <InspectorRow label="Saved" title={formatTimestamp(version.version.createdAt)} value={formatTimestamp(version.version.createdAt)} />
      </InspectorSection>
      <TagsInspector
        artifact={details.artifact}
        key={details.artifact.id}
        onChange={onTagsChange}
      />
      {details.sourceBinding === undefined ? null : (
        <InspectorSection count={2} title="Linked source">
          <InspectorRow label="State" value={sourceFreshnessLabel(details.sourceBinding.status)} />
          <InspectorRow label="File" mono value={details.sourceBinding.path} />
          {linkedDriftDescription === null ? null : (
            <p className="as-inspector-empty">{linkedDriftDescription}</p>
          )}
          <div className="as-inspector-actions">
            {canManage && details.sourceBinding.status !== "in-sync" ? (
              <button className="as-button as-button--primary" onClick={() => void onCapture()} type="button">
                Capture current file
              </button>
            ) : null}
            {linkedArtifacts && details.links.live !== undefined ? (
              <button className="as-button" onClick={() => void onOpenLive()} type="button">
                Open live file
              </button>
            ) : null}
          </div>
        </InspectorSection>
      )}
      <section className="as-inspector-section as-inspector-technical">
        <details>
          <summary>Technical details</summary>
          <div className="as-inspector-section__body">
            <InspectorRow label="Created" title={formatTimestamp(details.artifact.createdAt)} value={formatTimestamp(details.artifact.createdAt)} />
            <InspectorRow label="Artifact ID" mono title={details.artifact.id} value={details.artifact.id} />
            <InspectorRow label="Project ID" mono title={details.artifact.projectId} value={details.artifact.projectId} />
            <InspectorRow label="Version ID" mono title={version.version.id} value={version.version.id} />
            <InspectorRow label="Entry file" mono title={version.manifest.entryPath} value={version.manifest.entryPath} />
            <InspectorRow label="Routing" title={version.version.routingMode} value={version.version.routingMode} />
          </div>
        </details>
      </section>
      {canManage ? (
        <InspectorSection count={0} title="Danger zone">
          <TombstoneArtifactControl artifact={details.artifact} onConfirm={onTombstone} />
        </InspectorSection>
      ) : null}
    </div>
  );
}

function TagsInspector({
  artifact,
  onChange,
}: {
  readonly artifact: ArtifactDetails["artifact"];
  readonly onChange: (tags: readonly string[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [pending, setPending] = useState(false);
  const [value, setValue] = useState(artifact.tags.join(", "));

  useEffect(() => {
    if (!editing) setValue(artifact.tags.join(", "));
  }, [artifact.tags, editing]);

  const cancel = (): void => {
    setEditing(false);
    setError(null);
    setValue(artifact.tags.join(", "));
  };
  const save = async (): Promise<void> => {
    setPending(true);
    setError(null);
    try {
      await onChange(
        value.split(",").map((tag) => tag.trim()).filter((tag) => tag !== ""),
      );
      setEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error("Tag update failed."));
    } finally {
      setPending(false);
    }
  };

  return (
    <InspectorSection
      action={editing ? null : (
        <button
          className="as-inspector-section__action"
          onClick={() => setEditing(true)}
          type="button"
        >
          Edit tags
        </button>
      )}
      count={artifact.tags.length}
      title="Tags"
    >
      {editing ? (
        <form
          className="as-tag-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="as-visually-hidden" htmlFor={`review-tags-${artifact.id}`}>
            Tags
          </label>
          <input
            autoFocus
            disabled={pending}
            id={`review-tags-${artifact.id}`}
            onChange={(event) => setValue(event.currentTarget.value)}
            placeholder="prototype, approved"
            value={value}
          />
          <p>Separate tags with commas. Saving replaces the complete set.</p>
          {error === null ? null : (
            <p className="as-tag-editor__error" role="alert">{failureMessage(error)}</p>
          )}
          <div className="as-tag-editor__actions">
            <button className="as-button as-button--primary" disabled={pending} type="submit">
              {pending ? "Saving…" : "Save tags"}
            </button>
            <button className="as-button" disabled={pending} onClick={cancel} type="button">
              Cancel
            </button>
          </div>
        </form>
      ) : artifact.tags.length === 0 ? (
        <p className="as-inspector-empty">No tags on this artifact.</p>
      ) : artifact.tags.map((tag) => (
        <span className="as-tag" key={tag}>{tag}</span>
      ))}
    </InspectorSection>
  );
}

function FilesInspector({
  onSelect,
  selectedPath,
  version,
}: {
  readonly onSelect: (path: string) => void;
  readonly selectedPath: string;
  readonly version: ArtifactVersion;
}) {
  return (
    <div className="as-inspector-stack">
      <InspectorSection count={version.manifest.entries.length} title="Files in this version">
        <ol className="as-file-list">
          {version.manifest.entries.map((entry) => (
            <li key={entry.path}>
              <button
                aria-current={selectedPath === entry.path ? "true" : undefined}
                data-selected={selectedPath === entry.path}
                onClick={() => onSelect(entry.path)}
                type="button"
              >
                <span className="as-file-list__icon"><HugeiconsIcon icon={File01Icon} strokeWidth={1.8} /></span>
                <span className="as-file-list__identity">
                  <code>{entry.path}</code>
                  <small>{entry.mediaType}</small>
                </span>
                <span className="as-file-list__size">{formatBytes(entry.size)}</span>
              </button>
            </li>
          ))}
        </ol>
      </InspectorSection>
    </div>
  );
}

function VersionsInspector({
  canManage,
  comparisonLoading,
  currentVersionId,
  onCompare,
  onMakeCurrent,
  onSelect,
  selectedVersionId,
  versions,
}: {
  readonly canManage: boolean;
  readonly comparisonLoading: boolean;
  readonly currentVersionId: string;
  readonly onCompare: (fromVersionId: string, toVersionId: string) => Promise<void>;
  readonly onMakeCurrent: (
    versionId: string,
    expectedCurrentVersionId: string,
  ) => Promise<boolean>;
  readonly onSelect: (versionId: string) => void;
  readonly selectedVersionId: string | null;
  readonly versions: readonly VersionListItem[];
}) {
  const [fromVersionId, setFromVersionId] = useState(
    versions.at(-1)?.version.id ?? currentVersionId,
  );
  const [toVersionId, setToVersionId] = useState(currentVersionId);
  return (
    <div className="as-inspector-stack">
      {versions.length < 2 ? null : (
        <InspectorSection count={2} title="Compare versions">
          <form
            className="as-compare-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onCompare(fromVersionId, toVersionId);
            }}
          >
            <label>
              <span>From</span>
              <select onChange={(event) => setFromVersionId(event.currentTarget.value)} value={fromVersionId}>
                {versions.map(({version}) => <option key={version.id} value={version.id}>Version {version.number}</option>)}
              </select>
            </label>
            <label>
              <span>To</span>
              <select onChange={(event) => setToVersionId(event.currentTarget.value)} value={toVersionId}>
                {versions.map(({version}) => <option key={version.id} value={version.id}>Version {version.number}</option>)}
              </select>
            </label>
            <button className="as-button" disabled={comparisonLoading || fromVersionId === toVersionId} type="submit">
              {comparisonLoading ? "Comparing…" : "Compare"}
            </button>
          </form>
        </InspectorSection>
      )}
      <InspectorSection count={versions.length} title="History">
        <ol className="as-version-list">
          {versions.map(({version}) => (
            <li key={version.id}>
              <div className="as-version-list__row">
                <button
                  aria-current={selectedVersionId === version.id ? "true" : undefined}
                  className="as-version-list__select"
                  data-selected={selectedVersionId === version.id}
                  onClick={() => onSelect(version.id)}
                  type="button"
                >
                  <span>
                    <strong>Version {version.number}</strong>
                    <time dateTime={version.createdAt}>{formatTimestamp(version.createdAt)}</time>
                  </span>
                  {version.id === currentVersionId ? (
                    <span className="as-version-list__state">current</span>
                  ) : null}
                </button>
                {!canManage || version.id === currentVersionId ? null : (
                  <MakeCurrentControl
                    expectedCurrentVersionId={currentVersionId}
                    onConfirm={onMakeCurrent}
                    version={version}
                  />
                )}
              </div>
            </li>
          ))}
        </ol>
      </InspectorSection>
    </div>
  );
}

function ActivityInspector({
  actions,
  error,
  loading,
  nextCursor,
  onLoadMore,
  versions,
}: {
  readonly actions: readonly ArtifactAction[];
  readonly error: Error | null;
  readonly loading: boolean;
  readonly nextCursor: string | null;
  readonly onLoadMore: () => void;
  readonly versions: readonly VersionListItem[];
}) {
  const versionNumbers = new Map(versions.map(({version}) => [version.id, version.number]));
  return (
    <div className="as-inspector-stack">
      <InspectorSection count={actions.length} title="Activity">
        {error === null ? null : <p className="as-inspector-error" role="alert">{failureMessage(error)}</p>}
        {actions.length === 0 && loading ? <p className="as-inspector-empty">Loading activity…</p> : null}
        {actions.length === 0 && !loading ? <p className="as-inspector-empty">No activity recorded.</p> : null}
        <ol className="as-activity-list">
          {actions.map((action) => (
            <li key={action.id}>
              <strong>{actionLabel(action.action, versionNumbers.get(action.versionId) ?? null)}</strong>
              <span className="as-activity-list__meta">
                <time dateTime={action.createdAt}>{formatTimestamp(action.createdAt)}</time>
                {/* Names are not available to the client; the actor stays a short ID. */}
                <span>by <code title={action.principalId}>{shortPrincipalId(action.principalId)}</code></span>
              </span>
            </li>
          ))}
        </ol>
        {nextCursor === null ? null : (
          <button className="as-button" disabled={loading} onClick={onLoadMore} type="button">
            {loading ? "Loading…" : "Load more"}
          </button>
        )}
      </InspectorSection>
    </div>
  );
}

/** At most this many lines of each side of a change region are drawn. */
const comparedLineLimit = 40;

function ComparisonInspector({
  comparison,
  error,
}: {
  readonly comparison: ArtifactComparison | null;
  readonly error: Error | null;
}) {
  if (error !== null) return <InlineState description={failureMessage(error)} title="Comparison unavailable" />;
  if (comparison === null) return <InlineState description="Choose two versions in Versions." title="No comparison" />;
  const otherEntries = [
    ...comparison.added.map((entry) => ({kind: "Added", path: entry.path})),
    ...comparison.removed.map((entry) => ({kind: "Removed", path: entry.path})),
    ...comparison.renamed.map((entry) => ({kind: "Renamed", path: `${entry.from.path} → ${entry.to.path}`})),
  ];
  const summary = [
    [comparison.changed.length, "changed"],
    [comparison.added.length, "added"],
    [comparison.removed.length, "removed"],
    [comparison.renamed.length, "renamed"],
    [comparison.unchangedCount, "unchanged"],
  ] as const;
  return (
    <div className="as-inspector-stack">
      <InspectorSection count={2} title={`Version ${comparison.from.number} → ${comparison.to.number}`}>
        <div className="as-comparison-summary">
          {summary.filter(([count]) => count > 0).map(([count, label]) => (
            <span key={label}>{count} {count === 1 ? "file" : "files"} {label}</span>
          ))}
        </div>
      </InspectorSection>
      <InspectorSection count={comparison.changed.length} title="Changed files">
        {comparison.changed.length === 0 && otherEntries.length === 0 ? (
          <p className="as-inspector-empty">These versions have the same files.</p>
        ) : null}
        {comparison.changed.map((file) => (
          <ComparedFileChange
            file={file}
            fromNumber={comparison.from.number}
            key={file.after.path}
            toNumber={comparison.to.number}
          />
        ))}
        {otherEntries.length === 0 ? null : (
          <ol className="as-comparison-list">
            {otherEntries.map((entry) => (
              <li key={`${entry.kind}-${entry.path}`}><span>{entry.kind}</span><code>{entry.path}</code></li>
            ))}
          </ol>
        )}
      </InspectorSection>
    </div>
  );
}

/** One changed file: its changed lines before and after, or why they are not shown. */
function ComparedFileChange({
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

function TombstoneArtifactControl({
  artifact,
  onConfirm,
}: {
  readonly artifact: ArtifactDetails["artifact"];
  readonly onConfirm: () => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const confirm = async (): Promise<void> => {
    if (value !== artifact.name) return;
    setPending(true);
    const removed = await onConfirm();
    setPending(false);
    if (removed) setOpen(false);
  };
  return (
    <Dialog.Root onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) setValue("");
    }} open={open}>
      <Dialog.Trigger className="as-button as-button--danger">Delete artifact</Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="as-confirm-dialog__backdrop" />
        <Dialog.Popup className="as-confirm-dialog">
          <Dialog.Title>Delete {artifact.name}?</Dialog.Title>
          <Dialog.Description>
            This removes the artifact from normal use. Its saved versions are kept. Type the artifact name to confirm.
          </Dialog.Description>
          <label>
            <span className="as-visually-hidden">Artifact name</span>
            <input autoFocus onChange={(event) => setValue(event.currentTarget.value)} value={value} />
          </label>
          <div className="as-confirm-dialog__actions">
            <Dialog.Close className="as-button">Cancel</Dialog.Close>
            <button className="as-button as-button--danger" disabled={pending || value !== artifact.name} onClick={() => void confirm()} type="button">
              {pending ? "Deleting…" : "Delete artifact"}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function MakeCurrentControl({
  expectedCurrentVersionId,
  onConfirm,
  version,
}: {
  readonly expectedCurrentVersionId: string;
  readonly onConfirm: (
    versionId: string,
    expectedCurrentVersionId: string,
  ) => Promise<boolean>;
  readonly version: Version;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const confirm = async (): Promise<void> => {
    setPending(true);
    await onConfirm(version.id, expectedCurrentVersionId);
    setPending(false);
    setOpen(false);
  };
  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Trigger className="as-version-list__make-current">
        Make current
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="as-confirm-dialog__backdrop" />
        <Dialog.Popup className="as-confirm-dialog">
          <Dialog.Title>Make Version {version.number} current?</Dialog.Title>
          <Dialog.Description>
            The stable artifact link will point to Version {version.number}. No saved version is changed or duplicated.
          </Dialog.Description>
          <div className="as-confirm-dialog__actions">
            <Dialog.Close className="as-button" disabled={pending}>Cancel</Dialog.Close>
            <button
              className="as-button as-button--primary"
              disabled={pending}
              onClick={() => void confirm()}
              type="button"
            >
              {pending ? "Making current…" : "Make current"}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InspectorSection({
  action,
  children,
  count,
  title,
}: {
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
  readonly count: number;
  readonly title: string;
}) {
  return (
    <section className="as-inspector-section">
      <header>
        <h2>{title}</h2>
        <span>{count}</span>
        {action}
      </header>
      <div className="as-inspector-section__body">{children}</div>
    </section>
  );
}

function InspectorRow({
  label,
  mono = false,
  title,
  value,
}: {
  readonly label: string;
  readonly mono?: boolean;
  readonly title?: string;
  readonly value: ReactNode;
}) {
  return (
    <dl className="as-inspector-row">
      <dt>{label}</dt>
      <dd
        className={mono ? "as-mono" : undefined}
        title={title}
      >
        {value}
      </dd>
    </dl>
  );
}

function InspectorTabButton({
  active,
  count,
  countLabel,
  label,
  onClick,
  tab,
}: {
  readonly active: boolean;
  readonly count?: number;
  /** What the count counts, as a tooltip; the badge reads "N open". */
  readonly countLabel?: string;
  readonly label: string;
  readonly onClick: () => void;
  readonly tab: InspectorTab;
}) {
  return (
    <button
      aria-controls="review-inspector-panel"
      aria-selected={active}
      className="as-tab"
      data-active={active}
      id={`review-inspector-tab-${tab}`}
      onClick={onClick}
      role="tab"
      // Roving focus: the tab list is one stop; arrows, Home and End move within it.
      tabIndex={active ? 0 : -1}
      type="button"
    >
      {label}
      {count === undefined || count === 0 ? null : (
        <span title={countLabel}>
          {count}
          {countLabel === undefined ? null : <span className="as-visually-hidden"> open</span>}
        </span>
      )}
    </button>
  );
}

function IconButton({
  active,
  children,
  disabled = false,
  keyShortcuts,
  label,
  onClick,
  ref,
  title,
}: {
  readonly active?: boolean;
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly keyShortcuts?: string;
  readonly label: string;
  readonly onClick: () => void;
  readonly ref?: React.Ref<HTMLButtonElement>;
  readonly title?: string;
}) {
  return (
    <button
      aria-keyshortcuts={keyShortcuts}
      aria-label={label}
      aria-pressed={active}
      className="as-icon-button"
      data-active={active}
      disabled={disabled}
      onClick={onClick}
      ref={ref}
      title={title ?? label}
      type="button"
    >
      {children}
    </button>
  );
}

function AccessPill({access}: {readonly access: ArtifactDetails["artifact"]["accessSetting"]}) {
  return (
    <span className="as-pill" data-access={access}>
      {access === "public_link" ? "public" : "private"}
    </span>
  );
}

function PreviewWelcome({
  action,
  description = "Choose an artifact from the catalog to read it here.",
  title = "Select an artifact",
}: {
  readonly action?: ReactNode;
  readonly description?: string;
  readonly title?: string;
}) {
  return (
    <div className="as-preview-welcome">
      <h2>{title}</h2>
      <small>{description}</small>
      {action}
    </div>
  );
}

/** The one empty state of a project with nothing published: how to publish here. */
function EmptyProjectState({projectId}: {readonly projectId: string}) {
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

function InlineState({
  description,
  title,
  tone = "neutral",
}: {
  readonly description: string;
  readonly title: string;
  readonly tone?: "error" | "neutral";
}) {
  return (
    <div className="as-inline-state" data-tone={tone} role="status">
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}

function ReviewGate({
  action,
  description,
  title,
}: {
  readonly action?: React.ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <main className="as-gate">
      <section>
        <span aria-hidden="true" className="as-gate__mark">A</span>
        <p>Artifact Server</p>
        <h1>{title}</h1>
        <small>{description}</small>
        {action}
      </section>
    </main>
  );
}

/** A saved choice wins; a first visit follows the OS and falls back to light. */
export function initialReviewTheme(): ReviewTheme {
  const saved = window.localStorage.getItem("artifact-review-theme");
  if (saved === "dawn" || saved === "moon") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "moon" : "dawn";
}

/** Whether a side panel currently overlays the artifact instead of sitting beside it. */
function panelOverlays(query: typeof catalogOverlayQuery | typeof inspectorOverlayQuery): boolean {
  return window.matchMedia(query).matches;
}

/** A link that names an artifact opens on the document where the catalog would cover it. */
function readInitialCatalogOpen(location: ReviewLocation): boolean {
  return location.artifactId === null || !panelOverlays(catalogOverlayQuery);
}

function readInitialInspectorOpen(): boolean {
  return !panelOverlays(inspectorOverlayQuery);
}

function readReviewLocation(): ReviewLocation {
  const search = new URLSearchParams(window.location.search);
  return {
    artifactId: search.get("artifact"),
    path: search.get("path"),
    projectId: search.get("project"),
    versionId: search.get("version"),
    view: search.get("view") === "focus" ? "focus" : null,
  };
}

function reviewHref(location: ReviewLocation): string {
  const search = new URLSearchParams();
  if (location.projectId !== null && location.projectId !== "") {
    search.set("project", location.projectId);
  }
  if (location.artifactId !== null) search.set("artifact", location.artifactId);
  if (location.versionId !== null) search.set("version", location.versionId);
  if (location.path !== null) search.set("path", location.path);
  if (location.view !== null) search.set("view", location.view);
  return search.size === 0 ? "/review" : `/review?${search}`;
}

function reviewPreviewKind(
  version: ArtifactVersion | null,
  selectedPath: string | null,
): "html" | "markdown" | "media" | "other" {
  if (version === null) return "other";
  const path = selectedPath ?? version.manifest.entryPath;
  const mediaType = version.manifest.entries
    .find((entry) => entry.path === path)
    ?.mediaType.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType === "text/html") return "html";
  if (mediaType === "text/markdown" || (path.toLowerCase().endsWith(".md") && mediaType === "text/plain")) return "markdown";
  if (mediaType?.startsWith("image/") || mediaType?.startsWith("video/")) {
    return "media";
  }
  return "other";
}

/** A principal ID short enough for a row; the full ID stays in its tooltip. */
function shortPrincipalId(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 16)}…`;
}
