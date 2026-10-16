import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import type { CommentThread, DiffFile, ReviewDecision } from '../../types/diff';

import { FileChips } from './FileChips';

const createFile = (path: string): DiffFile => ({
  path,
  status: 'modified',
  additions: 1,
  deletions: 1,
  chunks: [],
});

const createThread = (id: string, file: string): CommentThread => ({
  id,
  file,
  line: 1,
  side: 'new',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  messages: [],
});

const decide = (threadId: string, kind: 'resolved' | 'unresolved', at: string): ReviewDecision => ({
  threadId,
  kind,
  fixupSha: '',
  at,
});

describe('FileChips', () => {
  const files = [createFile('src/lib/strings.js'), createFile('calc.js')];

  it('shows one chip per file named by its base name and jumps to the file when tapped', () => {
    const onScrollToFile = vi.fn();
    render(
      <FileChips
        files={files}
        comments={[]}
        decisions={[]}
        reviewedFiles={new Set()}
        selectedFileIndex={null}
        onScrollToFile={onScrollToFile}
      />,
    );

    const chips = within(screen.getByRole('navigation', { name: 'Changed files' })).getAllByRole(
      'button',
    );
    expect(chips.map((chip) => chip.textContent)).toEqual(['strings.js', 'calc.js']);
    expect(chips[0]).toHaveAttribute('title', 'src/lib/strings.js');

    fireEvent.click(chips[0]!);
    expect(onScrollToFile).toHaveBeenCalledWith('src/lib/strings.js');
  });

  it('counts comments per file and marks viewed and current files', () => {
    render(
      <FileChips
        files={files}
        comments={[createThread('a', 'calc.js'), createThread('b', 'calc.js')]}
        decisions={[]}
        reviewedFiles={new Set(['src/lib/strings.js'])}
        selectedFileIndex={1}
        onScrollToFile={vi.fn()}
      />,
    );

    const viewed = screen.getByTitle('src/lib/strings.js');
    const current = screen.getByTitle('calc.js');
    expect(viewed).toHaveAttribute('data-viewed', 'true');
    expect(viewed).not.toHaveAttribute('aria-current');
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(within(current).getByLabelText('2 comments')).toHaveTextContent('2');
    expect(within(viewed).queryByLabelText(/comments/)).not.toBeInTheDocument();
  });

  it('counts only unresolved threads, including reopened ones', () => {
    render(
      <FileChips
        files={files}
        comments={[
          createThread('a', 'src/lib/strings.js'),
          createThread('b', 'calc.js'),
          createThread('c', 'calc.js'),
          createThread('d', 'calc.js'),
        ]}
        decisions={[
          decide('a', 'resolved', '2026-01-02T00:00:00.000Z'),
          decide('b', 'resolved', '2026-01-02T00:00:00.000Z'),
          decide('c', 'resolved', '2026-01-02T00:00:00.000Z'),
          decide('c', 'unresolved', '2026-01-03T00:00:00.000Z'),
        ]}
        reviewedFiles={new Set()}
        selectedFileIndex={null}
        onScrollToFile={vi.fn()}
      />,
    );

    expect(
      within(screen.getByTitle('src/lib/strings.js')).queryByLabelText(/comments/),
    ).not.toBeInTheDocument();
    expect(within(screen.getByTitle('calc.js')).getByLabelText('2 comments')).toHaveTextContent(
      '2',
    );
  });
});
