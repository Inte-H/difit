import type { DiffCommentPosition, DiffLineRange, DiffSide, LineNumber } from '../types/diff.js';

export function lineOfRange(range: DiffLineRange): LineNumber {
  return typeof range === 'number' ? range : [range.start, range.end];
}

export function rangeOfLineNumber(line: LineNumber): DiffLineRange {
  return typeof line === 'number' ? line : { start: line[0], end: line[1] };
}

export function startOfLine(line: LineNumber | DiffLineRange): number {
  if (typeof line === 'number') return line;
  return Array.isArray(line) ? line[0] : line.start;
}

export function endOfLine(line: LineNumber | DiffLineRange): number {
  if (typeof line === 'number') return line;
  return Array.isArray(line) ? line[1] : line.end;
}

export function lineOfPosition(position: DiffCommentPosition): LineNumber | undefined {
  return 'line' in position ? lineOfRange(position.line) : undefined;
}

// Every range of a comment on lines, in ascending order, the one its card sits under last; none for
// a comment on the whole file.
export function rangesOfPosition(position: DiffCommentPosition): DiffLineRange[] {
  if (!('line' in position)) return [];
  return [...(position.extraRanges ?? []), position.line];
}

export function extraLinesOfPosition(position: DiffCommentPosition): LineNumber[] | undefined {
  if (!('line' in position) || !position.extraRanges?.length) return undefined;
  return position.extraRanges.map(lineOfRange);
}

// The card goes under the bottom-most range; ranges must be on one side and must not overlap.
export function positionOfLines(
  side: DiffSide,
  lines: readonly [LineNumber, ...LineNumber[]],
): Extract<DiffCommentPosition, { line: DiffLineRange }> {
  const sorted = [...lines].sort((a, b) => startOfLine(a) - startOfLine(b));
  const last = sorted.pop() ?? lines[0];
  return {
    side,
    line: rangeOfLineNumber(last),
    ...(sorted.length > 0 ? { extraRanges: sorted.map(rangeOfLineNumber) } : {}),
  };
}

const spanLabel = (line: LineNumber) =>
  Array.isArray(line) ? `${line[0]}-${line[1]}` : String(line);

export function locationLabel(
  file: string,
  line: LineNumber | undefined,
  extraLines?: readonly LineNumber[],
): string {
  if (line === undefined) return file;
  return `${file}:${[...(extraLines ?? []), line].map(spanLabel).join(',')}`;
}
