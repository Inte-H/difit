import type { BaseMode, DiffSelection, ReviewCommit, ReviewScope } from '../types/diff.js';

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

// The review itself, or the diff from just before one of its commits to that or a later one.
export function isViewOfReview(
  view: DiffSelection,
  review: Pick<ReviewScope, 'selection' | 'commits'>,
): boolean {
  if (diffSelectionsEqual(view, review.selection)) return true;
  if (normalizeBaseMode(view.baseMode) === 'merge-base') return false;
  const end = review.commits.findIndex((commit) => isSameCommit(commit.sha, view.targetCommitish));
  return (
    end !== -1 &&
    review.commits
      .slice(0, end + 1)
      .some((commit) => isSameCommit(commit.parentSha, view.baseCommitish))
  );
}
