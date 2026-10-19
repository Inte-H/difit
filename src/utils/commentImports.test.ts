import { describe, expect, it, vi } from 'vitest';

import type { CommentImport, DiffCommentThread } from '../types/diff';

import {
  mergeCommentImports,
  mergeCommentThreads,
  normalizeCommentImports,
  parseCommentImportValue,
  serializeCommentImports,
} from './commentImports';

function createThread({
  id,
  filePath = 'src/example.ts',
  side = 'new',
  line = 10,
  body,
  updatedAt = '2024-01-01T00:00:00.000Z',
}: {
  id: string;
  filePath?: string;
  side?: 'old' | 'new';
  line?: number;
  body: string;
  updatedAt?: string;
}): DiffCommentThread {
  return {
    id,
    filePath,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt,
    position: {
      side,
      line,
    },
    messages: [
      {
        id,
        body,
        author: 'User',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt,
      },
    ],
  };
}

const PIN_SHA = '1111111111111111111111111111111111111111';
const BASE_SHA = '0000000000000000000000000000000000000000';
const PIN_VIEW = { baseCommitish: BASE_SHA, targetCommitish: PIN_SHA };

function createBoundThread(args: Parameters<typeof createThread>[0]): DiffCommentThread {
  return { ...createThread(args), view: PIN_VIEW, fixupTarget: PIN_SHA };
}

