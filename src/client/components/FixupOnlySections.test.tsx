import { render, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_FIXUP_OVERLAY } from '../contexts/FixupOverlayContext';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';
import type { FixupOnlyFiles } from '../utils/fixupSpread';
import { symbolRequestFromTarget } from '../utils/symbolPeek';

import type { DiffViewer as RealDiffViewer } from './DiffViewer';
import { FixupOnlySections } from './FixupOnlySections';

const viewerProps = vi.hoisted(() => [] as Array<ComponentProps<typeof RealDiffViewer>>);

vi.mock('./DiffViewer', async (importActual) => {
  const { DiffViewer } = await importActual<{ DiffViewer: typeof RealDiffViewer }>();
  return {
    DiffViewer: (props: ComponentProps<typeof RealDiffViewer>) => {
      viewerProps.push(props);
      return <DiffViewer {...props} />;
    },
  };
});

const FIXUP_SHA = 'f'.repeat(40);
const groupAnswering = (threadIds: string[]): FixupOnlyFiles => ({
  fixup: {
    sha: FIXUP_SHA,
    shortSha: 'fffffff',
    patchId: 'patch-1',
    authoredAt: '2026-01-01T00:00:00Z',
    subject: 'fixup! step',
    threadIds,
    files: [],
  },
  threads: threadIds.map((id) => ({ id, file: 'a.ts', line: 1, isOutdated: false })),
  files: [
    {
      path: 'p.ts',
      status: 'added',
      chunks: [
        {
          header: '@@ -0,0 +1,1 @@',
          oldStart: 0,
          oldLines: 0,
          newStart: 1,
          newLines: 1,
          lines: [{ type: 'add', content: 'p one', newLineNumber: 1 }],
        },
      ],
    },
  ],
});

const onAddComment = vi.fn(() => Promise.resolve());
const props = (
  group: FixupOnlyFiles,
  diffMode: 'unified' | 'split' = 'unified',
): ComponentProps<typeof FixupOnlySections> => ({
  groups: [group],
  firstFileIndex: 0,
  threadsByFixupFile: new Map(),
  onAddComment,
  fixupOverlay: EMPTY_FIXUP_OVERLAY,
  diffMode,
  onResolveThread: vi.fn(),
  onReplyToThread: vi.fn(() => Promise.resolve()),
  onRemoveMessage: vi.fn(),
  onUpdateMessage: vi.fn(),
});

const renderSections = (sectionProps: ComponentProps<typeof FixupOnlySections>) =>
  render(<FixupOnlySections {...sectionProps} />, { wrapper: WordHighlightProvider });

describe('FixupOnlySections', () => {
  it('keeps the comment handler of a section when its group is rebuilt for the same fixup', () => {
    const { rerender } = renderSections(props(groupAnswering(['c1'])));
    const before = viewerProps.at(-1)?.onAddComment;

    rerender(<FixupOnlySections {...props(groupAnswering(['c1', 'c2']))} />);

    const after = viewerProps.at(-1)?.onAddComment as (...comment: unknown[]) => Promise<void>;
    expect(after).toBe(before);
    void after('p.ts', 1, 'Name it');
    expect(onAddComment).toHaveBeenCalledWith(FIXUP_SHA, 'p.ts', 1, 'Name it');
  });
});

describe.each(['unified', 'split'] as const)('names clicked in a fixup-only file (%s)', (mode) => {
  const refs = { base: 'base111', target: 'target2' };
  const renamedGroup: FixupOnlyFiles = {
    ...groupAnswering([]),
    files: [
      {
        path: 'src/new.ts',
        oldPath: 'src/old.ts',
        status: 'renamed',
        chunks: [
          {
            header: '@@ -2,2 +2,2 @@',
            oldStart: 2,
            oldLines: 2,
            newStart: 2,
            newLines: 2,
            lines: [
              { type: 'normal', content: 'const kept = 0;', oldLineNumber: 2, newLineNumber: 2 },
              { type: 'delete', content: 'const oldHelper = 1;', oldLineNumber: 3 },
              { type: 'add', content: 'const newHelper = 1;', newLineNumber: 3 },
            ],
          },
        ],
      },
    ],
  };

  async function clicked(scope: Element, word: string, side = '') {
    const token = await waitFor(() => {
      const found = scope.querySelector(`${side} .word-token[data-word="${word}"]`);
      expect(found).not.toBeNull();
      return found!;
    });
    return symbolRequestFromTarget(token, refs);
  }

  it('looks a name up in the fixup commit, and on a deleted line in its parent', async () => {
    const { container } = renderSections(props(renamedGroup, mode));

    expect(await clicked(container, 'newHelper')).toEqual({
      name: 'newHelper',
      ref: FIXUP_SHA,
      from: 'src/new.ts',
      line: 3,
      column: 6,
    });
    expect(await clicked(container, 'kept', '[data-symbol-side="new"]')).toEqual({
      name: 'kept',
      ref: FIXUP_SHA,
      from: 'src/new.ts',
      line: 2,
      column: 6,
    });
    expect(await clicked(container, 'oldHelper')).toEqual({
      name: 'oldHelper',
      ref: `${FIXUP_SHA}^`,
      from: 'src/old.ts',
      line: 3,
      column: 6,
    });
  });
});
