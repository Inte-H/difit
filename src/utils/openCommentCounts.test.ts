import { describe, expect, it } from 'vitest';

import type {
  DiffCommentThread,
  ReviewCommit,
  ReviewDecision,
  ReviewScope,
  ThreadFixup,
} from '../types/diff';

import { countOpenThreadsByCommit } from './openCommentCounts';

const FIRST = '1'.repeat(40);
const SECOND = '2'.repeat(40);
const MERGED = '3'.repeat(40);
const FIXUP = 'f'.repeat(40);

const commit = (sha: string, merged?: ReviewCommit['merged']): ReviewCommit => ({
  sha,
  shortSha: sha.slice(0, 7),
  parentSha: '0'.repeat(40),
  subject: `commit ${sha.slice(0, 1)}`,
  ...(merged ? { merged } : {}),
});

const review: Pick<ReviewScope, 'selection' | 'commits'> = {
  selection: { baseCommitish: '0'.repeat(40), targetCommitish: SECOND },
  commits: [
    commit(FIRST),
    commit(SECOND, [{ sha: MERGED, shortSha: MERGED.slice(0, 7), subject: 'merged' }]),
  ],
};

const thread = (
  id: string,
  fixupTarget?: string,
): Pick<DiffCommentThread, 'id' | 'messages' | 'fixupTarget'> => ({
  id,
  messages: [{ id: `${id}-m`, body: 'fix this', author: 'User', createdAt: '', updatedAt: '' }],
  ...(fixupTarget === undefined ? {} : { fixupTarget }),
});

const fixup = (threadId: string): ThreadFixup => ({
  sha: FIXUP,
  shortSha: FIXUP.slice(0, 7),
  patchId: 'patch',
  subject: 'fixup! x',
  threadIds: [threadId],
  files: [],
});

const decision = (
  threadId: string,
  kind: ReviewDecision['kind'],
  at = '2026-01-01T00:00:00Z',
): ReviewDecision => ({ threadId, kind, fixupSha: FIXUP, at });

const countsOf = (
  threads: Pick<DiffCommentThread, 'id' | 'messages' | 'fixupTarget'>[],
  fixups: ThreadFixup[] = [],
  decisions: ReviewDecision[] = [],
) =>
  Object.fromEntries(
    countOpenThreadsByCommit(
      threads,
      new Map(fixups.map((entry) => [entry.threadIds[0] ?? '', [entry]])),
      decisions,
      review,
    ),
  );

describe('countOpenThreadsByCommit', () => {
  it('counts a thread awaiting its fix toward its fixup target', () => {
    expect(countsOf([thread('a', FIRST), thread('b', FIRST), thread('c', SECOND)])).toEqual({
      [FIRST]: 2,
      [SECOND]: 1,
    });
  });

  it('counts a thread whose fixup was rejected', () => {
    expect(countsOf([thread('a', FIRST)], [fixup('a')], [decision('a', 'rejected')])).toEqual({
      [FIRST]: 1,
    });
  });

  it('leaves out a thread with an approved or folded fixup', () => {
    expect(
      countsOf(
        [thread('a', FIRST), thread('b', FIRST)],
        [fixup('a')],
        [decision('a', 'approved'), decision('b', 'folded')],
      ),
    ).toEqual({});
  });

  it('leaves out a resolved thread until it is reopened', () => {
    expect(countsOf([thread('a', FIRST)], [], [decision('a', 'resolved')])).toEqual({});
    expect(
      countsOf(
        [thread('a', FIRST)],
        [],
        [decision('a', 'resolved'), decision('a', 'unresolved', '2026-01-01T00:01:00Z')],
      ),
    ).toEqual({ [FIRST]: 1 });
  });

  it('counts a thread with no fixup target toward the review target', () => {
    expect(countsOf([thread('a')])).toEqual({ [SECOND]: 1 });
  });

  it('keys a short fixup target by the full sha, merged commits included', () => {
    expect(countsOf([thread('a', FIRST.slice(0, 7)), thread('b', MERGED)])).toEqual({
      [FIRST]: 1,
      [MERGED]: 1,
    });
  });
});