describe('commentImports', () => {
  describe('parseCommentImportValue', () => {
    it('parses a single thread import', () => {
      const imports = parseCommentImportValue(
        JSON.stringify({
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Review comment',
        }),
      );

      expect(imports).toEqual([
        {
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Review comment',
          id: undefined,
          author: 'Agent',
          createdAt: undefined,
          updatedAt: undefined,
          codeSnapshot: undefined,
        },
      ]);
    });

    it('parses an array of imports', () => {
      const imports = parseCommentImportValue(
        JSON.stringify([
          {
            type: 'thread',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Root',
          },
          {
            type: 'reply',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Reply',
          },
        ]),
      );

      expect(imports).toHaveLength(2);
      expect(imports[0]?.type).toBe('thread');
      expect(imports[1]?.type).toBe('reply');
    });

    it('gives the agent author to threads and replies sent without one', () => {
      const imports = parseCommentImportValue(
        JSON.stringify([
          {
            type: 'thread',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Root',
          },
          {
            type: 'reply',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Reply',
            author: '   ',
          },
        ]),
      );

      expect(imports.map((entry) => entry.author)).toEqual(['Agent', 'Agent']);
    });

    it('keeps the author the import names', () => {
      const imports = parseCommentImportValue(
        JSON.stringify({
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Review comment',
          author: 'claude',
        }),
      );

      expect(imports[0]?.author).toBe('claude');
    });

    it('keeps the commit a snapshot was taken from', () => {
      const imports = parseCommentImportValue(
        JSON.stringify({
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Review comment',
          codeSnapshot: { content: 'const value = 1;', commit: '6e4f6d5' },
        }),
      );

      expect(imports[0]?.codeSnapshot).toEqual({
        content: 'const value = 1;',
        language: undefined,
        commit: '6e4f6d5',
      });
      expect(mergeCommentImports([], imports).threads[0]?.codeSnapshot?.commit).toBe('6e4f6d5');
    });

    it('rejects malformed json', () => {
      expect(() => parseCommentImportValue('{')).toThrow('Invalid --comment JSON');
    });

    it('rejects invalid import shape', () => {
      expect(() =>
        parseCommentImportValue(
          JSON.stringify({
            type: 'thread',
            filePath: '',
            position: { side: 'new', line: 0 },
            body: '',
          }),
        ),
      ).toThrow('Invalid comment import field: filePath');
    });
  });

  describe('serializeCommentImports', () => {
    it('creates a stable payload string for hashing', () => {
      const commentImports: CommentImport[] = [
        {
          type: 'thread',
          id: 'thread-1',
          filePath: 'src/example.ts',
          position: { side: 'new', line: { start: 10, end: 12 } },
          body: 'Root',
          author: 'AI',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          codeSnapshot: { content: 'const value = 1;' },
        },
      ];

      expect(serializeCommentImports(commentImports)).toBe(
        JSON.stringify([
          {
            type: 'thread',
            id: 'thread-1',
            filePath: 'src/example.ts',
            position: { side: 'new', line: { start: 10, end: 12 } },
            body: 'Root',
            author: 'AI',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z',
            codeSnapshot: { content: 'const value = 1;', language: undefined, commit: undefined },
          },
        ]),
      );
    });
  });

  describe('mergeCommentImports', () => {
    it('adds a new thread import', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-02-01T00:00:00.000Z'));

      const result = mergeCommentImports(
        [],
        [
          {
            type: 'thread',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported thread',
          },
        ],
      );

      expect(result.warnings).toEqual([]);
      expect(result.threads).toHaveLength(1);
      expect(result.threads[0]?.messages[0]?.body).toBe('Imported thread');

      vi.useRealTimers();
    });

    it('skips a duplicate thread import with the same root message', () => {
      const existing = [createThread({ id: 'thread-1', body: 'Imported thread' })];

      const result = mergeCommentImports(existing, [
        {
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Imported thread',
          author: 'User',
        },
      ]);

      expect(result.threads).toHaveLength(1);
    });

    it('adds a reply to the newest matching thread', () => {
      const olderThread = createThread({
        id: 'thread-1',
        body: 'Root 1',
        updatedAt: '2024-01-01T00:00:00.000Z',
      });
      const newerThread = createThread({
        id: 'thread-2',
        body: 'Root 2',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = mergeCommentImports(
        [olderThread, newerThread],
        [
          {
            type: 'reply',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported reply',
            author: 'AI',
          },
        ],
      );

      expect(result.threads[0]?.messages).toHaveLength(1);
      expect(result.threads[1]?.messages).toHaveLength(2);
      expect(result.threads[1]?.messages[1]?.body).toBe('Imported reply');
    });

    it('skips a duplicate reply import', () => {
      const existing = createThread({ id: 'thread-1', body: 'Root' });
      existing.messages.push({
        id: 'reply-1',
        body: 'Imported reply',
        author: 'AI',
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
      });

      const result = mergeCommentImports(
        [existing],
        [
          {
            type: 'reply',
            id: 'reply-1',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported reply',
            author: 'AI',
          },
        ],
      );

      expect(result.threads[0]?.messages).toHaveLength(2);
    });

    it('warns and skips reply import when no matching thread exists', () => {
      const result = mergeCommentImports(
        [],
        [
          {
            type: 'reply',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 10 },
            body: 'Imported reply',
          },
        ],
      );

      expect(result.threads).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Skipped reply import');
    });

    it('leaves a stored message without an author as it is', () => {
      const stored = createThread({ id: 'stored', body: 'Old agent remark' });
      const existing = [
        {
          ...stored,
          messages: stored.messages.map(({ author: _author, ...message }) => message),
        },
      ];

      const result = mergeCommentImports(
        existing,
        parseCommentImportValue(
          JSON.stringify({
            type: 'thread',
            filePath: 'src/example.ts',
            position: { side: 'new', line: 20 },
            body: 'New agent remark',
          }),
        ),
      );

      expect(result.threads.map((thread) => thread.messages[0]?.author)).toEqual([
        undefined,
        'Agent',
      ]);
    });
  });

  describe('normalizeCommentImports', () => {
    it('leaves a missing author empty', () => {
      const imports = normalizeCommentImports({
        type: 'thread',
        filePath: 'src/example.ts',
        position: { side: 'new', line: 10 },
        body: 'Review comment',
      });

      expect(imports[0]?.author).toBeUndefined();
    });
  });
  describe('the view a thread was made on and its fixup target', () => {
    it('keeps them through a merge whether the thread is in the existing set, the incoming one or both', () => {
      const onlyExisting = createBoundThread({ id: 'a', body: 'a', line: 1 });
      const onlyIncoming = createBoundThread({ id: 'b', body: 'b', line: 2 });
      const inBoth = createBoundThread({ id: 'c', body: 'c', line: 3 });
      const incomingCopy = { ...createThread({ id: 'c', body: 'c', line: 3 }) };

      const { threads } = mergeCommentThreads([onlyExisting, inBoth], [onlyIncoming, incomingCopy]);

      for (const thread of threads) {
        expect(thread.view).toEqual(PIN_VIEW);
        expect(thread.fixupTarget).toBe(PIN_SHA);
      }
      expect(threads).toHaveLength(3);
    });

    it('takes them from the incoming copy when only that copy has them', () => {
      const existing = createThread({ id: 'c', body: 'c' });
      const incoming = createBoundThread({ id: 'c', body: 'c' });

      const [merged] = mergeCommentThreads([existing], [incoming]).threads;

      expect(merged?.view).toEqual(PIN_VIEW);
      expect(merged?.fixupTarget).toBe(PIN_SHA);
    });

    it('keeps them when an agent reply is added to the thread', () => {
      const thread = createBoundThread({ id: 'a', body: 'Fix this' });

      const { threads } = mergeCommentImports(
        [thread],
        [
          {
            type: 'reply',
            filePath: thread.filePath,
            position: thread.position,
            body: 'Done',
            author: 'Agent',
          },
        ],
      );

      expect(threads[0]?.messages).toHaveLength(2);
      expect(threads[0]?.view).toEqual(PIN_VIEW);
      expect(threads[0]?.fixupTarget).toBe(PIN_SHA);
    });

    it('adds no such keys to a thread that has none', () => {
      const thread = createThread({ id: 'a', body: 'a' });

      const [merged] = mergeCommentThreads([thread], [thread]).threads;
      const [replied] = mergeCommentImports(
        [thread],
        [{ type: 'reply', filePath: thread.filePath, position: thread.position, body: 'x' }],
      ).threads;

      expect(merged).not.toHaveProperty('view');
      expect(merged).not.toHaveProperty('fixupTarget');
      expect(replied).not.toHaveProperty('view');
      expect(replied).not.toHaveProperty('fixupTarget');
    });

    it('carries them from a thread import into the new thread', () => {
      const imports = parseCommentImportValue(
        JSON.stringify({
          type: 'thread',
          id: 'moved',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Review comment',
          view: PIN_VIEW,
          fixupTarget: PIN_SHA,
        }),
      );

      const [thread] = mergeCommentImports([], imports).threads;

      expect(thread?.view).toEqual(PIN_VIEW);
      expect(thread?.fixupTarget).toBe(PIN_SHA);
    });

    it('keeps the base mode of an imported view', () => {
      const view = { ...PIN_VIEW, baseMode: 'merge-base' };
      const [entry] = normalizeCommentImports({
        type: 'thread',
        filePath: 'src/example.ts',
        position: { side: 'new', line: 10 },
        body: 'Review comment',
        view,
      });

      expect(entry?.view).toEqual(view);
    });

    it('leaves the keys out of an import that has neither', () => {
      const [entry] = normalizeCommentImports({
        type: 'thread',
        filePath: 'src/example.ts',
        position: { side: 'new', line: 10 },
        body: 'Review comment',
      });
      const [thread] = mergeCommentImports([], entry ? [entry] : []).threads;

      expect(entry).not.toHaveProperty('view');
      expect(entry).not.toHaveProperty('fixupTarget');
      expect(thread).not.toHaveProperty('view');
      expect(thread).not.toHaveProperty('fixupTarget');
    });

    it('makes them part of the import id', () => {
      const entry = {
        type: 'thread' as const,
        filePath: 'src/example.ts',
        position: { side: 'new' as const, line: 10 },
        body: 'Review comment',
      };

      expect(
        serializeCommentImports([{ ...entry, fixupTarget: PIN_SHA, view: PIN_VIEW }]),
      ).not.toBe(serializeCommentImports([entry]));
    });

    it.each([
      ['a fixup target that is not a commit hash', { fixupTarget: 'main' }, 'fixupTarget'],
      ['a view that is not an object', { view: 'abc..def' }, 'view'],
      [
        'a view with an empty end',
        { view: { baseCommitish: BASE_SHA, targetCommitish: '' } },
        'view',
      ],
      [
        'a view with an unknown base mode',
        { view: { ...PIN_VIEW, baseMode: 'triple-dot' } },
        'view',
      ],
    ])('rejects %s', (_label, fields, fieldName) => {
      expect(() =>
        normalizeCommentImports({
          type: 'thread',
          filePath: 'src/example.ts',
          position: { side: 'new', line: 10 },
          body: 'Review comment',
          ...fields,
        }),
      ).toThrow(`Invalid comment import field: ${fieldName}`);
    });
  });
});
