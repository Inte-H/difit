import { describe, expect, it } from 'vitest';

import type { ReviewDecision, ThreadFixup } from '../types/diff';

import { amendedMessagesByCommit } from './amendedMessages';

const TARGET = '1'.repeat(40);
const OTHER_TARGET = '2'.repeat(40);

const amend = (
  digit: string,
  after: string,
  { threadId = 't1', foldTargetSha = TARGET, patchId = `patch-${digit}` } = {},
): ThreadFixup => ({
  sha: digit.repeat(40),
  shortSha: digit.repeat(7),
  patchId,
  authoredAt: '2026-01-01T00:00:00Z',
  subject: 'amend! old subject',
  threadIds: [threadId],
  files: [],
  foldTargetSha,
  amendedMessage: { before: 'old subject', after },
});

const decision = (
  fixup: ThreadFixup,
  kind: ReviewDecision['kind'],
  threadId = fixup.threadIds[0] ?? '',
): ReviewDecision => ({ threadId, kind, fixupSha: fixup.sha, at: '2026-01-02T00:00:00Z' });

describe('amendedMessagesByCommit', () => {
  it('keys the message an amend! leaves by the commit it folds into', () => {
    const fixups = [
      amend('a', 'new subject\n\nnew body'),
      amend('b', 'other subject', { threadId: 't2', foldTargetSha: OTHER_TARGET }),
    ];

    expect(amendedMessagesByCommit(fixups, [])).toEqual(
      new Map([
        [TARGET, 'new subject\n\nnew body'],
        [OTHER_TARGET, 'other subject'],
      ]),
    );
  });

  it('leaves out fixups that carry no message or fold into no reviewed commit', () => {
    const plain = amend('a', 'unused');
    delete plain.amendedMessage;
    const outside = amend('b', 'outside subject');
    delete outside.foldTargetSha;

    expect(amendedMessagesByCommit([plain, outside], [])).toEqual(new Map());
  });

  it('takes the message the last amend! of a chain leaves', () => {
    const fixups = [amend('a', 'first try'), amend('b', 'second try', { threadId: 't2' })];

    expect(amendedMessagesByCommit(fixups, []).get(TARGET)).toBe('second try');
  });

  it('skips a rejected amend!', () => {
    const first = amend('a', 'first try');
    const second = amend('b', 'second try', { threadId: 't2' });

    expect(amendedMessagesByCommit([first], [decision(first, 'rejected')])).toEqual(new Map());
    expect(
      amendedMessagesByCommit([first, second], [decision(second, 'rejected')]).get(TARGET),
    ).toBe('first try');
  });

  it('skips an amend! rejected under its patch id after a rebase', () => {
    const fixup = amend('a', 'first try', { patchId: 'same' });
    const rejected: ReviewDecision = {
      threadId: 't1',
      kind: 'rejected',
      fixupSha: 'e'.repeat(40),
      patchId: 'same',
      at: '2026-01-02T00:00:00Z',
    };

    expect(amendedMessagesByCommit([fixup], [rejected])).toEqual(new Map());
  });

  it('skips an amend! answering a deleted thread', () => {
    const fixup = amend('a', 'first try');

    expect(amendedMessagesByCommit([fixup], [decision(fixup, 'deleted')])).toEqual(new Map());
  });

  it('leaves out a commit whose message a later squash! or amend! makes unknown', () => {
    const squash: ThreadFixup = {
      ...amend('b', 'unused', { threadId: 't2' }),
      subject: 'squash! old subject',
    };
    delete squash.amendedMessage;
    const unread = amend('c', 'unused', { threadId: 't3' });
    delete unread.amendedMessage;

    expect(amendedMessagesByCommit([amend('a', 'first try'), squash], [])).toEqual(new Map());
    expect(amendedMessagesByCommit([amend('a', 'first try'), unread], [])).toEqual(new Map());
    expect(
      amendedMessagesByCommit([amend('a', 'first try'), squash], [decision(squash, 'rejected')]),
    ).toEqual(new Map([[TARGET, 'first try']]));
  });

  it('keeps a plain fixup after an amend! from hiding the message', () => {
    const plain: ThreadFixup = {
      ...amend('b', 'unused', { threadId: 't2' }),
      subject: 'fixup! old subject',
    };
    delete plain.amendedMessage;

    expect(amendedMessagesByCommit([amend('a', 'first try'), plain], []).get(TARGET)).toBe(
      'first try',
    );
  });

  it('leaves out a commit the amend! leaves with the message it has now', () => {
    expect(amendedMessagesByCommit([amend('a', 'old subject')], [])).toEqual(new Map());

    const first = amend('a', 'first try');
    const restoring: ThreadFixup = {
      ...amend('b', 'old subject', { threadId: 't2' }),
      amendedMessage: { before: 'first try', after: 'old subject' },
    };
    expect(amendedMessagesByCommit([first, restoring], [decision(first, 'rejected')])).toEqual(
      new Map(),
    );
  });

  it('keeps an approved amend!', () => {
    const fixup = amend('a', 'first try');

    expect(amendedMessagesByCommit([fixup], [decision(fixup, 'approved')]).get(TARGET)).toBe(
      'first try',
    );
  });
});
