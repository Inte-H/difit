import { describe, expect, it } from 'vitest';

import { REVIEWER_EDIT_AUTHOR, type ReviewDecision, type ThreadFixup } from '../types/diff';

import {
  deriveThreadReviewState,
  mergeReviewDecisions,
  normalizeReviewDecisions,
  pendingFixupFor,
  reviewStateLabel,
  selectOpenThreads,
} from './reviewDecisions';

const fixup = (sha: string, threadIds = ['t1']): ThreadFixup => ({
  sha,
  shortSha: sha.slice(0, 7),
  patchId: `patch-${sha}`,
  subject: 'fixup! x',
  threadIds,
  files: [],
});

const decision = (
  kind: ReviewDecision['kind'],
  fixupSha: string,
  at = '2026-01-01T00:00:00Z',
  threadId = 't1',
): ReviewDecision => ({ threadId, kind, fixupSha, at });

describe('deriveThreadReviewState', () => {
  it('follows the latest of an approval and its undo', () => {
    const fixups = [fixup('a'.repeat(40))];
    const approved = decision('approved', 'a'.repeat(40), '2026-01-01T00:00:00Z');
    const undone = decision('unapproved', 'a'.repeat(40), '2026-01-01T00:01:00Z');
    const reapproved = decision('approved', 'a'.repeat(40), '2026-01-01T00:02:00Z');

    expect(deriveThreadReviewState('t1', fixups, [approved, undone])).toBe('awaiting-approval');
    expect(
      deriveThreadReviewState('t1', fixups, mergeReviewDecisions([undone], [reapproved])),
    ).toBe('approved');
  });

  it('keeps a re-approval when an older copy of the same approval is merged back in', () => {
    const fixups = [fixup('a'.repeat(40))];
    const first = decision('approved', 'a'.repeat(40), '2026-01-01T00:00:00Z');
    const undone = decision('unapproved', 'a'.repeat(40), '2026-01-01T00:01:00Z');
    const again = decision('approved', 'a'.repeat(40), '2026-01-01T00:02:00Z');

    const merged = mergeReviewDecisions([undone, again], [first, undone]);

    expect(deriveThreadReviewState('t1', fixups, merged)).toBe('approved');
  });

  it('orders decisions by time even when their timestamps are written differently', () => {
    const fixups = [fixup('a'.repeat(40))];
    const approved = decision('approved', 'a'.repeat(40), '2026-09-23T10:00:00.500Z');
    const undone = decision('unapproved', 'a'.repeat(40), '2026-09-23T19:00:01+09:00');

    expect(deriveThreadReviewState('t1', fixups, [approved, undone])).toBe('awaiting-approval');
    expect(
      mergeReviewDecisions(
        [decision('approved', 'b', '2026-09-23T10:00:00.500Z')],
        [decision('approved', 'b', '2026-09-23T10:00:00Z')],
      )[0]?.at,
    ).toBe('2026-09-23T10:00:00.500Z');
  });

  it('does not revive an undone approval when a stale list is merged back in', () => {
    const fixups = [fixup('a'.repeat(40))];
    const approved = decision('approved', 'a'.repeat(40), '2026-01-01T00:00:00Z');
    const undone = decision('unapproved', 'a'.repeat(40), '2026-01-01T00:01:00Z');

    const merged = mergeReviewDecisions([approved, undone], [approved]);

    expect(deriveThreadReviewState('t1', fixups, merged)).toBe('awaiting-approval');
  });

  it('keeps a rejected fixup rejected after a rebase rewrites its sha', () => {
    const rejected = { ...fixup('a'.repeat(40)), patchId: 'same-change' };
    const rewritten = { ...fixup('b'.repeat(40)), patchId: 'same-change' };
    const decisions = [{ ...decision('rejected', rejected.sha), patchId: 'same-change' }];

    expect(deriveThreadReviewState('t1', [rewritten], decisions)).toBe('rejected');

    const answer = fixup('c'.repeat(40));
    expect(deriveThreadReviewState('t1', [rewritten, answer], decisions)).toBe('awaiting-approval');
    expect(pendingFixupFor('t1', [rewritten, answer], decisions)).toBe(answer);
  });

  it('is awaiting-fix with no fixup and no decision', () => {
    expect(deriveThreadReviewState('t1', [], [])).toBe('awaiting-fix');
  });

  it('is awaiting-approval once a fixup arrives', () => {
    expect(deriveThreadReviewState('t1', [fixup('aaaa')], [])).toBe('awaiting-approval');
  });

  it('is rejected after rejecting the only fixup, then awaiting-approval when a new one arrives', () => {
    const rejected = [decision('rejected', 'aaaa')];
    expect(deriveThreadReviewState('t1', [fixup('aaaa')], rejected)).toBe('rejected');
    expect(deriveThreadReviewState('t1', [], rejected)).toBe('rejected');
    expect(deriveThreadReviewState('t1', [fixup('aaaa'), fixup('bbbb')], rejected)).toBe(
      'awaiting-approval',
    );
  });

  it('is approved while the record exists and folded once a fold record lands', () => {
    expect(deriveThreadReviewState('t1', [fixup('aaaa')], [decision('approved', 'aaaa')])).toBe(
      'approved',
    );
    expect(
      deriveThreadReviewState(
        't1',
        [],
        [decision('approved', 'aaaa'), decision('folded', 'aaaa', '2026-01-02T00:00:00Z')],
      ),
    ).toBe('folded');
  });

  it('asks for approval again when a fixup other than the approved one is waiting', () => {
    const approved = [decision('approved', 'aaaa')];

    expect(deriveThreadReviewState('t1', [fixup('bbbb')], approved)).toBe('awaiting-approval');
    expect(pendingFixupFor('t1', [fixup('bbbb')], approved)?.sha).toBe('bbbb');
    expect(deriveThreadReviewState('t1', [fixup('aaaa'), fixup('bbbb')], approved)).toBe(
      'awaiting-approval',
    );
  });

  it('keeps an approval after a rebase rewrites the approved fixup’s sha', () => {
    const rewritten = { ...fixup('b'.repeat(40)), patchId: 'same-change' };
    const approved = [{ ...decision('approved', 'a'.repeat(40)), patchId: 'same-change' }];

    expect(deriveThreadReviewState('t1', [rewritten], approved)).toBe('approved');
  });

  it('keeps an approval while the approved fixup is folded and before the fold record lands', () => {
    expect(deriveThreadReviewState('t1', [], [decision('approved', 'aaaa')])).toBe('approved');
  });

  it('lets a rejection made after the approval of the same fixup win', () => {
    const approved = decision('approved', 'aaaa', '2026-01-01T00:00:00Z');
    const rejected = decision('rejected', 'aaaa', '2026-01-02T00:00:00Z');
    expect(deriveThreadReviewState('t1', [fixup('aaaa')], [approved, rejected])).toBe('rejected');
    expect(deriveThreadReviewState('t1', [fixup('aaaa')], [approved, rejected], true)).toBe(
      'withdrawn',
    );
  });

  it('closes a thread the reviewer opened by editing once its fixup is rejected', () => {
    const rejected = [decision('rejected', 'aaaa')];
    expect(deriveThreadReviewState('t1', [fixup('aaaa')], rejected, true)).toBe('withdrawn');
    expect(deriveThreadReviewState('t1', [], rejected, true)).toBe('withdrawn');
    expect(deriveThreadReviewState('t1', [fixup('aaaa')], [], true)).toBe('awaiting-approval');
  });

  it('ignores other threads’ decisions', () => {
    expect(
      deriveThreadReviewState(
        't1',
        [fixup('aaaa')],
        [decision('rejected', 'aaaa', undefined, 't2')],
      ),
    ).toBe('awaiting-approval');
  });
});

