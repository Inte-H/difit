import type {
  BaseMode,
  CommentThread,
  DiffCommentThread,
  DiffSelection,
  ReviewCommit,
  ReviewScope,
} from '../types/diff.js';

export function normalizeBaseMode(baseMode?: BaseMode): BaseMode {
  return baseMode ?? 'direct';
}

export function createDiffSelection(
  baseCommitish: string,
  targetCommitish: string,
  baseMode?: BaseMode,
): DiffSelection {
  if (normalizeBaseMode(baseMode) === 'merge-base') {
    return {
      baseCommitish,
      targetCommitish,
      baseMode: 'merge-base',
    };
  }

  return {
    baseCommitish,
    targetCommitish,
  };
}

export function selectionAtCommit(current: DiffSelection, commit: string): DiffSelection {
  const reviewsOneCommit = current.baseCommitish === `${current.targetCommitish}^`;
  return createDiffSelection(
    reviewsOneCommit ? `${commit}^` : current.baseCommitish,
    commit,
    current.baseMode,
  );
}

export function diffSelectionsEqual(
  left: DiffSelection | null | undefined,
  right: DiffSelection | null | undefined,
): boolean {
  return (
    left?.baseCommitish === right?.baseCommitish &&
    left?.targetCommitish === right?.targetCommitish &&
    normalizeBaseMode(left?.baseMode) === normalizeBaseMode(right?.baseMode)
  );
}

export function getDiffSelectionKey(selection: DiffSelection): string {
  return `${selection.baseCommitish}:${selection.targetCommitish}:${normalizeBaseMode(selection.baseMode)}`;
}

export function getMergeBaseTargetRef(targetCommitish: string): string {
  if (targetCommitish === '.' || targetCommitish === 'staged' || targetCommitish === 'working') {
    return 'HEAD';
  }

  return targetCommitish;
}

export function isCommitTarget(targetCommitish: string): boolean {
  return !['.', 'staged', 'working', 'stdin'].includes(targetCommitish);
}

const HASH_PATTERN = /^[0-9a-f]{7,40}$/i;

export function isCommitHash(commitish: string): boolean {
  return HASH_PATTERN.test(commitish);
}

export function isSameCommit(a: string, b: string): boolean {
  if (!HASH_PATTERN.test(a) || !HASH_PATTERN.test(b)) return a === b;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return longer.toLowerCase().startsWith(shorter.toLowerCase());
}

export function reviewCommitViewed(
  view: DiffSelection,
  commits: readonly ReviewCommit[],
): ReviewCommit | undefined {
  if (normalizeBaseMode(view.baseMode) === 'merge-base') return undefined;
  return commits.find(
    (commit) =>
      isSameCommit(commit.sha, view.targetCommitish) &&
      isSameCommit(commit.parentSha, view.baseCommitish),
  );
}

export function isSameView(a: DiffSelection, b: DiffSelection): boolean {
  return (
    isSameCommit(a.baseCommitish, b.baseCommitish) &&
    isSameCommit(a.targetCommitish, b.targetCommitish) &&
    normalizeBaseMode(a.baseMode) === normalizeBaseMode(b.baseMode)
  );
}

function commitsBetween(view: DiffSelection, commits: readonly ReviewCommit[]): ReviewCommit[] {
  if (normalizeBaseMode(view.baseMode) === 'merge-base') return [];
  const end = commits.findIndex((commit) => isSameCommit(commit.sha, view.targetCommitish));
  const start = commits
    .slice(0, end + 1)
    .findIndex((commit) => isSameCommit(commit.parentSha, view.baseCommitish));
  return end === -1 || start === -1 ? [] : commits.slice(start, end + 1);
}

export function commitsOfView(
  view: DiffSelection,
  review: Pick<ReviewScope, 'selection' | 'commits'>,
): ReviewCommit[] {
  return isSameView(view, review.selection) ? review.commits : commitsBetween(view, review.commits);
}

// The review itself, or the diff from just before one of its commits to that or a later one.
export function isViewOfReview(
  view: DiffSelection,
  review: Pick<ReviewScope, 'selection' | 'commits'>,
): boolean {
  return (
    diffSelectionsEqual(view, review.selection) || commitsBetween(view, review.commits).length > 0
  );
}

export interface ViewBinding {
  view: DiffSelection;
  fixupTarget: string;
  snapshotCommit: string;
}

export function bindingForView(
  review: Pick<ReviewScope, 'selection' | 'commits'>,
  view: DiffSelection,
): ViewBinding | undefined {
  if (isSameView(view, review.selection)) return undefined;
  const commit = reviewCommitViewed(view, review.commits);
  if (!commit) return undefined;
  return {
    view: createDiffSelection(commit.parentSha, commit.sha),
    fixupTarget: commit.sha,
    snapshotCommit: commit.sha,
  };
}

// As the commit list or its 「전체」 entry requests it, so showing it records the same history entry.
export function madeViewElsewhere(
  thread: Pick<DiffCommentThread, 'view'>,
  shown: DiffSelection,
  review: Pick<ReviewScope, 'selection' | 'commits' | 'requested'>,
): DiffSelection | undefined {
  const made = thread.view ?? review.selection;
  if (isSameView(made, shown)) return undefined;
  if (isSameView(made, review.selection)) return review.requested;
  return commitsBetween(made, review.commits).length > 0 ? made : undefined;
}

export function fixupCommitOf(
  fixupTarget: string,
  commits: readonly ReviewCommit[],
): NonNullable<CommentThread['fixupCommit']> {
  const commit = commits.find(({ sha }) => isSameCommit(sha, fixupTarget));
  return commit
    ? { shortSha: commit.shortSha, subject: commit.subject }
    : { shortSha: fixupTarget.slice(0, 7) };
}
