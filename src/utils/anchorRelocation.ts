import type { AnchorStaleReason, DiffLineRange } from '../types/diff.js';

export interface ThreadAnchor {
  line: DiffLineRange;
  content: string;
}

export type AnchorRelocation =
  | { kind: 'located'; line: DiffLineRange }
  | { kind: 'stale'; reason: AnchorStaleReason };

const trimTrailingWhitespace = (line: string) => line.replace(/[ \t]+$/, '');

const splitContent = (content: string) =>
  content.replace(/\r\n/g, '\n').split('\n').map(trimTrailingWhitespace);

// Moves only to an exact match that occurs exactly once; never fits by surrounding context.
export function relocateAnchor(
  anchor: ThreadAnchor,
  lines: ReadonlyMap<number, string>,
): AnchorRelocation {
  const expected = splitContent(anchor.content);
  const matchesAt = (start: number) =>
    expected.every((content, offset) => {
      const current = lines.get(start + offset);
      return current !== undefined && trimTrailingWhitespace(current) === content;
    });

  const [start, ...others] = [...lines.keys()].filter(matchesAt);
  if (start === undefined) return { kind: 'stale', reason: 'missing' };
  if (others.length > 0) return { kind: 'stale', reason: 'ambiguous' };

  const line: DiffLineRange =
    typeof anchor.line === 'number' ? start : { start, end: start + expected.length - 1 };
  return { kind: 'located', line };
}