describe('reviewStateLabel', () => {
  it('names each state the way the screen chip does', () => {
    expect(reviewStateLabel('awaiting-fix')).toBe('수정 중');
    expect(reviewStateLabel('awaiting-approval')).toBe('승인 대기');
    expect(reviewStateLabel('approved')).toBe('승인됨');
    expect(reviewStateLabel('folded')).toBe('접힘');
    expect(reviewStateLabel('rejected')).toBe('다시 수정 중');
    expect(reviewStateLabel('withdrawn')).toBe('되돌림');
  });

  it('tells a rejected thread apart from one still waiting for its first fixup', () => {
    const rejected = [decision('rejected', 'aaaa')];
    expect(reviewStateLabel(deriveThreadReviewState('t1', [], rejected))).toBe('다시 수정 중');
    expect(reviewStateLabel(deriveThreadReviewState('t1', [], []))).toBe('수정 중');
  });
});

describe('selectOpenThreads', () => {
  const threads = ['open', 'answered', 'rejected', 'retried', 'approved', 'folded'].map((id) => ({
    id,
  }));
  const fixupsByThread = new Map([
    ['answered', [fixup('aaaa', ['answered'])]],
    ['retried', [fixup('bbbb', ['retried']), fixup('cccc', ['retried'])]],
    ['approved', [fixup('dddd', ['approved'])]],
  ]);
  const decisions = [
    decision('rejected', 'zzzz', undefined, 'rejected'),
    decision('rejected', 'bbbb', undefined, 'retried'),
    decision('approved', 'dddd', undefined, 'approved'),
    decision('folded', 'eeee', undefined, 'folded'),
  ];

  it('keeps only threads still waiting for a fix or rejected without a new one', () => {
    expect(selectOpenThreads(threads, fixupsByThread, decisions).map((t) => t.id)).toEqual([
      'open',
      'rejected',
    ]);
  });

  it('leaves out a rejected thread the reviewer opened by editing', () => {
    const edited = {
      id: 'edited',
      messages: [{ author: REVIEWER_EDIT_AUTHOR }],
    };
    const edits = [decision('rejected', 'ffff', undefined, 'edited')];
    expect(selectOpenThreads([edited], new Map(), edits)).toEqual([]);
    expect(
      selectOpenThreads([{ ...edited, messages: [{ author: 'User' }] }], new Map(), edits),
    ).toHaveLength(1);
  });

  it('returns nothing when every thread has been answered or settled', () => {
    const settled = threads.filter((t) => t.id !== 'open' && t.id !== 'rejected');
    expect(selectOpenThreads(settled, fixupsByThread, decisions)).toEqual([]);
    expect(selectOpenThreads([], fixupsByThread, decisions)).toEqual([]);
  });
});

