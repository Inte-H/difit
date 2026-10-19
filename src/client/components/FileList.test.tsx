import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import type { CommentThread, DiffFile, ReviewDecision } from '../../types/diff';

import { FileList } from './FileList';

const createFile = (
  path: string,
  totals: { additions?: number; deletions?: number } = {},
): DiffFile => ({
  path,
  status: 'modified',
  additions: totals.additions ?? 1,
  deletions: totals.deletions ?? 1,
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

function getTreeRow(title: string): HTMLElement {
  const row = screen.getByTitle(title).closest<HTMLElement>('[data-tree-row="true"]');
  expect(row).not.toBeNull();
  return row as HTMLElement;
}

function getLabel(title: string): HTMLElement {
  return screen.getByTitle(title);
}

describe('FileList', () => {
  it('renders total additions and deletions beside the file count', () => {
    render(
      <FileList
        files={[
          createFile('README.md', { additions: 3, deletions: 1 }),
          createFile('src/client/App.tsx', { additions: 2, deletions: 4 }),
        ]}
        onScrollToFile={vi.fn()}
        comments={[]}
        decisions={[]}
        reviewedFiles={new Set()}
        onToggleReviewed={vi.fn()}
        onToggleFolderReviewed={vi.fn()}
        selectedFileIndex={null}
      />,
    );

    expect(screen.getByText('Files changed (2)')).toBeInTheDocument();
    expect(screen.getByLabelText('5 additions and 5 deletions')).toBeInTheDocument();
    expect(screen.getByText('+5')).toBeInTheDocument();
    expect(screen.getByText('-5')).toBeInTheDocument();
  });

  it('strikes through directories when all descendant files are reviewed', () => {
    const files = [
      createFile('src/cli/index.ts'),
      createFile('src/client/App.tsx'),
      createFile('README.md'),
    ];
    const props = {
      files,
      onScrollToFile: vi.fn(),
      comments: [],
      decisions: [],
      onToggleReviewed: vi.fn(),
      onToggleFolderReviewed: vi.fn(),
      selectedFileIndex: null,
    };
    const { rerender } = render(
      <FileList {...props} reviewedFiles={new Set(['README.md', 'src/cli/index.ts'])} />,
    );

    expect(getLabel('src')).not.toHaveClass('line-through');
    expect(getTreeRow('src')).not.toHaveClass('opacity-70');
    expect(getLabel('cli')).toHaveClass('line-through');
    expect(getTreeRow('cli')).toHaveClass('opacity-70');
    expect(getLabel('client')).not.toHaveClass('line-through');
    expect(getTreeRow('client')).not.toHaveClass('opacity-70');

    rerender(
      <FileList
        {...props}
        reviewedFiles={new Set(['README.md', 'src/cli/index.ts', 'src/client/App.tsx'])}
      />,
    );

    expect(getLabel('src')).toHaveClass('line-through');
    expect(getTreeRow('src')).toHaveClass('opacity-70');
    expect(getLabel('cli')).toHaveClass('line-through');
    expect(getTreeRow('cli')).toHaveClass('opacity-70');
    expect(getLabel('client')).toHaveClass('line-through');
    expect(getTreeRow('client')).toHaveClass('opacity-70');
  });

  it('marks all files in a folder as reviewed via the directory checkbox', () => {
    const onToggleFolderReviewed = vi.fn();
    render(
      <FileList
        files={[
          createFile('src/cli/index.ts'),
          createFile('src/client/App.tsx'),
          createFile('README.md'),
        ]}
        onScrollToFile={vi.fn()}
        comments={[]}
        decisions={[]}
        reviewedFiles={new Set()}
        onToggleReviewed={vi.fn()}
        onToggleFolderReviewed={onToggleFolderReviewed}
        selectedFileIndex={null}
      />,
    );

    const checkbox = within(getTreeRow('src')).getByRole('checkbox');
    expect(checkbox).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(checkbox);
    expect(onToggleFolderReviewed).toHaveBeenCalledWith('src', true);
  });

  it('renders both a file row and directory children when a path is both a file and a directory prefix', () => {
    const onScrollToFile = vi.fn();
    render(
      <FileList
        files={[
          { ...createFile('vendor'), status: 'deleted' },
          createFile('vendor/lib.ts'),
          createFile('vendor/utils.ts'),
        ]}
        onScrollToFile={onScrollToFile}
        comments={[]}
        decisions={[]}
        reviewedFiles={new Set()}
        onToggleReviewed={vi.fn()}
        onToggleFolderReviewed={vi.fn()}
        selectedFileIndex={null}
      />,
    );

    expect(screen.getByTitle('vendor/lib.ts')).toBeInTheDocument();
    expect(screen.getByTitle('vendor/utils.ts')).toBeInTheDocument();

    const vendorElements = screen.getAllByTitle('vendor');
    const vendorFileRow = vendorElements
      .map((el) => el.closest('[data-file-row="true"]'))
      .find(Boolean);
    expect(vendorFileRow).toBeDefined();
    fireEvent.click(vendorFileRow!);
    expect(onScrollToFile).toHaveBeenCalledWith('vendor');
  });

  it('unmarks all files in a fully reviewed folder via the directory checkbox', () => {
    const onToggleFolderReviewed = vi.fn();
    render(
      <FileList
        files={[createFile('src/cli/index.ts'), createFile('src/client/App.tsx')]}
        onScrollToFile={vi.fn()}
        comments={[]}
        decisions={[]}
        reviewedFiles={new Set(['src/cli/index.ts', 'src/client/App.tsx'])}
        onToggleReviewed={vi.fn()}
        onToggleFolderReviewed={onToggleFolderReviewed}
        selectedFileIndex={null}
      />,
    );

    const checkbox = within(getTreeRow('src')).getByRole('checkbox');
    expect(checkbox).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(checkbox);
    expect(onToggleFolderReviewed).toHaveBeenCalledWith('src', false);
  });

  it('counts only unresolved threads, including reopened ones', () => {
    render(
      <FileList
        files={[createFile('README.md'), createFile('calc.js')]}
        onScrollToFile={vi.fn()}
        comments={[
          createThread('a', 'README.md'),
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
        onToggleReviewed={vi.fn()}
        onToggleFolderReviewed={vi.fn()}
        selectedFileIndex={null}
      />,
    );

    expect(getTreeRow('README.md')).toHaveTextContent(/^README\.md$/);
    expect(getTreeRow('calc.js')).toHaveTextContent(/^calc\.js2$/);
  });
  describe('file at the top of the diff', () => {
    const baseProps = {
      onScrollToFile: vi.fn(),
      comments: [],
      decisions: [],
      reviewedFiles: new Set<string>(),
      onToggleReviewed: vi.fn(),
      onToggleFolderReviewed: vi.fn(),
    };

    function stubBox(element: HTMLElement, top: number, height: number) {
      element.getBoundingClientRect = () =>
        ({ top, bottom: top + height, left: 0, right: 0, width: 0, height }) as DOMRect;
    }

    function stubListViewport(scrollTop: number) {
      const list = document
        .querySelector<HTMLElement>('[data-tree-row="true"]')!
        .closest<HTMLElement>('.overflow-y-auto')!;
      stubBox(list, 100, 200);
      Object.defineProperty(list, 'clientHeight', { configurable: true, value: 200 });
      list.scrollTop = scrollTop;
      return list;
    }

    it('marks the file at the top apart from the cursor file', () => {
      render(
        <FileList
          {...baseProps}
          files={[createFile('README.md'), createFile('calc.js')]}
          selectedFileIndex={0}
          scrollVisibleFileIndex={1}
        />,
      );

      const cursorRow = getTreeRow('README.md');
      const visibleRow = getTreeRow('calc.js');
      expect(cursorRow).toHaveAttribute('aria-current', 'true');
      expect(cursorRow).toHaveClass('bg-github-bg-tertiary');
      expect(cursorRow).not.toHaveAttribute('data-scroll-visible');
      expect(visibleRow).toHaveAttribute('data-scroll-visible', 'true');
      expect(visibleRow).not.toHaveAttribute('aria-current');
      expect(visibleRow).not.toHaveClass('bg-github-bg-tertiary');
    });

    it('shows both marks on one row when they point at the same file', () => {
      render(
        <FileList
          {...baseProps}
          files={[createFile('README.md'), createFile('calc.js')]}
          selectedFileIndex={1}
          scrollVisibleFileIndex={1}
        />,
      );

      const row = getTreeRow('calc.js');
      expect(row).toHaveAttribute('aria-current', 'true');
      expect(row).toHaveAttribute('data-scroll-visible', 'true');
      expect(getTreeRow('README.md')).not.toHaveAttribute('data-scroll-visible');
    });

    const flatFiles = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'].map((path) =>
      createFile(path),
    );

    it('scrolls the list down until the marked row fits', () => {
      const { rerender } = render(
        <FileList {...baseProps} files={flatFiles} selectedFileIndex={null} />,
      );
      const list = stubListViewport(0);
      stubBox(getTreeRow('f.ts'), 500, 36);

      rerender(
        <FileList
          {...baseProps}
          files={flatFiles}
          selectedFileIndex={null}
          scrollVisibleFileIndex={5}
        />,
      );

      expect(list.scrollTop).toBe(236);
    });

    it('leaves the list alone when the marked row is already in view', () => {
      const { rerender } = render(
        <FileList {...baseProps} files={flatFiles} selectedFileIndex={null} />,
      );
      const list = stubListViewport(40);
      stubBox(getTreeRow('c.ts'), 150, 36);

      rerender(
        <FileList
          {...baseProps}
          files={flatFiles}
          selectedFileIndex={null}
          scrollVisibleFileIndex={2}
        />,
      );

      expect(list.scrollTop).toBe(40);
    });

    it('scrolls up so a nested row clears the sticky folder headers', () => {
      const nestedFiles = [createFile('src/a.ts'), createFile('src/b.ts'), createFile('src/c.ts')];
      const { rerender } = render(
        <FileList {...baseProps} files={nestedFiles} selectedFileIndex={null} />,
      );
      const list = stubListViewport(300);
      stubBox(getTreeRow('src'), 100, 36);
      stubBox(getTreeRow('src/b.ts'), 110, 36);

      rerender(
        <FileList
          {...baseProps}
          files={nestedFiles}
          selectedFileIndex={null}
          scrollVisibleFileIndex={1}
        />,
      );

      expect(list.scrollTop).toBe(274);
    });

    it('does not scroll the list while the filter is typed', () => {
      const { rerender } = render(
        <FileList {...baseProps} files={flatFiles} selectedFileIndex={null} />,
      );
      const list = stubListViewport(0);
      stubBox(getTreeRow('f.ts'), 500, 36);
      rerender(
        <FileList
          {...baseProps}
          files={flatFiles}
          selectedFileIndex={null}
          scrollVisibleFileIndex={5}
        />,
      );
      list.scrollTop = 0;

      fireEvent.change(screen.getByPlaceholderText('Filter files...'), {
        target: { value: '.ts' },
      });

      expect(list.scrollTop).toBe(0);
    });

    it('does not scroll the list when the same files arrive as a new array', () => {
      const { rerender } = render(
        <FileList {...baseProps} files={flatFiles} selectedFileIndex={null} />,
      );
      const list = stubListViewport(0);
      stubBox(getTreeRow('f.ts'), 500, 36);
      rerender(
        <FileList
          {...baseProps}
          files={flatFiles}
          selectedFileIndex={null}
          scrollVisibleFileIndex={5}
        />,
      );
      list.scrollTop = 0;

      rerender(
        <FileList
          {...baseProps}
          files={flatFiles.map((file) => ({ ...file }))}
          selectedFileIndex={null}
          scrollVisibleFileIndex={5}
        />,
      );

      expect(list.scrollTop).toBe(0);
    });
  });
});
