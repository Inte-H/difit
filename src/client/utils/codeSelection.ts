import type { DiffSide, LineNumber } from '../../types/diff';

export interface CodeSelection {
  side: DiffSide;
  lineNumber: LineNumber;
  text: string;
}

export type CodeSelectionLayout = 'unified' | 'split';

export const codeCellAttributes = (side: DiffSide, lineNumber: number | undefined) =>
  lineNumber === undefined ? {} : { 'data-code-side': side, 'data-code-line': lineNumber };

interface SelectedCell {
  side: DiffSide;
  lineNumber: number;
  text: string;
}

function textInCell(range: Range, cell: Element): string {
  const part = cell.ownerDocument.createRange();
  part.selectNodeContents(cell);
  const prefix = cell.querySelector('[data-diff-prefix]');
  if (prefix) part.setStartAfter(prefix);
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) {
    part.setStart(range.startContainer, range.startOffset);
  }
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) {
    part.setEnd(range.endContainer, range.endOffset);
  }
  return part.toString();
}

function trimEmptyEnds(cells: SelectedCell[]): SelectedCell[] {
  const first = cells.findIndex((cell) => cell.text !== '');
  if (first === -1) return [];
  let last = cells.length - 1;
  while (cells[last]?.text === '') last--;
  return cells.slice(first, last + 1);
}

// A unified selection's text keeps deleted and added lines alike, and its lines are counted on the
// new side unless only deleted lines were picked. A split selection keeps to the column it starts
// in, though the browser also highlights the other column of the rows between.
export function selectionInCode(
  range: Range,
  container: Element,
  layout: CodeSelectionLayout,
): CodeSelection | null {
  if (range.collapsed || !container.contains(range.commonAncestorContainer)) return null;

  let cells: SelectedCell[] = Array.from(
    container.querySelectorAll<HTMLElement>('[data-code-line]'),
  )
    .filter((cell) => range.intersectsNode(cell))
    .map((cell) => ({
      side: cell.dataset.codeSide === 'old' ? 'old' : 'new',
      lineNumber: Number(cell.dataset.codeLine),
      text: textInCell(range, cell),
    }));

  if (layout === 'split') {
    const startNode = range.startContainer;
    const startElement = startNode instanceof Element ? startNode : startNode.parentElement;
    const startCell = startElement?.closest<HTMLElement>('[data-code-side]');
    const startSide =
      startCell && container.contains(startCell)
        ? startCell.dataset.codeSide
        : cells.find((cell) => cell.text !== '')?.side;
    cells = cells.filter((cell) => cell.side === startSide);
  }
  cells = trimEmptyEnds(cells);
  if (cells.length === 0) return null;

  const text = cells.map((cell) => cell.text).join('\n');
  if (text.trim() === '') return null;

  const side: DiffSide = cells.some((cell) => cell.side === 'new') ? 'new' : 'old';
  const lineNumbers = cells.filter((cell) => cell.side === side).map((cell) => cell.lineNumber);
  const start = Math.min(...lineNumbers);
  const end = Math.max(...lineNumbers);
  return { side, lineNumber: start === end ? start : [start, end], text };
}

export function quoteSelection(text: string, body: string): string {
  const quote = text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
  return `${quote}\n\n${body}`;
}
