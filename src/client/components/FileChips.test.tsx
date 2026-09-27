import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import type { CommentThread, DiffFile } from '../../types/diff';

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

describe('FileChips', () => {
  const files = [createFile('src/lib/strings.js'), createFile('calc.js')];

  it('shows one chip per file named by its base name and jumps to the file when tapped', () => {
    const onScrollToFile = vi.fn();
    render(
      <FileChips
        files={files}
        comments={[]}
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
});