describe('pendingFixupFor', () => {
  it('returns the single fixup not yet rejected, and null when there are several or none', () => {
    expect(pendingFixupFor('t1', [fixup('aaaa')], [])?.sha).toBe('aaaa');
    expect(
      pendingFixupFor('t1', [fixup('aaaa'), fixup('bbbb')], [decision('rejected', 'aaaa')])?.sha,
    ).toBe('bbbb');
    expect(pendingFixupFor('t1', [fixup('aaaa'), fixup('bbbb')], [])).toBeNull();
    expect(pendingFixupFor('t1', [], [])).toBeNull();
  });
});

describe('mergeReviewDecisions', () => {
  it('unions by thread, kind and fixup, keeping the later copy and sorting by time', () => {
    const merged = mergeReviewDecisions(
      [decision('approved', 'aaaa', '2026-01-03T00:00:00Z')],
      [
        decision('rejected', 'zzzz', '2026-01-01T00:00:00Z'),
        decision('approved', 'aaaa', '2026-01-02T00:00:00Z'),
      ],
    );
    expect(merged.map((d) => [d.kind, d.at])).toEqual([
      ['rejected', '2026-01-01T00:00:00Z'],
      ['approved', '2026-01-03T00:00:00Z'],
    ]);
  });
});

describe('normalizeReviewDecisions', () => {
  it('drops entries that are not decisions', () => {
    expect(
      normalizeReviewDecisions([
        decision('approved', 'aaaa'),
        { threadId: 't1', kind: 'nope', fixupSha: 'a', at: 'x' },
        'garbage',
        null,
      ]),
    ).toHaveLength(1);
    expect(normalizeReviewDecisions(undefined)).toEqual([]);
  });

  it('keeps only the fields a decision has and drops a mistyped optional field', () => {
    expect(
      normalizeReviewDecisions([{ ...decision('approved', 'aaaa'), patchId: 'p', extra: 'x' }]),
    ).toEqual([{ ...decision('approved', 'aaaa'), patchId: 'p' }]);
    expect(normalizeReviewDecisions([{ ...decision('folded', 'aaaa'), targetSha: 1 }])).toEqual([]);
  });
});
