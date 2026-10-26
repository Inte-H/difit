import type { DiffCommentPosition, LineNumber } from '../types/diff.js';

export function lineOfPosition(position: DiffCommentPosition): LineNumber | undefined {
  if (!('line' in position)) return undefined;
  return typeof position.line === 'number'
    ? position.line
    : [position.line.start, position.line.end];
}

export function locationLabel(file: string, line: LineNumber | undefined): string {
  if (line === undefined) return file;
  return `${file}:${Array.isArray(line) ? `${line[0]}-${line[1]}` : line}`;
}
