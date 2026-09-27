import type { BaseMode, DiffSelection } from '../types/diff.js';

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
