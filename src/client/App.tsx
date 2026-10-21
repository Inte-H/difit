import {
  Columns,
  AlignLeft,
  Settings,
  PanelLeftClose,
  PanelLeft,
  PanelRight,
  PanelRightClose,
  Keyboard,
  GitCommitHorizontal,
} from 'lucide-react';
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';

import {
  type DiffCommentThread,
  type DiffResponse,
  type DiffSelection,
  type DiffViewMode,
  type DirectEditRequest,
  type DirectEditResponse,
  type ReviewDecision,
  type DiffSide,
  type LineNumber,
  type CommentThread,
  type RevisionsResponse,
  type ReviewView,
  type ReviewViewAction,
} from '../types/diff';
import { DEFAULT_DIFF_VIEW_MODE, normalizeDiffViewMode } from '../utils/diffMode';
import { mergeCommentThreads } from '../utils/commentImports';
import {
  bindingForView,
  createDiffSelection,
  diffSelectionsEqual,
  fixupCommitOf,
  getDiffSelectionKey,
  isCommitHash,
  isViewOfReview,
  madeViewElsewhere,
  normalizeBaseMode,
  reviewViewShown,
  selectReviewView,
  selectionAtCommit,
} from '../utils/diffSelection';
import { countOpenThreadsByCommit } from '../utils/openCommentCounts';
import {
  commentPanelStatus,
  isThreadDeleted,
  isThreadResolved,
  mergeReviewDecisions,
  selectOpenThreads,
  type CommentPanelStatus,
} from '../utils/reviewDecisions';

import { Checkbox } from './components/Checkbox';
import { CommentsDropdown, type CopyAllNotice } from './components/CommentsDropdown';
import {
  CommentsPanel,
  type CommentsPanelFilter,
  type CommentsPanelHandle,
} from './components/CommentsPanel';
import { DiffQuickMenu } from './components/DiffQuickMenu';
import { DiffViewer } from './components/DiffViewer';
import { FileChips } from './components/FileChips';
import { CommitList, ShownCommits } from './components/CommitList';
import { FileList } from './components/FileList';
import { GitHubIcon } from './components/GitHubIcon';
import { HelpModal } from './components/HelpModal';
import { Logo } from './components/Logo';
import { NewerTargetButton } from './components/NewerTargetButton';
import { ReloadButton } from './components/ReloadButton';
import { RevisionDetailModal } from './components/RevisionDetailModal';
import { SettingsModal } from './components/SettingsModal';
import { SparkleAnimation } from './components/SparkleAnimation';
import { SymbolPeekChip } from './components/SymbolPeekChip';
import { SymbolPeekModal } from './components/SymbolPeekModal';
import {
  type DirectEditControls,
  type DirectEditFailure,
  recordWithPatchId,
  type FixupOverlayState,
} from './contexts/FixupOverlayContext';
import { PickedThreadProvider } from './contexts/PickedThreadContext';
import { WordHighlightProvider } from './contexts/WordHighlightContext';
import { useAppearanceSettings } from './hooks/useAppearanceSettings';
import { useDiffComments } from './hooks/useDiffComments';
import { useExpandedLines, type MergedChunk } from './hooks/useExpandedLines';
import { useFileWatch } from './hooks/useFileWatch';
import { useKeyboardNavigation } from './hooks/useKeyboardNavigation';
import { useChunkChangeKinds } from './hooks/useChunkChangeKinds';
import { useLazyDiffRendering } from './hooks/useLazyDiffRendering';
import {
  reviewTargetRestoredByHistory,
  useReviewTargetHistory,
} from './hooks/useReviewTargetHistory';
import { useScrollVisibleFile } from './hooks/useScrollVisibleFile';
import { useSymbolPeek } from './hooks/useSymbolPeek';
import { useViewedFiles } from './hooks/useViewedFiles';
import { useThreadFixups } from './hooks/useThreadFixups';
import { useViewport } from './hooks/useViewport';
import { fetchClientSettings, saveClientSettings } from './services/userSettings';
import { hasMultipleCommentAuthors } from './utils/commentAuthors';
import { copyTextToClipboard } from './utils/clipboard';
import { getFileElementId } from './utils/domUtils';
import { findCommentPosition } from './utils/navigation/positionHelpers';
import { resolveEventSourceUrl } from './utils/eventSourceUrl';
import {
  EMPTY_MERGED_CHUNKS_STATE,
  buildMergedChunksState,
  getMergedChunksForVersion,
} from './utils/mergedChunks';
import { directEditFailureMessage } from './utils/directEdit';
import { fetchFixupTarget } from './utils/fixupTarget';
import { buildFileLineIndex, placeThread } from './utils/outdatedComments';

const EMPTY_COMMENT_THREADS: CommentThread[] = [];
const EMPTY_MERGED_CHUNKS: MergedChunk[] = [];
const DIFF_VIEW_MODE_STORAGE_KEY = 'difit.diffViewMode';
const SIDEBAR_WIDTH_STORAGE_KEY = 'difit.sidebarWidth';
const SIDEBAR_OPEN_STORAGE_KEY = 'difit.sidebarOpen';
const COMMIT_LIST_HEIGHT_STORAGE_KEY = 'difit.commitListHeight';
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 600;
const SIDEBAR_DEFAULT_WIDTH = 280;
const COMMENTS_PANEL_OPEN_STORAGE_KEY = 'difit.commentsPanelOpen';
const COMMENTS_PANEL_WIDTH_STORAGE_KEY = 'difit.commentsPanelWidth';
const COMMENTS_PANEL_MIN_WIDTH = 240;
const COMMENTS_PANEL_MAX_WIDTH = 600;
const COMMENTS_PANEL_DEFAULT_WIDTH = 320;

const parseDiffViewMode = (value: unknown): DiffViewMode | null => {
  switch (value) {
    case 'split':
    case 'side-by-side':
    case 'unified':
    case 'inline':
      return normalizeDiffViewMode(value);
    default:
      return null;
  }
};

const getStoredDiffViewMode = (): DiffViewMode | null => {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return parseDiffViewMode(window.localStorage.getItem(DIFF_VIEW_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
};

const getInitialDiffViewMode = () => getStoredDiffViewMode() ?? DEFAULT_DIFF_VIEW_MODE;

const clampSidebarWidth = (width: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width));

const getStoredWidth = (key: string, clamp: (width: number) => number): number | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = window.localStorage.getItem(key);
  if (!stored) {
    return null;
  }
  const parsed = Number.parseInt(stored, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return clamp(parsed);
};

const getStoredSidebarWidth = () => getStoredWidth(SIDEBAR_WIDTH_STORAGE_KEY, clampSidebarWidth);

const getInitialSidebarWidth = () => getStoredSidebarWidth() ?? SIDEBAR_DEFAULT_WIDTH;

const getStoredBoolean = (key: string): boolean | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = window.localStorage.getItem(key);
  if (stored === 'true') {
    return true;
  }
  if (stored === 'false') {
    return false;
  }
  return null;
};

const getStoredSidebarOpen = () => getStoredBoolean(SIDEBAR_OPEN_STORAGE_KEY);

const getInitialFileTreeOpen = () => getStoredSidebarOpen() ?? true;

const parseCommitListHeight = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

const getStoredCommitListHeight = (): number | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  const stored = window.localStorage.getItem(COMMIT_LIST_HEIGHT_STORAGE_KEY);
  return stored ? parseCommitListHeight(Number.parseInt(stored, 10)) : null;
};

const storeCommitListHeight = (height: number) => {
  try {
    window.localStorage.setItem(COMMIT_LIST_HEIGHT_STORAGE_KEY, String(height));
  } catch {}
};

const clampCommentsPanelWidth = (width: number) =>
  Math.min(COMMENTS_PANEL_MAX_WIDTH, Math.max(COMMENTS_PANEL_MIN_WIDTH, width));

const getStoredCommentsPanelWidth = () =>
  getStoredWidth(COMMENTS_PANEL_WIDTH_STORAGE_KEY, clampCommentsPanelWidth);

const getInitialCommentsPanelWidth = () =>
  getStoredCommentsPanelWidth() ?? COMMENTS_PANEL_DEFAULT_WIDTH;

const getStoredCommentsPanelOpen = () => getStoredBoolean(COMMENTS_PANEL_OPEN_STORAGE_KEY);

const getInitialCommentsPanelOpen = () => getStoredCommentsPanelOpen() ?? false;

