import { describe, expect, it } from 'vitest';

import type { ReviewDecision, ThreadFixup } from '../types/diff';

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
  it('unions by thread, kind and fixup, keeping the incoming copy and sorting by time', () => {
    const merged = mergeReviewDecisions(
      [decision('approved', 'aaaa', '2026-01-03T00:00:00Z')],
      [
        decision('rejected', 'zzzz', '2026-01-01T00:00:00Z'),
        decision('approved', 'aaaa', '2026-01-02T00:00:00Z'),
      ],
    );
    expect(merged.map((d) => [d.kind, d.at])).toEqual([
      ['rejected', '2026-01-01T00:00:00Z'],
      ['approved', '2026-01-02T00:00:00Z'],
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
});
