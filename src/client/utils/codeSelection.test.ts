import { afterEach, describe, expect, it } from 'vitest';

import { quoteSelection, selectionInCode } from './codeSelection';

function codeTable(lines: Array<[side: 'old' | 'new', lineNumber: number, text: string]>) {
  const table = document.createElement('table');
  for (const [side, lineNumber, text] of lines) {
    const row = table.insertRow();
    const cell = row.insertCell();
    cell.dataset.codeSide = side;
    cell.dataset.codeLine = String(lineNumber);
    const prefix = document.createElement('span');
    prefix.dataset.diffPrefix = '';
    prefix.textContent = side === 'old' ? '-' : '+';
    cell.append(prefix, document.createTextNode(text));
  }
  document.body.append(table);
  return table;
}

const textOf = (table: HTMLTableElement, row: number) => table.rows[row]!.cells[0]!.lastChild!;

afterEach(() => {
  document.body.replaceChildren();
});

describe('selectionInCode', () => {
  it('leaves out a line the selection only touches at its start', () => {
    const table = codeTable([
      ['new', 4, 'alpha();'],
      ['new', 5, 'beta();'],
    ]);
    const range = document.createRange();
    range.setStart(textOf(table, 0), 0);
    range.setEnd(table.rows[1]!.cells[0]!, 0);

    expect(selectionInCode(range, table, 'unified')).toEqual({
      side: 'new',
      lineNumber: 4,
      text: 'alpha();',
    });
  });

  it('counts the lines of a unified selection on the new side when it reaches one', () => {
    const table = codeTable([
      ['old', 7, 'gone();'],
      ['new', 7, 'kept();'],
      ['new', 8, 'next();'],
    ]);
    const range = document.createRange();
    range.setStart(textOf(table, 0), 0);
    range.setEnd(textOf(table, 2), 4);

    expect(selectionInCode(range, table, 'unified')).toEqual({
      side: 'new',
      lineNumber: [7, 8],
      text: 'gone();\nkept();\nnext',
    });
  });

  it('keeps the old side when only deleted lines are picked', () => {
    const table = codeTable([
      ['old', 3, 'one();'],
      ['old', 4, 'two();'],
    ]);
    const range = document.createRange();
    range.setStart(textOf(table, 0), 0);
    range.setEnd(textOf(table, 1), 3);

    expect(selectionInCode(range, table, 'unified')).toEqual({
      side: 'old',
      lineNumber: [3, 4],
      text: 'one();\ntwo',
    });
  });

  it('keeps a split selection in the column it starts in, even past the end of that line', () => {
    const table = document.createElement('table');
    for (const lineNumber of [20, 21, 22]) {
      const row = table.insertRow();
      for (const side of ['old', 'new'] as const) {
        const cell = row.insertCell();
        cell.dataset.codeSide = side;
        cell.dataset.codeLine = String(lineNumber);
        cell.textContent = `${side}${lineNumber}();`;
      }
    }
    document.body.append(table);
    const newText = (row: number) => table.rows[row]!.cells[1]!.firstChild!;
    const range = document.createRange();
    range.setStart(newText(0), 'new20();'.length);
    range.setEnd(newText(2), 3);

    expect(selectionInCode(range, table, 'split')).toEqual({
      side: 'new',
      lineNumber: [21, 22],
      text: 'new21();\nnew',
    });
  });

  it('ignores a selection that leaves the container', () => {
    const table = codeTable([['new', 1, 'only();']]);
    const outside = document.createElement('p');
    outside.textContent = 'elsewhere';
    document.body.append(outside);
    const range = document.createRange();
    range.setStart(textOf(table, 0), 0);
    range.setEnd(outside.firstChild!, 4);

    expect(selectionInCode(range, table, 'unified')).toBeNull();
  });
});

describe('quoteSelection', () => {
  it('quotes every picked line above the comment, blank ones included', () => {
    expect(quoteSelection('if (a) {\n\n}', 'Fold this')).toBe('> if (a) {\n>\n> }\n\nFold this');
  });
});