function App() {
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [diffDataVersion, setDiffDataVersion] = useState(0);
  const [diffMode, setDiffMode] = useState<DiffViewMode>(getInitialDiffViewMode);
  const [ignoreWhitespace, setIgnoreWhitespace] = useState(true);
  const [foldCommentChanges, setFoldCommentChanges] = useState(true);
  const [showResolvedThreads, setShowResolvedThreads] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copyAllNotice, setCopyAllNotice] = useState<CopyAllNotice | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const [commitListHeight, setCommitListHeight] = useState(getStoredCommitListHeight);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFileTreeOpen, setIsFileTreeOpen] = useState(getInitialFileTreeOpen);
  // The phone drawer covers the diff, so it starts closed and does not touch the saved PC preference.
  const [isFileDrawerOpen, setIsFileDrawerOpen] = useState(false);
  const [isCommitDrawerOpen, setIsCommitDrawerOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showSparkles, setShowSparkles] = useState(false);
  const [hasTriggeredSparkles, setHasTriggeredSparkles] = useState(false);
  const [isCommentsPanelOpen, setIsCommentsPanelOpen] = useState(getInitialCommentsPanelOpen);
  const [commentsPanelWidth, setCommentsPanelWidth] = useState(getInitialCommentsPanelWidth);
  const [commentsPanelFilter, setCommentsPanelFilter] = useState<CommentsPanelFilter>('remaining');
  const [commentsPanelFocusRequest, setCommentsPanelFocusRequest] = useState(0);
  const commentsPanelRef = useRef<CommentsPanelHandle>(null);
  const [pickedThreadId, setPickedThreadId] = useState<string | null>(null);
  const [isRevisionModalOpen, setIsRevisionModalOpen] = useState(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const collapsedInitializedRef = useRef(false);
  const diffScrollContainerRef = useRef<HTMLElement | null>(null);

  // Revision selector state
  const [revisionOptions, setRevisionOptions] = useState<RevisionsResponse | null>(null);
  const [restoredReviewTarget] = useState(reviewTargetRestoredByHistory);
  const [selectedRevision, setSelectedRevision] = useState<DiffSelection>(
    restoredReviewTarget ?? createDiffSelection('', ''),
  );
  const [resolvedBaseRevision, setResolvedBaseRevision] = useState<string>('');
  const [resolvedTargetRevision, setResolvedTargetRevision] = useState<string>('');
  const hasUserSelectedRevisionRef = useRef(restoredReviewTarget !== null);
  const currentRequestedBaseModeRef = useRef(selectedRevision.baseMode);
  currentRequestedBaseModeRef.current = diffData?.requestedBaseMode ?? selectedRevision.baseMode;
  const selectedRevisionRef = useRef(selectedRevision);
  selectedRevisionRef.current = selectedRevision;
  const diffRequestIdRef = useRef(0);
  const pendingCommentNavigationRef = useRef<string | null>(null);
  const activeDiffAbortControllerRef = useRef<AbortController | null>(null);
  const resolvedSelection = useMemo<DiffSelection | null>(() => {
    if (!diffData?.baseCommitish || !diffData?.targetCommitish) {
      return null;
    }

    return createDiffSelection(
      diffData.baseCommitish,
      diffData.targetCommitish,
      diffData.requestedBaseMode,
    );
  }, [diffData]);
  const resolvedSelectionKey = useMemo(() => {
    if (!resolvedSelection) {
      return null;
    }

    return getDiffSelectionKey(resolvedSelection);
  }, [resolvedSelection]);
  const review = diffData?.review;
  const commentSelection = review?.selection ?? resolvedSelection;
  const commentSelectionKey = commentSelection ? getDiffSelectionKey(commentSelection) : null;
  const showsPartOfReview =
    review !== undefined &&
    resolvedSelection !== null &&
    !diffSelectionsEqual(resolvedSelection, review.selection);
  const shownView: ReviewView = useMemo(
    () =>
      (review && resolvedSelection && reviewViewShown(resolvedSelection, review)) || {
        kind: 'all',
      },
    [review, resolvedSelection],
  );
  const [viewAnchor, setViewAnchor] = useState<{ view: ReviewView; sha: string | null } | null>(
    null,
  );
  const shownAnchor =
    viewAnchor && JSON.stringify(viewAnchor.view) === JSON.stringify(shownView)
      ? viewAnchor.sha
      : null;
  const [rangePick, setRangePick] = useState<{ view: ReviewView; sha: string } | null>(null);
  const rangeStart =
    rangePick && JSON.stringify(rangePick.view) === JSON.stringify(shownView)
      ? rangePick.sha
      : undefined;
  const takesComments = !showsPartOfReview || shownView.kind !== 'all';

  const { settings, updateSettings } = useAppearanceSettings();
  const { isMobile, isDesktop } = useViewport();
  const isFileTreeShown = isMobile ? isFileDrawerOpen : isFileTreeOpen;
  const hasCommitList = review !== undefined && review.commits.length > 1;
  const showsCommitList = !isMobile && hasCommitList;

  // New diff-aware comment system
  const {
    hasLoadedComments,
    threads: storedThreads,
    decisions,
    replaceThreads,
    mergeDecisions,
    recordDecision,
    undoApproval,
    addThread,
    replyToThread,
    removeMessage,
    updateMessage,
    clearAllComments,
    generateAllCommentsPrompt,
  } = useDiffComments(
    commentSelection?.baseCommitish,
    commentSelection?.targetCommitish,
    review ? undefined : diffData?.commit, // Using commit as currentCommitHash
    undefined, // branchToHash map - could be populated from server data
    diffData?.repositoryId, // Repository identifier for storage isolation
    commentSelection?.baseMode,
  );
  const threads = useMemo(
    () => storedThreads.filter((thread) => !isThreadDeleted(thread.id, decisions)),
    [storedThreads, decisions],
  );
  const decisionsRef = useRef(decisions);
  decisionsRef.current = decisions;
  const addThreadRef = useRef(addThread);
  addThreadRef.current = addThread;

  const showMobileCommentsBar = isMobile && threads.length > 0;
  const commentsContextKey = useMemo(() => {
    if (!commentSelectionKey) {
      return null;
    }

    return `${diffData?.repositoryId ?? 'default'}:${commentSelectionKey}`;
  }, [diffData?.repositoryId, commentSelectionKey]);
  const commentSessionQueryString = (() => {
    if (!commentSelection) {
      return null;
    }

    const params = new URLSearchParams({
      base: commentSelection.baseCommitish,
      target: commentSelection.targetCommitish,
    });
    if (commentSelection.baseMode === 'merge-base') {
      params.set('baseMode', commentSelection.baseMode);
    }

    return params.toString();
  })();
  const getCommentApiUrl = useCallback(
    (path: string) => {
      if (!commentSessionQueryString) {
        return path;
      }
      return `${path}?${commentSessionQueryString}`;
    },
    [commentSessionQueryString],
  );
  // Only a review pinned to a hash shows fixups; HEAD or a branch moves along with them.
  const targetCommit = useMemo(() => {
    const target = commentSelection?.targetCommitish;
    const requested = review?.requested.targetCommitish ?? diffData?.requestedTargetCommitish;
    return target && requested && isCommitHash(requested) ? target : null;
  }, [
    diffData?.requestedTargetCommitish,
    review?.requested.targetCommitish,
    commentSelection?.targetCommitish,
  ]);
  const [showFixupOverlay, setShowFixupOverlay] = useState(true);
  const [directEditCount, setDirectEditCount] = useState(0);
  const {
    fixupsByThread,
    newerTarget,
    loaded: fixupsLoaded,
  } = useThreadFixups(
    diffData && targetCommit ? getCommentApiUrl('/api/fixups') : null,
    diffDataVersion + directEditCount,
  );
  const openThreads = useMemo(
    () => selectOpenThreads(threads, fixupsByThread, decisions),
    [threads, fixupsByThread, decisions],
  );
  const openCountsByCommit = useMemo(
    () =>
      review && fixupsLoaded
        ? countOpenThreadsByCommit(threads, fixupsByThread, decisions, review)
        : undefined,
    [review, fixupsLoaded, threads, fixupsByThread, decisions],
  );
  const resolvedThreadIds = useMemo(
    () =>
      new Set(
        threads.filter((thread) => isThreadResolved(thread.id, decisions)).map(({ id }) => id),
      ),
    [threads, decisions],
  );
  if (resolvedThreadIds.size === 0 && !showResolvedThreads) setShowResolvedThreads(true);
  const commentPanelStatusById = useMemo(() => {
    const map = new Map<string, CommentPanelStatus>();
    threads.forEach((thread) => {
      const status = commentPanelStatus(thread, fixupsByThread.get(thread.id) ?? [], decisions);
      if (status) map.set(thread.id, status);
    });
    return map;
  }, [threads, fixupsByThread, decisions]);
  const resolveThread = useCallback(
    (threadId: string) => recordDecision(threadId, 'resolved', ''),
    [recordDecision],
  );
  const [bootstrappedCommentsKey, setBootstrappedCommentsKey] = useState<string | null>(null);
  const hasBootstrappedComments =
    commentsContextKey !== null && commentsContextKey === bootstrappedCommentsKey;
  const bootstrappingCommentsKeyRef = useRef<string | null>(null);
  const skipNextCommentSyncRef = useRef(false);
  // Last server comment version seen; echoed back as baseVersion so the server can detect concurrent writes.
  const serverCommentVersionRef = useRef<number | null>(null);
  const pendingBootstrapAfterLocalResetRef = useRef(false);

  useEffect(() => {
    if (commentsContextKey !== bootstrappedCommentsKey) {
      skipNextCommentSyncRef.current = false;
    }
  }, [bootstrappedCommentsKey, commentsContextKey]);

  const fetchServerComments = useCallback(async (): Promise<{
    threads: DiffCommentThread[];
    decisions: ReviewDecision[];
  }> => {
    const response = await fetch(getCommentApiUrl('/api/comments-json'));
    if (!response.ok) {
      throw new Error(`Failed to fetch comments: ${response.status} ${response.statusText}`);
    }

    const payload = (await response.json()) as {
      version?: number;
      threads?: DiffCommentThread[];
      decisions?: ReviewDecision[];
    };
    if (typeof payload.version === 'number') {
      serverCommentVersionRef.current = payload.version;
    }
    const decisions = Array.isArray(payload.decisions) ? payload.decisions : [];
    if (decisions.length > 0) {
      mergeDecisions(decisions);
    }
    return { threads: Array.isArray(payload.threads) ? payload.threads : [], decisions };
  }, [getCommentApiUrl, mergeDecisions]);

  const syncThreadsToServer = useCallback(
    async (nextThreads: DiffCommentThread[], nextDecisions?: ReviewDecision[]) => {
      const response = await fetch(getCommentApiUrl('/api/comments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threads: nextThreads,
          decisions: nextDecisions,
          baseVersion: serverCommentVersionRef.current ?? undefined,
        }),
      });
      if (!response.ok) {
        return;
      }

      const result = (await response.json()) as {
        version?: number;
        merged?: boolean;
        threads?: DiffCommentThread[];
        decisions?: ReviewDecision[];
      };
      if (typeof result.version === 'number') {
        serverCommentVersionRef.current = result.version;
      }
      // Server merged in a concurrent change; adopt it so we don't push a stale set back.
      if (result.merged && Array.isArray(result.threads)) {
        skipNextCommentSyncRef.current = true;
        replaceThreads(result.threads);
        if (Array.isArray(result.decisions)) {
          mergeDecisions(result.decisions);
        }
      }
    },
    [getCommentApiUrl, mergeDecisions, replaceThreads],
  );

  // Viewed files management
  const {
    viewedFiles,
    changedSinceViewedFiles,
    hasLoadedInitialViewedFiles,
    toggleFileViewed,
    setFilesViewed,
    clearViewedFiles,
  } = useViewedFiles(
    resolvedSelection?.baseCommitish,
    resolvedSelection?.targetCommitish,
    diffData?.commit,
    undefined,
    diffData?.files,
    diffData?.repositoryId, // Repository identifier for storage isolation
    settings.autoViewedPatterns,
    resolvedSelection?.baseMode,
  );

  // Reset initialization flag when diff context changes
  useEffect(() => {
    collapsedInitializedRef.current = false;
  }, [diffData?.repositoryId, resolvedSelectionKey, diffData?.commit]);

  // Initialize collapsed files from viewed files (only once per diff)
  useEffect(() => {
    if (!collapsedInitializedRef.current && hasLoadedInitialViewedFiles) {
      setCollapsedFiles(new Set(viewedFiles));
      collapsedInitializedRef.current = true;
    }
  }, [viewedFiles, hasLoadedInitialViewedFiles]);
  const {
    renderedFilePaths,
    ensureFileRendered,
    ensureFilesRenderedUpTo,
    registerLazyFileContainer,
    scrollFileIntoDiffContainer,
    isFileScrolledPastContainerTop,
  } = useLazyDiffRendering({
    diffData,
    diffScrollContainerRef,
    setDiffData,
  });
  useChunkChangeKinds({ diffData, renderedFilePaths, setDiffData });
  const scrollVisibleFileIndex = useScrollVisibleFile({
    diffScrollContainerRef,
    files: diffData?.files,
  });

  const toggleFileReviewed = useCallback(
    async (filePath: string) => {
      if (!diffData) return;

      const file = diffData.files.find((f) => f.path === filePath);
      if (!file) return;

      const wasViewed = viewedFiles.has(filePath);
      // Measure before the collapse re-renders: only re-anchor the header when
      // the user is scrolled past it (deep inside a long file), so the viewport
      // doesn't land in unrelated content after collapsing (#164). If the header
      // is already visible, stay stationary and let files below fill up (#402).
      const shouldScrollToHeader = !wasViewed && isFileScrolledPastContainerTop(filePath);
      await toggleFileViewed(filePath, file);

      // Update collapsed state based on viewed state
      setCollapsedFiles((prev) => {
        const newSet = new Set(prev);
        if (!wasViewed) {
          // Marking as viewed -> collapse the file
          newSet.add(filePath);
        } else {
          // Marking as not viewed -> expand the file
          newSet.delete(filePath);
        }
        return newSet;
      });

      if (shouldScrollToHeader) {
        setTimeout(() => {
          scrollFileIntoDiffContainer(filePath);
        }, 100);
      }
    },
    [
      diffData,
      isFileScrolledPastContainerTop,
      scrollFileIntoDiffContainer,
      toggleFileViewed,
      viewedFiles,
    ],
  );

  const toggleFolderReviewed = useCallback(
    async (folderPath: string, reviewed: boolean) => {
      if (!diffData) return;

      const folderFiles = diffData.files.filter((file) => file.path.startsWith(`${folderPath}/`));
      if (folderFiles.length === 0) return;

      await setFilesViewed(folderFiles, reviewed);

      // Keep the collapse state of every file in the folder in sync with its viewed state
      setCollapsedFiles((prev) => {
        const newSet = new Set(prev);
        folderFiles.forEach((file) => {
          if (reviewed) {
            newSet.add(file.path);
          } else {
            newSet.delete(file.path);
          }
        });
        return newSet;
      });
    },
    [diffData, setFilesViewed],
  );

  const toggleFileCollapsed = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  }, []);

  const toggleAllFilesCollapsed = useCallback(
    (shouldCollapse: boolean) => {
      if (!diffData) return;

      if (shouldCollapse) {
        // Collapse all files
        setCollapsedFiles(new Set(diffData.files.map((f) => f.path)));
      } else {
        // Expand all files
        setCollapsedFiles(new Set());
      }
    },
    [diffData],
  );

  const handleMobileFileSelected = useCallback(() => {
    setIsFileDrawerOpen(false);
  }, []);

  const handleDiffModeChange = useCallback((mode: DiffViewMode) => {
    setDiffMode(mode);
    try {
      window.localStorage.setItem(DIFF_VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    saveClientSettings({ diffViewMode: mode });
  }, []);

  // Lift expand state to App level so navigation and rendering share the same merged chunks
  const {
    isLoading: isExpandLoading,
    expandLines,
    expandAllBetweenChunks,
    prefetchFileContent,
    getMergedChunks,
    lastUpdatedAt,
  } = useExpandedLines({
    baseCommitish: diffData?.baseCommitish,
    targetCommitish: diffData?.targetCommitish,
    diffIdentity: diffDataVersion,
  });

  const symbolPeek = useSymbolPeek({
    base: diffData?.baseCommitish,
    target: diffData?.targetCommitish,
    enabled: diffData?.symbolSearchAvailable === true,
  });

  const getMergedChunksRef = useRef(getMergedChunks);
  useEffect(() => {
    getMergedChunksRef.current = getMergedChunks;
  }, [getMergedChunks]);

  const [mergedChunksState, setMergedChunksState] = useState(EMPTY_MERGED_CHUNKS_STATE);
  const filesByPath = useMemo(() => {
    const map = new Map<string, DiffResponse['files'][number]>();
    diffData?.files.forEach((file) => {
      map.set(file.path, file);
    });
    return map;
  }, [diffData]);

  // Recompute merged chunks for the current fetched diff only.
  useEffect(() => {
    if (!diffData) {
      setMergedChunksState(EMPTY_MERGED_CHUNKS_STATE);
      return;
    }

    setMergedChunksState(
      buildMergedChunksState(diffDataVersion, renderedFilePaths, filesByPath, (file) =>
        getMergedChunksRef.current(file),
      ),
    );
  }, [diffData, diffDataVersion, filesByPath, renderedFilePaths, lastUpdatedAt]);

  // Create files with merged chunks for keyboard navigation
  const navigableFiles = useMemo(() => {
    if (!diffData) return [];
    return diffData.files.map((file) => ({
      ...file,
      chunks:
        getMergedChunksForVersion(mergedChunksState, diffDataVersion, file.path) || file.chunks,
    }));
  }, [diffData, diffDataVersion, mergedChunksState]);

  const fileLineIndexByPath = useMemo(() => {
    const map = new Map<string, ReturnType<typeof buildFileLineIndex>>();
    navigableFiles.forEach((file) => {
      map.set(file.path, buildFileLineIndex(file));
    });
    return map;
  }, [navigableFiles]);

  const { normalizedThreads, hiddenThreadIds } = useMemo(() => {
    const hidden = new Set<string>();
    const placed = threads.map((thread): CommentThread => {
      const placement = placeThread(
        thread,
        { view: resolvedSelection, review, targetCommit },
        fileLineIndexByPath.get(thread.filePath),
      );
      if (placement.kind === 'hidden') hidden.add(thread.id);
      const madeView =
        review && resolvedSelection
          ? madeViewElsewhere(thread, resolvedSelection, review)
          : undefined;
      return {
        id: thread.id,
        file: thread.filePath,
        line: placement.line,
        isOutdated: placement.kind === 'stale',
        ...(placement.kind === 'stale' ? { outdatedReason: placement.reason } : {}),
        side: thread.position.side,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
        codeContent: thread.codeSnapshot?.content,
        anchorCommit: thread.codeSnapshot?.commit,
        messages: thread.messages,
        ...(thread.fixupTarget
          ? { fixupCommit: fixupCommitOf(thread.fixupTarget, review?.commits ?? []) }
          : {}),
        ...(madeView ? { madeView } : {}),
      };
    });
    return { normalizedThreads: placed, hiddenThreadIds: hidden };
  }, [threads, fileLineIndexByPath, targetCommit, resolvedSelection, review]);
  const drawnThreads = useMemo(
    () => normalizedThreads.filter((thread) => !hiddenThreadIds.has(thread.id)),
    [normalizedThreads, hiddenThreadIds],
  );
  const showAuthorBadges = useMemo(
    () => hasMultipleCommentAuthors(normalizedThreads.flatMap((thread) => thread.messages)),
    [normalizedThreads],
  );
  const unresolvedThreads = useMemo(
    () => drawnThreads.filter((thread) => !resolvedThreadIds.has(thread.id)),
    [drawnThreads, resolvedThreadIds],
  );
  const pickedThread = useMemo(
    () => normalizedThreads.find((thread) => thread.id === pickedThreadId) ?? null,
    [normalizedThreads, pickedThreadId],
  );
  const keptPickedThreadId =
    !showResolvedThreads && pickedThread && resolvedThreadIds.has(pickedThread.id)
      ? pickedThread.id
      : null;
  const threadsByFile = useMemo(() => {
    const map = new Map<string, CommentThread[]>();
    const shown = showResolvedThreads
      ? drawnThreads
      : keptPickedThreadId
        ? drawnThreads.filter(
            (thread) => !resolvedThreadIds.has(thread.id) || thread.id === keptPickedThreadId,
          )
        : unresolvedThreads;
    shown.forEach((thread) => {
      const entry = map.get(thread.file);
      if (entry) {
        entry.push(thread);
      } else {
        map.set(thread.file, [thread]);
      }
    });
    return map;
  }, [drawnThreads, unresolvedThreads, showResolvedThreads, keptPickedThreadId, resolvedThreadIds]);

  // State to trigger comment creation from keyboard
  const [commentTrigger, setCommentTrigger] = useState<{
    fileIndex: number;
    chunkIndex: number;
    lineIndex: number;
  } | null>(null);
  const fetchDiffDataRef = useRef<((selection?: DiffSelection) => Promise<void>) | null>(null);
  const handleWatchReload = useCallback(async () => {
    await fetchDiffDataRef.current?.();
  }, []);
  const handleCommentsChanged = useCallback(async () => {
    try {
      const { threads: serverThreads } = await fetchServerComments();
      skipNextCommentSyncRef.current = true;
      replaceThreads(serverThreads);
      if (commentsContextKey) {
        setBootstrappedCommentsKey(commentsContextKey);
      }
    } catch (commentsError) {
      console.error('Failed to refresh comments from server:', commentsError);
    }
  }, [commentsContextKey, fetchServerComments, replaceThreads]);

  // File watch for reload functionality - initialize with callback
  const { shouldReload, reload, watchState } = useFileWatch(
    handleWatchReload,
    handleCommentsChanged,
  );

  const openCommentsPanelWithKeys = useCallback(() => {
    setIsCommentsPanelOpen(true);
    setCommentsPanelFocusRequest((count) => count + 1);
  }, []);
  useEffect(() => {
    if (commentsPanelFocusRequest > 0) commentsPanelRef.current?.focus();
  }, [commentsPanelFocusRequest]);

  // Track which file the mouse is over so `v` works without a cursor
  const hoveredFileIndexRef = useRef<number | null>(null);
  const getHoveredFileIndex = useCallback(() => hoveredFileIndexRef.current, []);

  const { cursor, isHelpOpen, setIsHelpOpen, setCursorPosition, rememberFilePosition } =
    useKeyboardNavigation({
      files: navigableFiles,
      comments: unresolvedThreads,
      viewMode: diffMode,
      reviewedFiles: viewedFiles,
      onToggleReviewed: toggleFileReviewed,
      getHoveredFileIndex,
      onCreateComment: () => {
        if (cursor && takesComments) {
          setCommentTrigger({
            fileIndex: cursor.fileIndex,
            chunkIndex: cursor.chunkIndex,
            lineIndex: cursor.lineIndex,
          });
        }
      },
      onCopyAllComments: () => {
        if (threads.length > 0) {
          void handleCopyAllComments();
        }
      },
      onDeleteAllComments: () => {
        if (threads.length > 0 && confirm('Delete all comments?')) {
          clearAllComments();
        }
      },
      onToggleCommentsPanel: () => {
        if (!isCommentsPanelOpen) {
          openCommentsPanelWithKeys();
        } else if (!commentsPanelRef.current?.hasFocus()) {
          setCommentsPanelFocusRequest((count) => count + 1);
        } else {
          (document.activeElement as HTMLElement | null)?.blur();
          setIsCommentsPanelOpen(false);
        }
      },
      onRefresh: () => {
        reload();
      },
      ...(showsCommitList && {
        onPreviousCommit: () => selectView({ kind: 'previous' }),
        onNextCommit: () => selectView({ kind: 'next' }),
      }),
    });

  // Viewed button in the diff header: silently remember the toggled file as
  // the navigation position, so keyboard navigation resumes from it without
  // showing any keyboard UI for a mouse interaction
  const handleViewedButtonToggle = useCallback(
    (filePath: string) => {
      void toggleFileReviewed(filePath);
      if (diffData) {
        const fileIndex = diffData.files.findIndex((f) => f.path === filePath);
        if (fileIndex !== -1) {
          rememberFilePosition(fileIndex);
        }
      }
    },
    [toggleFileReviewed, diffData, rememberFilePosition],
  );

  useEffect(() => {
    if (!diffData || !cursor) return;

    const filePath = diffData.files[cursor.fileIndex]?.path;
    if (!filePath || renderedFilePaths.has(filePath)) return;

    ensureFilesRenderedUpTo(filePath);
    requestAnimationFrame(() => {
      setCursorPosition(cursor);
    });
  }, [cursor, diffData, ensureFilesRenderedUpTo, renderedFilePaths, setCursorPosition]);

  const handleLineClick = useCallback(
    (fileIndex: number, chunkIndex: number, lineIndex: number, side: 'left' | 'right') => {
      setCursorPosition({
        fileIndex,
        chunkIndex,
        lineIndex,
        side,
      });
    },
    [setCursorPosition],
  );

  const handleCommentTriggerHandled = useCallback(() => {
    setCommentTrigger(null);
  }, [setCommentTrigger]);

  const startResize =
    (
      startWidth: number,
      setWidth: (width: number) => void,
      clamp: (width: number) => number,
      direction: 1 | -1,
    ) =>
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      const startX = e.clientX;

      const handleMouseMove = (e: MouseEvent) => {
        setWidth(clamp(startWidth + direction * (e.clientX - startX)));
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    };

  const fetchDiffData = useCallback(
    async (selection?: DiffSelection) => {
      const requestId = diffRequestIdRef.current + 1;
      diffRequestIdRef.current = requestId;
      activeDiffAbortControllerRef.current?.abort();
      const controller = new AbortController();
      activeDiffAbortControllerRef.current = controller;
      try {
        const requestedSelection =
          selection ??
          (hasUserSelectedRevisionRef.current ? selectedRevisionRef.current : undefined);
        const params = new URLSearchParams({
          ignoreWhitespace: String(ignoreWhitespace),
        });
        if (requestedSelection?.baseCommitish) params.set('base', requestedSelection.baseCommitish);
        if (requestedSelection?.targetCommitish)
          params.set('target', requestedSelection.targetCommitish);
        if (requestedSelection?.baseMode === 'merge-base')
          params.set('baseMode', requestedSelection.baseMode);

        const response = await fetch(`/api/diff?${params}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Failed to fetch diff data');
        const data = (await response.json()) as DiffResponse;
        if (diffRequestIdRef.current !== requestId) {
          return;
        }
        setDiffData(data);
        setDiffDataVersion((prev) => prev + 1);

        // Update resolved revision state from server response
        setResolvedBaseRevision(
          data.baseCommitish && data.requestedBaseMode !== 'merge-base' ? data.baseCommitish : '',
        );
        if (data.targetCommitish) setResolvedTargetRevision(data.targetCommitish);

        if (!hasUserSelectedRevisionRef.current) {
          const requestedBase = data.requestedBaseCommitish ?? data.baseCommitish;
          const requestedTarget = data.requestedTargetCommitish ?? data.targetCommitish;
          if (requestedBase && requestedTarget) {
            setSelectedRevision(
              createDiffSelection(requestedBase, requestedTarget, data.requestedBaseMode),
            );
          }
        }

        // Lock files are now automatically marked as viewed by useViewedFiles hook
      } catch (err) {
        if ((err as { name?: string } | null)?.name === 'AbortError') {
          return;
        }
        if (diffRequestIdRef.current !== requestId) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (activeDiffAbortControllerRef.current === controller) {
          activeDiffAbortControllerRef.current = null;
        }
        if (diffRequestIdRef.current === requestId) {
          setLoading(false);
        }
      }
    },
    [ignoreWhitespace],
  );
  fetchDiffDataRef.current = fetchDiffData;

  useEffect(() => {
    void fetchDiffData();
  }, [fetchDiffData]);

  useEffect(() => {
    return () => {
      activeDiffAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (isMobile && diffMode !== 'unified') {
      setDiffMode('unified');
    }
  }, [diffMode, isMobile]);

  // Hydrate UI settings from the server-persisted config so they survive
  // across ports (localStorage is origin-scoped and resets on a new port).
  // Settings the server doesn't know yet are seeded from localStorage.
  useEffect(() => {
    let cancelled = false;

    void fetchClientSettings().then((client) => {
      if (cancelled || !client) {
        return;
      }

      const seed: Record<string, unknown> = {};

      const remoteDiffViewMode = parseDiffViewMode(client.diffViewMode);
      if (remoteDiffViewMode) {
        setDiffMode(remoteDiffViewMode);
      } else {
        const localDiffViewMode = getStoredDiffViewMode();
        if (localDiffViewMode) {
          seed.diffViewMode = localDiffViewMode;
        }
      }

      if (typeof client.sidebarWidth === 'number' && Number.isFinite(client.sidebarWidth)) {
        setSidebarWidth(clampSidebarWidth(client.sidebarWidth));
      } else {
        const localSidebarWidth = getStoredSidebarWidth();
        if (localSidebarWidth !== null) {
          seed.sidebarWidth = localSidebarWidth;
        }
      }

      if (typeof client.sidebarOpen === 'boolean') {
        setIsFileTreeOpen(client.sidebarOpen);
      } else {
        const localSidebarOpen = getStoredSidebarOpen();
        if (localSidebarOpen !== null) {
          seed.sidebarOpen = localSidebarOpen;
        }
      }

      const remoteCommitListHeight = parseCommitListHeight(client.commitListHeight);
      if (remoteCommitListHeight !== null) {
        setCommitListHeight(remoteCommitListHeight);
        storeCommitListHeight(remoteCommitListHeight);
      } else {
        const localCommitListHeight = getStoredCommitListHeight();
        if (localCommitListHeight !== null) {
          seed.commitListHeight = localCommitListHeight;
        }
      }

      if (
        typeof client.commentsPanelWidth === 'number' &&
        Number.isFinite(client.commentsPanelWidth)
      ) {
        setCommentsPanelWidth(clampCommentsPanelWidth(client.commentsPanelWidth));
      } else {
        const localCommentsPanelWidth = getStoredCommentsPanelWidth();
        if (localCommentsPanelWidth !== null) {
          seed.commentsPanelWidth = localCommentsPanelWidth;
        }
      }

      if (typeof client.commentsPanelOpen === 'boolean') {
        setIsCommentsPanelOpen(client.commentsPanelOpen);
      } else {
        const localCommentsPanelOpen = getStoredCommentsPanelOpen();
        if (localCommentsPanelOpen !== null) {
          seed.commentsPanelOpen = localCommentsPanelOpen;
        }
      }

      if (Object.keys(seed).length > 0) {
        saveClientSettings(seed);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const skipInitialSidebarWidthSaveRef = useRef(true);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    // Skip the mount run so simply opening difit doesn't write the config file.
    if (skipInitialSidebarWidthSaveRef.current) {
      skipInitialSidebarWidthSaveRef.current = false;
      return;
    }
    saveClientSettings({ sidebarWidth });
  }, [sidebarWidth]);

  const handleCommitListResize = useCallback((height: number) => {
    const rounded = Math.round(height);
    setCommitListHeight(rounded);
    storeCommitListHeight(rounded);
    saveClientSettings({ commitListHeight: rounded });
  }, []);

  const skipInitialSidebarOpenSaveRef = useRef(true);
  useEffect(() => {
    try {
      window.localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, String(isFileTreeOpen));
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    if (skipInitialSidebarOpenSaveRef.current) {
      skipInitialSidebarOpenSaveRef.current = false;
      return;
    }
    saveClientSettings({ sidebarOpen: isFileTreeOpen });
  }, [isFileTreeOpen]);

  const skipInitialCommentsPanelWidthSaveRef = useRef(true);
  useEffect(() => {
    try {
      window.localStorage.setItem(COMMENTS_PANEL_WIDTH_STORAGE_KEY, String(commentsPanelWidth));
    } catch {}
    if (skipInitialCommentsPanelWidthSaveRef.current) {
      skipInitialCommentsPanelWidthSaveRef.current = false;
      return;
    }
    saveClientSettings({ commentsPanelWidth });
  }, [commentsPanelWidth]);

  const skipInitialCommentsPanelOpenSaveRef = useRef(true);
  useEffect(() => {
    try {
      window.localStorage.setItem(COMMENTS_PANEL_OPEN_STORAGE_KEY, String(isCommentsPanelOpen));
    } catch {
      // Ignore localStorage errors (e.g. disabled storage).
    }
    if (skipInitialCommentsPanelOpenSaveRef.current) {
      skipInitialCommentsPanelOpenSaveRef.current = false;
      return;
    }
    saveClientSettings({ commentsPanelOpen: isCommentsPanelOpen });
  }, [isCommentsPanelOpen]);

  // Fetch revision options on mount
  useEffect(() => {
    fetch('/api/revisions')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RevisionsResponse | null) => {
        setRevisionOptions(data);
        if (
          data?.resolvedBase &&
          normalizeBaseMode(currentRequestedBaseModeRef.current) !== 'merge-base'
        ) {
          setResolvedBaseRevision((prev) => prev || data.resolvedBase || '');
        }
        if (data?.resolvedTarget) {
          setResolvedTargetRevision((prev) => prev || data.resolvedTarget || '');
        }
      })
      .catch(() => setRevisionOptions(null));
  }, []);

  // Handle revision change
  const handleRevisionChange = useCallback(
    async (nextSelection: DiffSelection) => {
      // Skip if no actual change
      if (diffSelectionsEqual(nextSelection, selectedRevision)) return;

      hasUserSelectedRevisionRef.current = true;
      pendingCommentNavigationRef.current = null;
      selectedRevisionRef.current = nextSelection;
      setSelectedRevision(nextSelection);
      setLoading(true);
      setError(null);
      await fetchDiffData(nextSelection);
    },
    [fetchDiffData, selectedRevision],
  );

  const recordReviewJump = useReviewTargetHistory(
    (selection) => void handleRevisionChange(selection),
  );
  const showDiff = useCallback(
    (nextSelection: DiffSelection) => {
      if (diffSelectionsEqual(nextSelection, selectedRevision)) return;
      recordReviewJump(selectedRevision, nextSelection);
      void handleRevisionChange(nextSelection);
    },
    [handleRevisionChange, recordReviewJump, selectedRevision],
  );
  const selectView = useCallback(
    (action: ReviewViewAction) => {
      if (!review) return;
      const chosen = selectReviewView(
        review,
        { view: shownView, anchor: shownAnchor, ...(rangeStart !== undefined && { rangeStart }) },
        action,
      );
      if (!chosen) return;
      setViewAnchor({ view: chosen.view, sha: chosen.anchor });
      setRangePick(
        chosen.rangeStart === undefined ? null : { view: chosen.view, sha: chosen.rangeStart },
      );
      if (!chosen.selection) return;
      setIsCommitDrawerOpen(false);
      showDiff(chosen.selection);
    },
    [review, shownView, shownAnchor, rangeStart, showDiff],
  );
  const closeCommitDrawer = useCallback(() => {
    selectView({ kind: 'cancel' });
    setIsCommitDrawerOpen(false);
  }, [selectView]);
  const openReviewAt = useCallback(
    (commit: string) => showDiff(selectionAtCommit(selectedRevision, commit)),
    [selectedRevision, showDiff],
  );
  const submitDirectEdit = useCallback(
    async (request: DirectEditRequest): Promise<DirectEditFailure | null> => {
      let response: Response;
      try {
        response = await fetch(getCommentApiUrl('/api/direct-edit'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(request),
        });
      } catch {
        return { message: 'difit 서버에 연결하지 못했습니다.' };
      }
      const payload = (await response.json().catch(() => ({}))) as Partial<
        Extract<DirectEditResponse, { error: string }>
      > &
        Partial<Extract<DirectEditResponse, { success: true }>>;
      if (!response.ok || !payload.success) {
        return {
          message: directEditFailureMessage(
            payload.reason,
            payload.error ?? `${response.status} ${response.statusText}`,
          ),
          ...(payload.output ? { output: payload.output } : {}),
        };
      }
      if (typeof payload.version === 'number') {
        serverCommentVersionRef.current = payload.version;
      }
      skipNextCommentSyncRef.current = true;
      replaceThreads(payload.threads ?? []);
      mergeDecisions(payload.decisions ?? []);
      setDirectEditCount((count) => count + 1);
      return null;
    },
    [getCommentApiUrl, mergeDecisions, replaceThreads],
  );
  const directEdit = useMemo<DirectEditControls | null>(() => {
    if (!diffData?.directEditAvailable || !targetCommit) return null;
    if (!showsPartOfReview) return { commit: targetCommit, submit: submitDirectEdit };
    const view = {
      base: resolvedSelection.baseCommitish,
      target: resolvedSelection.targetCommitish,
    };
    return {
      commit: view.target,
      submit: (request) => submitDirectEdit({ ...request, view }),
    };
  }, [
    diffData?.directEditAvailable,
    targetCommit,
    showsPartOfReview,
    resolvedSelection,
    submitDirectEdit,
  ]);
  const fixupOverlay = useMemo<FixupOverlayState>(
    () => ({
      enabled: showFixupOverlay,
      fixupsByThread,
      decisions,
      targetCommit,
      recordDecision: recordWithPatchId(recordDecision, fixupsByThread),
      undoApproval,
      openReviewAt,
      showView: showDiff,
      directEdit,
    }),
    [
      showFixupOverlay,
      fixupsByThread,
      decisions,
      targetCommit,
      recordDecision,
      undoApproval,
      openReviewAt,
      showDiff,
      directEdit,
    ],
  );

  // Clear comments and viewed files on initial load if requested via CLI flag
  const hasCleanedRef = useRef(false);
  useEffect(() => {
    if (diffData?.clearComments && !hasCleanedRef.current) {
      hasCleanedRef.current = true;
      pendingBootstrapAfterLocalResetRef.current = true;
      clearAllComments({ resetAppliedCommentImportIds: true });
      clearViewedFiles();
      console.log(
        '✅ All existing comments and viewed files cleared as requested via --clean flag',
      );
    }
  }, [diffData?.clearComments, clearAllComments, clearViewedFiles]);

  useEffect(() => {
    if (!commentsContextKey || !hasLoadedComments) {
      return;
    }

    if (bootstrappedCommentsKey === commentsContextKey) {
      return;
    }

    if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
      return;
    }

    const shouldReplaceFromServer = pendingBootstrapAfterLocalResetRef.current;
    pendingBootstrapAfterLocalResetRef.current = false;

    bootstrappingCommentsKeyRef.current = commentsContextKey;
    let cancelled = false;

    const bootstrapComments = async () => {
      try {
        const { threads: serverThreads, decisions: serverDecisions } = await fetchServerComments();
        const nextThreads = shouldReplaceFromServer
          ? serverThreads
          : mergeCommentThreads(serverThreads, storedThreads).threads;
        const nextDecisions = mergeReviewDecisions(serverDecisions, decisionsRef.current);
        if (cancelled) {
          return;
        }

        skipNextCommentSyncRef.current = true;
        replaceThreads(nextThreads);

        if (
          !shouldReplaceFromServer &&
          (JSON.stringify(serverThreads) !== JSON.stringify(nextThreads) ||
            JSON.stringify(mergeReviewDecisions(serverDecisions, [])) !==
              JSON.stringify(nextDecisions))
        ) {
          await syncThreadsToServer(nextThreads, nextDecisions);
        }
      } catch (commentsError) {
        if (!cancelled) {
          console.error('Failed to bootstrap comments from server:', commentsError);
        }
      } finally {
        if (!cancelled) {
          setBootstrappedCommentsKey(commentsContextKey);
        }
        if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
          bootstrappingCommentsKeyRef.current = null;
        }
      }
    };

    void bootstrapComments();

    return () => {
      cancelled = true;
      if (bootstrappingCommentsKeyRef.current === commentsContextKey) {
        bootstrappingCommentsKeyRef.current = null;
      }
    };
  }, [
    bootstrappedCommentsKey,
    commentsContextKey,
    fetchServerComments,
    hasLoadedComments,
    replaceThreads,
    storedThreads,
    syncThreadsToServer,
  ]);

  // Trigger sparkle animation when all files are viewed
  useEffect(() => {
    if (diffData) {
      // Reset the trigger flag when not all files are viewed
      if (viewedFiles.size < diffData.files.length) {
        setHasTriggeredSparkles(false);
      }
      // Show sparkles when all files are viewed and not already triggered
      else if (viewedFiles.size === diffData.files.length && !hasTriggeredSparkles) {
        setShowSparkles(true);
        setHasTriggeredSparkles(true);
        // Hide sparkles after animation completes
        setTimeout(() => {
          setShowSparkles(false);
        }, 1000);
      }
    }
  }, [viewedFiles.size, diffData, hasTriggeredSparkles]);

  // Send comments to server whenever they change and before page unload
  useEffect(() => {
    if (!hasBootstrappedComments) {
      return;
    }

    const data = JSON.stringify({
      threads: storedThreads,
      decisions,
      baseVersion: serverCommentVersionRef.current ?? undefined,
    });
    const commentsApiUrl = getCommentApiUrl('/api/comments');

    // Also handle page unload
    const sendCommentsBeforeUnload = () => {
      // Use sendBeacon for reliable delivery during page unload, including empty states.
      navigator.sendBeacon(commentsApiUrl, data);
    };

    window.addEventListener('beforeunload', sendCommentsBeforeUnload);

    if (skipNextCommentSyncRef.current) {
      skipNextCommentSyncRef.current = false;
      return () => {
        window.removeEventListener('beforeunload', sendCommentsBeforeUnload);
      };
    }

    syncThreadsToServer(storedThreads, decisions).catch((syncError) => {
      console.error('Failed to sync comments:', syncError);
    });

    return () => {
      window.removeEventListener('beforeunload', sendCommentsBeforeUnload);
    };
  }, [decisions, getCommentApiUrl, hasBootstrappedComments, storedThreads, syncThreadsToServer]);

  // Establish SSE connection for tab close detection
  useEffect(() => {
    const eventSource = new EventSource(resolveEventSourceUrl('/api/heartbeat'));

    eventSource.onopen = () => {
      console.log('Connected to server heartbeat');
    };

    eventSource.onerror = () => {
      console.log('Server connection lost');
      eventSource.close();
    };

    // Cleanup on unmount
    return () => {
      eventSource.close();
    };
  }, []);

  const handleAddComment = useCallback(
    async (
      file: string,
      line: LineNumber,
      body: string,
      codeContent?: string,
      side?: DiffSide,
    ): Promise<void> => {
      const ofReview = review && resolvedSelection && isViewOfReview(resolvedSelection, review);
      const fixupTarget = ofReview
        ? await fetchFixupTarget(resolvedSelection, file, line, side || 'new')
        : undefined;
      addThreadRef.current({
        filePath: file,
        body,
        side: side || 'new',
        line: typeof line === 'number' ? line : { start: line[0], end: line[1] },
        codeSnapshot:
          codeContent !== undefined
            ? {
                content: codeContent,
                language: undefined,
              }
            : undefined,
        binding: ofReview ? bindingForView(review, resolvedSelection, fixupTarget) : undefined,
      });
    },
    [review, resolvedSelection],
  );

  const showCopyAllNotice = (notice: CopyAllNotice) => {
    setCopyAllNotice(notice);
    setTimeout(() => setCopyAllNotice(null), 2000);
  };

  const handleCopyAllComments = async () => {
    if (!fixupsLoaded) return;
    if (openThreads.length === 0) {
      showCopyAllNotice('empty');
      return;
    }
    try {
      const prompt = generateAllCommentsPrompt(
        {
          requestedBaseCommitish: diffData?.requestedBaseCommitish,
          requestedTargetCommitish: diffData?.requestedTargetCommitish,
          baseMode: normalizeBaseMode(diffData?.requestedBaseMode),
          resolvedBaseCommitish: diffData?.baseCommitish,
          resolvedTargetCommitish: diffData?.targetCommitish,
        },
        openThreads,
      );
      await copyTextToClipboard(prompt);
      showCopyAllNotice('copied');
    } catch (error) {
      console.error('Failed to copy all comments prompt:', error);
    }
  };

  const handleReplyToThread = useCallback(
    (threadId: string, body: string): Promise<void> => {
      replyToThread({ threadId, body });
      return Promise.resolve();
    },
    [replyToThread],
  );

  const pickComment = (thread: CommentThread) => {
    if (!diffData) return;
    setPickedThreadId(thread.id);
    const placedHere =
      !hiddenThreadIds.has(thread.id) &&
      !thread.isOutdated &&
      diffData.files.some(({ path }) => path === thread.file);
    if (!placedHere && showsPartOfReview && review) {
      showDiff(thread.madeView ?? review.requested);
      pendingCommentNavigationRef.current = thread.id;
      return;
    }

    jumpToThread(thread, collapsedFiles.has(thread.file));
  };
  const jumpToThread = (thread: CommentThread, afterRender: boolean) => {
    if (!diffData) return;
    const files = diffData.files;
    setCollapsedFiles((prev) => {
      if (!prev.has(thread.file)) return prev;
      const next = new Set(prev);
      next.delete(thread.file);
      return next;
    });
    const moveCursor = () => {
      const position = findCommentPosition(thread, files);
      if (position) setCursorPosition(position);
    };
    if (afterRender) requestAnimationFrame(moveCursor);
    else moveCursor();
  };
  const jumpToThreadRef = useRef(jumpToThread);
  jumpToThreadRef.current = jumpToThread;
  useEffect(() => {
    const threadId = pendingCommentNavigationRef.current;
    if (!threadId || !diffData || !hasLoadedComments || hiddenThreadIds.has(threadId)) return;
    // A new view folds its viewed files once they load; jumping before that would be folded again.
    if (!collapsedInitializedRef.current && !hasLoadedInitialViewedFiles) return;
    pendingCommentNavigationRef.current = null;
    const thread = normalizedThreads.find(({ id }) => id === threadId);
    if (!thread) return;
    jumpToThreadRef.current(thread, true);
  }, [
    diffData,
    hasLoadedComments,
    hasLoadedInitialViewedFiles,
    normalizedThreads,
    hiddenThreadIds,
  ]);

  const handleOpenInEditor = useCallback(
    async (filePath: string, lineNumber: number) => {
      try {
        const response = await fetch('/api/open-in-editor', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filePath,
            line: lineNumber,
            editor: settings.editor,
          }),
        });

        if (!response.ok) {
          const payload: unknown = await response.json().catch(() => null);
          let message = response.statusText;
          if (
            payload &&
            typeof payload === 'object' &&
            'error' in payload &&
            typeof (payload as { error?: unknown }).error === 'string'
          ) {
            message = (payload as { error: string }).error;
          }
          console.error('Failed to open file in editor:', message);
        }
      } catch (error) {
        console.error('Failed to open file in editor:', error);
      }
    },
    [settings.editor],
  );

  const handleGlobalClick = (e: React.MouseEvent) => {
    // Clear cursor position
    setCursorPosition(null);

    // Check if clicking on a comment button
    const target = e.target as HTMLElement;
    if (commentsPanelRef.current?.hasFocus() && !target.closest('#comments-panel')) {
      (document.activeElement as HTMLElement | null)?.blur();
    }
    const isCommentButton = target.closest('[data-comment-button="true"]');
    const isOpenInEditorButton = target.closest('[data-open-in-editor-button="true"]');
    const isShiftRangeClick = e.shiftKey && target.closest('[data-diff-line-row="true"]');

    // Close empty comment forms (unless clicking on a comment button)
    if (!isCommentButton && !isOpenInEditorButton && !isShiftRangeClick) {
      closeEmptyCommentForms(e);
    }
  };

  const closeEmptyCommentForms = (e: React.MouseEvent) => {
    const emptyForms = document.querySelectorAll('form[data-empty="true"]');
    emptyForms.forEach((form) => {
      // Don't close if clicking inside the form itself
      if (!form.contains(e.target as Node)) {
        const cancelButton = form.querySelector<HTMLButtonElement>('[data-comment-cancel="true"]');
        cancelButton?.click();
      }
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-github-bg-primary">
        <div className="text-github-text-secondary text-base">Loading diff...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-github-bg-primary text-center gap-2">
        <h2 className="text-github-danger text-2xl mb-2">Error</h2>
        <p className="text-github-text-secondary text-base">{error}</p>
      </div>
    );
  }

  if (!diffData) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-github-bg-primary text-center gap-2">
        <h2 className="text-github-danger text-2xl mb-2">No data</h2>
        <p className="text-github-text-secondary text-base">No diff data available</p>
      </div>
    );
  }

  const canOpenInEditor =
    diffData.openInEditorAvailable !== false &&
    settings.editor.id !== 'none' &&
    settings.editor.command.trim() !== '' &&
    settings.editor.argsTemplate.trim() !== '';

  return (
    <WordHighlightProvider>
      <div
        className="h-screen flex flex-col"
        data-fixup-review={targetCommit ? '' : undefined}
        onClickCapture={handleGlobalClick}
      >
        <header
          className={`bg-github-bg-secondary border-b border-github-border flex ${
            isMobile ? 'flex-col' : 'flex-row items-center'
          }`}
        >
          <div
            className={`flex items-center justify-between w-full ${
              isMobile ? 'px-3 py-2 gap-3' : 'px-4 py-3 gap-4 w-auto'
            } ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
            style={{
              width: isMobile ? '100%' : isFileTreeOpen ? `${sidebarWidth}px` : 'auto',
              minWidth: isMobile ? '0px' : isFileTreeOpen ? `${SIDEBAR_MIN_WIDTH}px` : 'auto',
              maxWidth: isMobile ? 'none' : isFileTreeOpen ? `${SIDEBAR_MAX_WIDTH}px` : 'none',
            }}
          >
            <h1>
              <Logo
                style={{
                  height: '18px',
                  color: 'var(--color-github-text-secondary)',
                }}
              />
            </h1>
            <div className="flex items-center gap-1">
              {isMobile && hasCommitList && (
                <button
                  type="button"
                  onClick={() =>
                    isCommitDrawerOpen ? closeCommitDrawer() : setIsCommitDrawerOpen(true)
                  }
                  className="flex items-center gap-1.5 min-w-0 p-2 text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary rounded transition-colors"
                  title="리뷰 범위의 커밋"
                  aria-expanded={isCommitDrawerOpen}
                  aria-controls="commit-drawer"
                  aria-label="커밋 목록"
                >
                  <GitCommitHorizontal size={18} className="shrink-0" />
                  <span className="min-w-0 max-w-40 truncate text-xs">
                    <ShownCommits commits={review.commits} shown={shownView} />
                  </span>
                </button>
              )}
              <button
                onClick={() =>
                  isMobile
                    ? setIsFileDrawerOpen(!isFileDrawerOpen)
                    : setIsFileTreeOpen(!isFileTreeOpen)
                }
                className="p-2 text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary rounded transition-colors"
                title={isFileTreeShown ? 'Collapse file tree' : 'Expand file tree'}
                aria-expanded={isFileTreeShown}
                aria-controls="file-tree-panel"
                aria-label="Toggle file tree panel"
              >
                {isFileTreeShown ? <PanelLeftClose size={18} /> : <PanelLeft size={18} />}
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary rounded transition-colors"
                title="Settings"
              >
                <Settings size={18} />
              </button>
            </div>
          </div>
          {!isMobile && (
            <div
              className={`border-r border-github-border ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
              style={{
                width: isFileTreeOpen ? '4px' : '0px',
                height: 'calc(100% - 16px)',
                margin: '8px 0',
                transform: 'translateX(-2px)',
              }}
            />
          )}
          <div
            className={`flex-1 flex flex-wrap items-center justify-between ${
              isMobile ? 'px-3 pb-2 gap-3' : 'px-4 py-3 gap-4'
            }`}
          >
            <div className={`flex flex-wrap items-center ${isMobile ? 'gap-2' : 'gap-3'}`}>
              {!isMobile && (
                <div className="flex bg-github-bg-tertiary border border-github-border rounded-md p-1">
                  <button
                    onClick={() => handleDiffModeChange('split')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                      diffMode === 'split'
                        ? 'bg-github-bg-primary text-github-text-primary shadow-sm'
                        : 'text-github-text-secondary hover:text-github-text-primary'
                    }`}
                  >
                    <Columns size={14} />
                    Split
                  </button>
                  <button
                    onClick={() => handleDiffModeChange('unified')}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-all duration-200 flex items-center gap-1.5 cursor-pointer ${
                      diffMode === 'unified'
                        ? 'bg-github-bg-primary text-github-text-primary shadow-sm'
                        : 'text-github-text-secondary hover:text-github-text-primary'
                    }`}
                  >
                    <AlignLeft size={14} />
                    Unified
                  </button>
                </div>
              )}
              <Checkbox
                checked={ignoreWhitespace}
                onChange={setIgnoreWhitespace}
                label="Ignore Whitespace"
                title={ignoreWhitespace ? 'Show whitespace changes' : 'Ignore whitespace changes'}
              />
              {diffData?.targetCommitish !== 'stdin' && (
                <Checkbox
                  checked={foldCommentChanges}
                  onChange={setFoldCommentChanges}
                  label="주석 변경 접기"
                  title={
                    foldCommentChanges
                      ? '주석이나 공백만 바뀐 곳도 펼쳐 보기'
                      : '코드는 그대로이고 주석이나 공백만 바뀐 곳을 한 줄로 접기'
                  }
                />
              )}
              {resolvedThreadIds.size > 0 && (
                <Checkbox
                  checked={showResolvedThreads}
                  onChange={setShowResolvedThreads}
                  label="해결된 지적 보기"
                  title={
                    showResolvedThreads
                      ? '해결된 지적을 diff에서 감추기'
                      : '해결된 지적도 접어서 보이기'
                  }
                />
              )}
              {fixupsByThread.size > 0 && (
                <Checkbox
                  checked={showFixupOverlay}
                  onChange={setShowFixupOverlay}
                  label="수정을 겹쳐 보기"
                  title={
                    showFixupOverlay
                      ? '원래 diff만 보기'
                      : '지적에 대한 수정을 코드 줄 아래에 겹쳐 보기'
                  }
                />
              )}
              <NewerTargetButton
                newerTarget={newerTarget}
                onReopen={openReviewAt}
                compact={isMobile}
              />
              {/* File Watch Reload Button */}
              <ReloadButton
                shouldReload={shouldReload}
                isReloading={watchState.isReloading}
                onReload={reload}
                changeType={watchState.lastChangeType}
                compact={isMobile}
              />
            </div>
            <div
              className={`flex flex-wrap items-center text-sm text-github-text-secondary ${
                isMobile ? 'gap-3' : 'gap-4'
              }`}
            >
              {!isMobile && threads.length > 0 && (
                <CommentsDropdown
                  commentsCount={threads.length}
                  openCount={fixupsLoaded ? openThreads.length : null}
                  copyAllNotice={copyAllNotice}
                  onCopyAll={handleCopyAllComments}
                  onDeleteAll={clearAllComments}
                  onViewAll={openCommentsPanelWithKeys}
                />
              )}
              {!isMobile && (
                <button
                  type="button"
                  onClick={() => setIsCommentsPanelOpen(!isCommentsPanelOpen)}
                  className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors ${
                    isCommentsPanelOpen
                      ? 'border-blue-500 bg-blue-500/15 text-github-text-primary'
                      : 'border-github-border bg-github-bg-tertiary text-github-text-primary hover:bg-github-bg-primary'
                  }`}
                  title={isCommentsPanelOpen ? 'Hide comments panel' : 'Show comments panel'}
                  aria-expanded={isCommentsPanelOpen}
                  aria-controls="comments-panel"
                  aria-label="Toggle comments panel"
                >
                  {isCommentsPanelOpen ? <PanelRightClose size={14} /> : <PanelRight size={14} />}
                  코멘트 {threads.length}
                  <span className="font-mono text-[10px] text-github-text-muted">Shift+L</span>
                </button>
              )}
              <div className="flex flex-col gap-1 items-center">
                <div className="text-xs relative">
                  {viewedFiles.size === diffData.files.length
                    ? 'All diffs difit-ed!'
                    : `${viewedFiles.size} / ${diffData.files.length} files viewed`}
                  <SparkleAnimation isActive={showSparkles} />
                </div>
                <div
                  className="relative h-2 bg-github-bg-tertiary rounded-full overflow-hidden"
                  style={{
                    width: '90px',
                    border: '1px solid var(--color-github-border)',
                  }}
                >
                  <div
                    className={`absolute top-0 right-0 h-full transition-all duration-300 ease-out ${(() => {
                      const remainingPercent =
                        ((diffData.files.length - viewedFiles.size) / diffData.files.length) * 100;
                      if (remainingPercent > 50) return 'bg-github-accent'; // green
                      if (remainingPercent > 20) {
                        return 'bg-github-warning fixup-review:bg-github-text-muted'; // yellow
                      }
                      return 'bg-github-danger'; // red
                    })()}`}
                    style={{
                      width: `${((diffData.files.length - viewedFiles.size) / diffData.files.length) * 100}%`,
                    }}
                  />
                </div>
              </div>
              {revisionOptions ? (
                <DiffQuickMenu
                  options={revisionOptions}
                  selection={selectedRevision}
                  resolvedBaseRevision={resolvedBaseRevision}
                  resolvedTargetRevision={resolvedTargetRevision}
                  onSelectDiff={(selection) => void handleRevisionChange(selection)}
                  onOpenAdvanced={() => setIsRevisionModalOpen(true)}
                  compact={!isDesktop}
                />
              ) : (
                <span className="text-xs">
                  Reviewing:{' '}
                  <code className="bg-github-bg-tertiary px-1.5 py-0.5 rounded text-xs text-github-text-primary">
                    {diffData.commit.includes('...') ? (
                      <>
                        <span className="text-github-text-secondary font-medium">
                          {diffData.commit.split('...')[0]}...
                        </span>
                        <span className="font-medium">{diffData.commit.split('...')[1]}</span>
                      </>
                    ) : (
                      diffData.commit
                    )}
                  </code>
                </span>
              )}
            </div>
          </div>
        </header>
        {isMobile && (
          <FileChips
            files={diffData.files}
            comments={drawnThreads}
            decisions={decisions}
            reviewedFiles={viewedFiles}
            selectedFileIndex={cursor?.fileIndex ?? null}
            scrollVisibleFileIndex={scrollVisibleFileIndex}
            pickedCommentFilePath={pickedThread?.file ?? null}
            onScrollToFile={scrollFileIntoDiffContainer}
          />
        )}
        {revisionOptions && (
          <RevisionDetailModal
            key={isRevisionModalOpen ? getDiffSelectionKey(selectedRevision) : 'closed'}
            isOpen={isRevisionModalOpen}
            onClose={() => setIsRevisionModalOpen(false)}
            options={revisionOptions}
            selection={selectedRevision}
            resolvedBaseRevision={resolvedBaseRevision}
            resolvedTargetRevision={resolvedTargetRevision}
            onApply={(selection) => void handleRevisionChange(selection)}
          />
        )}

        {isMobile && isFileDrawerOpen && (
          <button
            type="button"
            aria-label="Close file tree"
            className="fixed inset-0 bg-black/40 z-30"
            onClick={() => setIsFileDrawerOpen(false)}
          />
        )}

        {isMobile && hasCommitList && (
          <>
            {isCommitDrawerOpen && (
              <button
                type="button"
                aria-label="커밋 목록 닫기"
                className="fixed inset-0 bg-black/40 z-30"
                onClick={closeCommitDrawer}
              />
            )}
            <aside
              id="commit-drawer"
              inert={!isCommitDrawerOpen}
              className="fixed inset-y-0 right-0 z-40 w-[min(85vw,360px)] flex flex-col bg-github-bg-secondary border-l border-github-border transition-transform duration-300 ease-out"
              style={{ transform: isCommitDrawerOpen ? 'translateX(0)' : 'translateX(100%)' }}
            >
              <CommitList
                review={review}
                shown={shownView}
                onSelect={selectView}
                rangeStart={rangeStart}
                inDrawer
                openCounts={openCountsByCommit}
              />
            </aside>
          </>
        )}

        <div className="flex flex-1 overflow-hidden relative">
          <div
            className={`relative overflow-hidden ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
            style={{
              width: isMobile ? '0px' : isFileTreeOpen ? `${sidebarWidth}px` : '0px',
            }}
          >
            <aside
              id="file-tree-panel"
              className={`bg-github-bg-secondary overflow-y-auto flex flex-col ${
                isMobile
                  ? 'fixed inset-y-0 right-0 z-40 w-[min(85vw,360px)] border-l border-github-border transition-transform duration-300 ease-out'
                  : 'relative border-r border-github-border'
              }`}
              style={{
                width: isMobile ? 'min(85vw, 360px)' : `${sidebarWidth}px`,
                minWidth: isMobile ? '0px' : `${SIDEBAR_MIN_WIDTH}px`,
                maxWidth: isMobile ? 'none' : `${SIDEBAR_MAX_WIDTH}px`,
                height: '100%',
                transform: isMobile
                  ? isFileDrawerOpen
                    ? 'translateX(0)'
                    : 'translateX(100%)'
                  : undefined,
              }}
            >
              <div className="flex-1 overflow-y-auto">
                <FileList
                  files={diffData.files}
                  onScrollToFile={scrollFileIntoDiffContainer}
                  onFileSelected={isMobile ? handleMobileFileSelected : undefined}
                  comments={drawnThreads}
                  decisions={decisions}
                  reviewedFiles={viewedFiles}
                  onToggleReviewed={toggleFileReviewed}
                  onToggleFolderReviewed={toggleFolderReviewed}
                  selectedFileIndex={cursor?.fileIndex ?? null}
                  scrollVisibleFileIndex={scrollVisibleFileIndex}
                  pickedCommentFilePath={pickedThread?.file ?? null}
                />
              </div>
              {showsCommitList && (
                <CommitList
                  review={review}
                  shown={shownView}
                  onSelect={selectView}
                  rangeStart={rangeStart}
                  openCounts={openCountsByCommit}
                  height={commitListHeight}
                  onResize={handleCommitListResize}
                />
              )}
              {!isMobile && (
                <div className="p-4 border-t border-github-border flex justify-between items-center">
                  <button
                    onClick={() => setIsHelpOpen(true)}
                    className="flex items-center gap-1.5 text-github-text-secondary hover:text-github-text-primary transition-colors"
                    title="Keyboard shortcuts (Shift+?)"
                  >
                    <Keyboard size={16} />
                    <span className="text-sm">Shortcuts</span>
                  </button>
                  <a
                    href="https://github.com/yoshiko-pg/difit"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-github-text-secondary hover:text-github-text-primary transition-colors"
                    title="View on GitHub"
                  >
                    <span className="text-sm">Star on GitHub</span>
                    <GitHubIcon style={{ height: '18px', width: '18px' }} />
                  </a>
                </div>
              )}
            </aside>
          </div>

          {!isMobile && (
            <div
              className={`bg-github-border hover:bg-github-text-muted cursor-col-resize ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
              style={{
                width: isFileTreeOpen ? '4px' : '0px',
              }}
              onMouseDown={startResize(sidebarWidth, setSidebarWidth, clampSidebarWidth, 1)}
              title="Drag to resize file list"
            />
          )}

          <PickedThreadProvider value={pickedThread?.id ?? null}>
            <main
              ref={diffScrollContainerRef}
              className={`flex-1 overflow-y-auto ${showMobileCommentsBar ? 'pb-16' : ''}`}
            >
              {diffData.files.map((file, fileIndex) => {
                const fileThreads = threadsByFile.get(file.path) ?? EMPTY_COMMENT_THREADS;
                const mergedChunks =
                  getMergedChunksForVersion(mergedChunksState, diffDataVersion, file.path) ??
                  EMPTY_MERGED_CHUNKS;
                const isRendered = renderedFilePaths.has(file.path);
                return (
                  <div
                    key={file.path}
                    id={getFileElementId(file.path)}
                    data-file-path={file.path}
                    data-rendered={isRendered ? 'true' : 'false'}
                    ref={(node) => registerLazyFileContainer(file.path, node)}
                    className="mb-6"
                    onMouseEnter={() => {
                      hoveredFileIndexRef.current = fileIndex;
                    }}
                    onMouseLeave={() => {
                      if (hoveredFileIndexRef.current === fileIndex) {
                        hoveredFileIndexRef.current = null;
                      }
                    }}
                  >
                    {isRendered ? (
                      <DiffViewer
                        file={file}
                        threads={fileThreads}
                        showAuthorBadges={showAuthorBadges}
                        diffMode={diffMode}
                        reviewedFiles={viewedFiles}
                        isChangedSinceViewed={changedSinceViewedFiles.has(file.path)}
                        onToggleReviewed={handleViewedButtonToggle}
                        collapsedFiles={collapsedFiles}
                        onToggleCollapsed={toggleFileCollapsed}
                        onToggleAllCollapsed={toggleAllFilesCollapsed}
                        onAddComment={takesComments ? handleAddComment : undefined}
                        onResolveThread={resolveThread}
                        onReplyToThread={handleReplyToThread}
                        onRemoveMessage={removeMessage}
                        onUpdateMessage={updateMessage}
                        onOpenInEditor={canOpenInEditor ? handleOpenInEditor : undefined}
                        syntaxTheme={settings.syntaxTheme}
                        baseCommitish={diffData.baseCommitish}
                        targetCommitish={diffData.targetCommitish}
                        cursor={cursor?.fileIndex === fileIndex ? cursor : null}
                        isFocused={cursor?.fileIndex === fileIndex}
                        fileIndex={fileIndex}
                        onLineClick={handleLineClick}
                        commentTrigger={
                          commentTrigger?.fileIndex === fileIndex ? commentTrigger : null
                        }
                        onCommentTriggerHandled={handleCommentTriggerHandled}
                        mergedChunks={mergedChunks}
                        expandLines={expandLines}
                        expandAllBetweenChunks={expandAllBetweenChunks}
                        prefetchFileContent={prefetchFileContent}
                        isExpandLoading={isExpandLoading}
                        diffVersion={diffDataVersion}
                        fixupOverlay={fixupOverlay}
                        foldCommentChanges={foldCommentChanges}
                      />
                    ) : (
                      <div className="bg-github-bg-secondary border border-github-border rounded-md px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs uppercase tracking-wide text-github-text-muted">
                              Deferred Rendering
                            </div>
                            <div className="text-sm font-mono text-github-text-primary truncate">
                              {file.path}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => ensureFileRendered(file.path)}
                            className="px-3 py-1.5 text-xs rounded border border-github-border text-github-text-secondary hover:text-github-text-primary hover:bg-github-bg-tertiary"
                          >
                            Load now
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </main>
          </PickedThreadProvider>

          {!isMobile && (
            <div
              className={`bg-github-border hover:bg-github-text-muted cursor-col-resize ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
              style={{ width: isCommentsPanelOpen ? '4px' : '0px' }}
              onMouseDown={startResize(
                commentsPanelWidth,
                setCommentsPanelWidth,
                clampCommentsPanelWidth,
                -1,
              )}
              title="Drag to resize comments panel"
            />
          )}

          {!isMobile && (
            <div
              data-comments-panel-box
              className={`relative overflow-hidden ${!isDragging ? '!transition-all !duration-300 !ease-in-out' : ''}`}
              style={{ width: isCommentsPanelOpen ? `${commentsPanelWidth}px` : '0px' }}
            >
              {isCommentsPanelOpen && (
                <aside
                  id="comments-panel"
                  aria-label="코멘트 패널"
                  className="h-full border-l border-github-border bg-github-bg-secondary"
                  style={{ width: `${commentsPanelWidth}px` }}
                >
                  <CommentsPanel
                    ref={commentsPanelRef}
                    threads={normalizedThreads}
                    statusById={commentPanelStatusById}
                    resolvedThreadIds={resolvedThreadIds}
                    filter={commentsPanelFilter}
                    onFilterChange={setCommentsPanelFilter}
                    pickedThreadId={pickedThread?.id ?? null}
                    onPick={pickComment}
                    onResolveThread={resolveThread}
                    onClose={() => setIsCommentsPanelOpen(false)}
                  />
                </aside>
              )}
            </div>
          )}
        </div>

        {showMobileCommentsBar && (
          <div className="fixed bottom-0 left-0 right-0 z-20 bg-github-bg-secondary border-t border-github-border px-4 py-2 flex justify-end">
            <CommentsDropdown
              commentsCount={threads.length}
              openCount={fixupsLoaded ? openThreads.length : null}
              copyAllNotice={copyAllNotice}
              onCopyAll={handleCopyAllComments}
              onDeleteAll={clearAllComments}
              onViewAll={openCommentsPanelWithKeys}
              direction="up"
              compact
            />
          </div>
        )}

        {isSettingsOpen && (
          <SettingsModal
            isOpen={isSettingsOpen}
            onClose={() => setIsSettingsOpen(false)}
            settings={settings}
            onSettingsChange={updateSettings}
          />
        )}

        <HelpModal isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />

        {symbolPeek.stack.map((request, depth) => (
          <SymbolPeekModal
            key={`${depth}:${request.ref}:${request.name}:${request.from ?? ''}`}
            request={request}
            hidden={depth !== symbolPeek.stack.length - 1}
            canGoBack={depth > 0}
            onBack={symbolPeek.back}
            onClose={symbolPeek.close}
            syntaxTheme={settings.syntaxTheme}
          />
        ))}
        {symbolPeek.offer && (
          <SymbolPeekChip
            name={symbolPeek.offer.request.name}
            x={symbolPeek.offer.x}
            y={symbolPeek.offer.y}
            onOpen={() => symbolPeek.offer && symbolPeek.open(symbolPeek.offer.request)}
          />
        )}
      </div>
    </WordHighlightProvider>
  );
}

export default App;
