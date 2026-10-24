import { render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { EMPTY_FIXUP_OVERLAY } from '../contexts/FixupOverlayContext';
import type { FixupOnlyFiles } from '../utils/fixupSpread';

import { FixupOnlySections } from './FixupOnlySections';

const viewerProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('./DiffViewer', () => ({
  DiffViewer: (props: Record<string, unknown>) => {
    viewerProps.push(props);
    return null;
  },
}));

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

describe('FixupOnlySections', () => {
  it('keeps the comment handler of a section when its group is rebuilt for the same fixup', () => {
    const onAddComment = vi.fn(() => Promise.resolve());
    const props = (group: FixupOnlyFiles): ComponentProps<typeof FixupOnlySections> => ({
      groups: [group],
      firstFileIndex: 0,
      threadsByFixupFile: new Map(),
      onAddComment,
      fixupOverlay: EMPTY_FIXUP_OVERLAY,
      diffMode: 'unified',
      onResolveThread: vi.fn(),
      onReplyToThread: vi.fn(() => Promise.resolve()),
      onRemoveMessage: vi.fn(),
      onUpdateMessage: vi.fn(),
    });
    const { rerender } = render(<FixupOnlySections {...props(groupAnswering(['c1']))} />);
    const before = viewerProps.at(-1)?.onAddComment;

    rerender(<FixupOnlySections {...props(groupAnswering(['c1', 'c2']))} />);

    const after = viewerProps.at(-1)?.onAddComment as (...comment: unknown[]) => Promise<void>;
    expect(after).toBe(before);
    void after('p.ts', 1, 'Name it');
    expect(onAddComment).toHaveBeenCalledWith(FIXUP_SHA, 'p.ts', 1, 'Name it');
  });
});
