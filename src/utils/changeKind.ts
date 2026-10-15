import type { ChunkChangeKind } from '../types/diff.js';

// Undefined when any part was not classified.
export function combineChangeKinds(
  kinds: ReadonlyArray<ChunkChangeKind | undefined>,
): ChunkChangeKind | undefined {
  if (kinds.length === 0 || kinds.includes(undefined)) return undefined;
  if (kinds.includes('code')) return 'code';
  if (kinds.includes('unknown')) return 'unknown';
  return kinds.includes('comment') ? 'comment' : 'whitespace';
}

export const leavesCodeAlone = (
  kind: ChunkChangeKind | undefined,
): kind is 'comment' | 'whitespace' => kind === 'comment' || kind === 'whitespace';

export const LEAVES_CODE_ALONE_LABEL = {
  comment: '주석',
  whitespace: '공백',
} as const;

export const LEAVES_CODE_ALONE_TITLE = {
  comment: '코드는 그대로이고 주석만 바뀜',
  whitespace: '코드는 그대로이고 공백만 바뀜',
} as const;
