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

  it('marks the file of the picked comment apart from the cursor', () => {
    render(
      <FileChips
        files={files}
        comments={[]}
        decisions={[]}
        reviewedFiles={new Set()}
        selectedFileIndex={0}
        pickedCommentFilePath="calc.js"
        onScrollToFile={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'calc.js' })).toHaveAttribute(
      'data-picked-comment',
      'true',
    );
    expect(screen.getByRole('button', { name: 'strings.js' })).not.toHaveAttribute(
      'data-picked-comment',
    );
  });

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
  describe('file at the top of the diff', () => {
    const manyFiles = ['a.js', 'b.js', 'c.js', 'd.js', 'e.js'].map((path) => createFile(path));

    function renderChips(selectedFileIndex: number | null, scrollVisibleFileIndex?: number | null) {
      return (
        <FileChips
          files={manyFiles}
          comments={[]}
          decisions={[]}
          reviewedFiles={new Set()}
          selectedFileIndex={selectedFileIndex}
          scrollVisibleFileIndex={scrollVisibleFileIndex}
          onScrollToFile={vi.fn()}
        />
      );
    }

    function stubBox(element: HTMLElement, left: number, width: number) {
      element.getBoundingClientRect = () =>
        ({ top: 0, bottom: 30, left, right: left + width, width, height: 30 }) as DOMRect;
    }

    function stubStrip(scrollLeft: number) {
      const strip = screen.getByRole('navigation', { name: 'Changed files' });
      stubBox(strip, 0, 300);
      Object.defineProperty(strip, 'clientWidth', { configurable: true, value: 300 });
      strip.scrollLeft = scrollLeft;
      return strip;
    }

    it('marks the file at the top apart from the cursor chip', () => {
      render(renderChips(0, 2));

      const cursorChip = screen.getByTitle('a.js');
      const visibleChip = screen.getByTitle('c.js');
      expect(cursorChip).toHaveAttribute('aria-current', 'true');
      expect(cursorChip).not.toHaveAttribute('data-scroll-visible');
      expect(visibleChip).toHaveAttribute('data-scroll-visible', 'true');
      expect(visibleChip).not.toHaveAttribute('aria-current');
    });

    it('shows both marks on one chip when they point at the same file', () => {
      render(renderChips(3, 3));

      const chip = screen.getByTitle('d.js');
      expect(chip).toHaveAttribute('aria-current', 'true');
      expect(chip).toHaveAttribute('data-scroll-visible', 'true');
    });

    it('scrolls the strip until the marked chip fits', () => {
      const { rerender } = render(renderChips(null));
      const strip = stubStrip(0);
      stubBox(screen.getByTitle('e.js'), 400, 60);

      rerender(renderChips(null, 4));

      expect(strip.scrollLeft).toBe(160);
    });

    it('scrolls the strip back for a chip left of the view', () => {
      const { rerender } = render(renderChips(null));
      const strip = stubStrip(200);
      stubBox(screen.getByTitle('a.js'), -180, 60);

      rerender(renderChips(null, 0));

      expect(strip.scrollLeft).toBe(20);
    });

    it('leaves the strip alone when the marked chip is in view', () => {
      const { rerender } = render(renderChips(null));
      const strip = stubStrip(50);
      stubBox(screen.getByTitle('b.js'), 100, 60);

      rerender(renderChips(null, 1));

      expect(strip.scrollLeft).toBe(50);
    });

    it('does not scroll the strip when the same files arrive as a new array', () => {
      const { rerender } = render(renderChips(null));
      const strip = stubStrip(0);
      stubBox(screen.getByTitle('e.js'), 400, 60);
      rerender(renderChips(null, 4));
      strip.scrollLeft = 0;

      rerender(
        <FileChips
          files={manyFiles.map((file) => ({ ...file }))}
          comments={[]}
          decisions={[]}
          reviewedFiles={new Set()}
          selectedFileIndex={null}
          scrollVisibleFileIndex={4}
          onScrollToFile={vi.fn()}
        />,
      );

      expect(strip.scrollLeft).toBe(0);
    });
  });
});
