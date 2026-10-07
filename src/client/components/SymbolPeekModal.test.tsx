import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SymbolSearchResponse } from '../../types/diff';
import { WordHighlightProvider } from '../contexts/WordHighlightContext';

import { SymbolPeekModal } from './SymbolPeekModal';

vi.mock('react-hotkeys-hook', () => ({ useHotkeys: vi.fn() }));

const tokenized = vi.hoisted(() => ({ lengths: [] as number[] }));
vi.mock('../utils/fileTokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/fileTokens')>();
  return {
    ...actual,
    tokenizeContent: (...args: Parameters<typeof actual.tokenizeContent>) => {
      tokenized.lengths.push(args[0].length);
      return actual.tokenizeContent(...args);
    },
  };
});

const found: SymbolSearchResponse = {
  name: 'addOne',
  ref: 'abc1234',
  definitions: [{ path: 'src/math.ts', line: 2, text: 'export function addOne(n) {' }],
  references: [{ path: 'src/use.ts', line: 1, text: 'const two = addOne(1);' }],
  truncated: false,
};

const files: Record<string, string> = {
  'src/math.ts': '// math\nexport function addOne(n) {\n  return n + 1;\n}\n',
  'src/use.ts': 'const two = addOne(1);\n',
};

function respond(search: SymbolSearchResponse | null) {
  vi.mocked(global.fetch).mockImplementation(async (input) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/symbol') {
      return search
        ? new Response(JSON.stringify(search), { status: 200 })
        : new Response('{}', { status: 404 });
    }
    const path = decodeURIComponent(url.pathname.replace('/api/blob/', ''));
    const content = files[path];
    return content === undefined
      ? new Response('', { status: 404 })
      : new Response(new TextEncoder().encode(content), { status: 200 });
  });
}

async function shownRows(): Promise<string[]> {
  let rows: string[] = [];
  await waitFor(() => {
    rows = Array.from(document.querySelectorAll('[data-symbol-ref] tr')).map(
      (row) => row.textContent ?? '',
    );
    expect(rows.length).toBeGreaterThan(0);
  });
  return rows;
}

function renderModal(props: Partial<React.ComponentProps<typeof SymbolPeekModal>> = {}) {
  return render(
    <WordHighlightProvider>
      <SymbolPeekModal
        request={{ name: 'addOne', ref: 'abc1234', from: 'src/use.ts' }}
        canGoBack={false}
        onBack={vi.fn()}
        onClose={vi.fn()}
        {...props}
      />
    </WordHighlightProvider>,
  );
}

