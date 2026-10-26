import type { DiffCommentPosition, DiffLineRange, LineNumber } from '../types/diff.js';

export function lineOfRange(range: DiffLineRange): LineNumber {
  return typeof range === 'number' ? range : [range.start, range.end];
}

export function lineOfPosition(position: DiffCommentPosition): LineNumber | undefined {
  return 'line' in position ? lineOfRange(position.line) : undefined;
}

export function locationLabel(file: string, line: LineNumber | undefined): string {
  if (line === undefined) return file;
  return `${file}:${Array.isArray(line) ? `${line[0]}-${line[1]}` : line}`;
}