describe('SymbolPeekModal', () => {
  beforeEach(() => {
    global.fetch = vi.fn();
    tokenized.lengths = [];
  });

  afterEach(() => {
    delete files['src/big.ts'];
    delete files['src/cr.ts'];
    delete files['src/huge.ts'];
    delete files['src/mixed.ts'];
    vi.restoreAllMocks();
  });

  it('searches the requested revision and opens the first declaration at its line', async () => {
    respond(found);
    renderModal();

    expect(await shownRows()).toEqual([
      '1// math',
      '2export function addOne(n) {',
      '3  return n + 1;',
      '4}',
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/symbol?name=addOne&ref=abc1234&from=src%2Fuse.ts',
      { signal: expect.any(AbortSignal) },
    );
    expect(global.fetch).toHaveBeenCalledWith('/api/blob/src%2Fmath.ts?ref=abc1234', {
      signal: expect.any(AbortSignal),
    });
    const highlighted = screen.getByText('2').closest('tr');
    expect(highlighted).toHaveClass('bg-github-accent/15');
  });

  it('keeps the shown file searchable at the same revision', async () => {
    respond(found);
    const { container } = renderModal();

    await shownRows();
    const file = container.ownerDocument.querySelector('[data-symbol-ref]');
    expect(file).toHaveAttribute('data-symbol-ref', 'abc1234');
    expect(file).toHaveAttribute('data-symbol-path', 'src/math.ts');
  });

  it('opens a use when it is picked from the list', async () => {
    respond(found);
    renderModal();
    await shownRows();

    fireEvent.click(screen.getByText('src/use.ts:1'));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith('/api/blob/src%2Fuse.ts?ref=abc1234', {
        signal: expect.any(AbortSignal),
      }),
    );
    expect(await screen.findByText('src/use.ts')).toBeInTheDocument();
  });

  it('moves to another line of the shown file without downloading it again', async () => {
    respond({
      ...found,
      references: [{ path: 'src/math.ts', line: 3, text: '  return n + 1;' }],
    });
    renderModal();
    await shownRows();

    fireEvent.click(screen.getByText('src/math.ts:3'));

    await waitFor(() =>
      expect(screen.getByText('3').closest('tr')).toHaveClass('bg-github-accent/15'),
    );
    const blobRequests = vi
      .mocked(global.fetch)
      .mock.calls.filter(([url]) => String(url).startsWith('/api/blob/'));
    expect(blobRequests).toHaveLength(1);
  });

  it('shows a large file as 2000 lines that still include the selected one near the end', async () => {
    files['src/big.ts'] = Array.from({ length: 2500 }, (_, i) => {
      const lineNumber = i + 1;
      if (lineNumber === 400) return '/*';
      if (lineNumber === 600) return '*/';
      return `const v${lineNumber} = ${lineNumber};`;
    }).join('\n');
    respond({
      ...found,
      definitions: [{ path: 'src/big.ts', line: 2400, text: 'const v2400 = 2400;' }],
      references: [],
    });
    renderModal();

    const rows = await shownRows();

    expect(rows).toHaveLength(2000);
    expect(rows[0]).toBe('501const v501 = 501;');
    // The window starts inside a block comment that opened on line 400.
    const firstCode = document.querySelector('[data-symbol-ref] tr td:last-child');
    expect(firstCode?.querySelector('.comment')?.textContent).toBe('const v501 = 501;');
    expect(rows.at(-1)).toBe('2500const v2500 = 2500;');
    expect(document.querySelector('tr.bg-github-accent\\/15')?.textContent).toBe(
      '2400const v2400 = 2400;',
    );
    expect(screen.getByText('src/big.ts · 501-2500줄만 보여 줍니다')).toBeInTheDocument();
  }, 120_000);

  it('shows a single line of over a million characters without tokenizing it', async () => {
    files['src/huge.ts'] = `const bundle = '${'x'.repeat(1_100_000)}';\n`;
    respond({
      ...found,
      definitions: [{ path: 'src/huge.ts', line: 1, text: 'const bundle' }],
      references: [],
    });
    renderModal();

    const [row] = await shownRows();

    expect(row?.startsWith('1const bundle = ')).toBe(true);
    expect(tokenized.lengths).toEqual([]);
  });

  it('highlights a file of over a million characters row by row', async () => {
    const filler = 'x'.repeat(430);
    files['src/huge.ts'] = Array.from(
      { length: 2500 },
      (_, i) => `const v${i + 1} = '${filler}';`,
    ).join('\n');
    respond({
      ...found,
      definitions: [{ path: 'src/huge.ts', line: 2400, text: 'const v2400' }],
      references: [],
    });
    renderModal();

    const rows = await shownRows();

    expect(rows.at(-1)).toBe(`2500const v2500 = '${filler}';`);
    expect(tokenized.lengths).toEqual([]);
    expect(document.querySelector('[data-symbol-ref] tr .token')).not.toBeNull();
  }, 120_000);

  it('shows a window of over a million characters as plain text', async () => {
    const filler = 'x'.repeat(600);
    files['src/huge.ts'] = Array.from(
      { length: 2500 },
      (_, i) => `const v${i + 1} = '${filler}';`,
    ).join('\n');
    respond({
      ...found,
      definitions: [{ path: 'src/huge.ts', line: 10, text: 'const v10' }],
      references: [],
    });
    renderModal();

    const rows = await shownRows();

    expect(rows).toHaveLength(2000);
    expect(document.querySelector('[data-symbol-ref] tr .token')).toBeNull();
  }, 120_000);

  it('shows a very long line as plain text and tokenizes the lines around it in runs', async () => {
    files['src/mixed.ts'] = `/*\nconst a = 1;\n*/\nconst b = '${'x'.repeat(20_000)}';\n`;
    respond({
      ...found,
      definitions: [{ path: 'src/mixed.ts', line: 2, text: 'const a = 1;' }],
      references: [],
    });
    renderModal();

    await shownRows();
    const cells = document.querySelectorAll('[data-symbol-ref] tr td:last-child');

    expect(tokenized.lengths.length).toBeGreaterThan(0);
    expect(Math.max(...tokenized.lengths)).toBeLessThan(20_000);
    expect(cells[1]?.querySelector('.comment')?.textContent).toBe('const a = 1;');
    expect(cells[3]?.querySelector('.token')).toBeNull();
    expect(cells[3]?.textContent).toBe(`const b = '${'x'.repeat(20_000)}';`);
  });

  it('tokenizes the short lines of a file that is large only by one long line', async () => {
    files['src/huge.ts'] = [
      ...Array.from({ length: 300 }, (_, i) => `const v${i + 1} = ${i + 1};`),
      `const data = '${'x'.repeat(1_100_000)}';`,
    ].join('\n');
    respond({
      ...found,
      definitions: [{ path: 'src/huge.ts', line: 1, text: 'const v1 = 1;' }],
      references: [],
    });
    renderModal();

    await shownRows();
    const [first] = document.querySelectorAll('[data-symbol-ref] tr td:last-child');

    expect(tokenized.lengths).toHaveLength(1);
    expect(tokenized.lengths[0]).toBeLessThan(10_000);
    expect(first?.querySelector('.token')).not.toBeNull();
  });

  it('numbers lines as git grep does when a line holds a lone carriage return', async () => {
    files['src/cr.ts'] = 'const a = 1;\rconst b = 2;\nconst c = 3;\n';
    respond({
      ...found,
      definitions: [{ path: 'src/cr.ts', line: 2, text: 'const c = 3;' }],
      references: [],
    });
    renderModal();

    const rows = await shownRows();
    expect(rows).toHaveLength(2);
    expect(document.querySelector('tr.bg-github-accent\\/15')?.textContent).toBe('2const c = 3;');
  });

  it('says so when the name appears nowhere', async () => {
    respond({ ...found, definitions: [], references: [] });
    renderModal();

    expect(await screen.findByText('찾지 못했습니다.')).toBeInTheDocument();
  });

  it('says so when the revision cannot be searched', async () => {
    respond(null);
    renderModal();

    expect(await screen.findByText('이 리비전에서는 찾을 수 없습니다.')).toBeInTheDocument();
  });

  it('stays mounted but out of sight while a deeper lookup is shown', async () => {
    respond(found);
    renderModal({ hidden: true });

    await shownRows();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers a way back only after going deeper', async () => {
    respond(found);
    const onBack = vi.fn();
    const { rerender } = renderModal();
    expect(screen.queryByRole('button', { name: '뒤로' })).not.toBeInTheDocument();

    rerender(
      <WordHighlightProvider>
        <SymbolPeekModal
          request={{ name: 'addOne', ref: 'abc1234' }}
          canGoBack
          onBack={onBack}
          onClose={vi.fn()}
        />
      </WordHighlightProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: '뒤로' }));

    expect(onBack).toHaveBeenCalled();
  });
});
