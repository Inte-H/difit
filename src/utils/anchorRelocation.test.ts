import { describe, expect, it } from 'vitest';

import { relocateAnchor } from './anchorRelocation';

const fileLines = (lines: string[], firstLineNumber = 1) =>
  new Map(lines.map((content, index) => [firstLineNumber + index, content]));

describe('relocateAnchor', () => {
  it('keeps the saved line when its content still sits there and nowhere else', () => {
    const lines = fileLines(['const a = 1;', 'const b = 2;', 'const c = 3;']);

    expect(relocateAnchor({ line: 2, content: 'const b = 2;' }, lines)).toEqual({
      kind: 'located',
      line: 2,
    });
  });

  it('moves to the new line number when lines were inserted above', () => {
    const lines = fileLines(['import x;', 'import y;', 'const a = 1;', 'const b = 2;']);

    expect(relocateAnchor({ line: 2, content: 'const b = 2;' }, lines)).toEqual({
      kind: 'located',
      line: 4,
    });
  });

  it('moves a range as a whole and keeps its length', () => {
    const lines = fileLines(['// new', 'function f() {', '  return 1;', '}']);

    expect(
      relocateAnchor(
        { line: { start: 1, end: 3 }, content: 'function f() {\n  return 1;\n}' },
        lines,
      ),
    ).toEqual({ kind: 'located', line: { start: 2, end: 4 } });
  });

  it('keeps a repeated line at its saved number when viewing the anchor commit', () => {
    const lines = fileLines(['if (a) {', '}', 'if (b) {', '}']);

    expect(relocateAnchor({ line: 4, content: '}' }, lines, true)).toEqual({
      kind: 'located',
      line: 4,
    });
    expect(relocateAnchor({ line: 4, content: '}' }, lines)).toEqual({
      kind: 'stale',
      reason: 'ambiguous',
    });
  });

  it('still searches when the anchor commit no longer holds the content at the saved number', () => {
    const lines = fileLines(['const a = 1;', 'const b = 2;']);

    expect(relocateAnchor({ line: 1, content: 'const b = 2;' }, lines, true)).toEqual({
      kind: 'located',
      line: 2,
    });
  });

  it('is stale as missing when the saved content is gone', () => {
    const lines = fileLines(['const a = 1;', 'const b = 20;']);

    expect(relocateAnchor({ line: 2, content: 'const b = 2;' }, lines)).toEqual({
      kind: 'stale',
      reason: 'missing',
    });
  });

  it('is stale as ambiguous when the saved content occurs more than once, even at the saved line', () => {
    const lines = fileLines(['}', 'const a = 1;', '}']);

    expect(relocateAnchor({ line: 1, content: '}' }, lines)).toEqual({
      kind: 'stale',
      reason: 'ambiguous',
    });
  });

  it('does not treat a partial range match as a match', () => {
    const lines = fileLines(['function f() {', '  return 2;', '}']);

    expect(
      relocateAnchor(
        { line: { start: 1, end: 3 }, content: 'function f() {\n  return 1;\n}' },
        lines,
      ),
    ).toEqual({ kind: 'stale', reason: 'missing' });
  });

  it('ignores trailing whitespace and CRLF line endings', () => {
    const lines = fileLines(['const a = 1;  ', 'const b = 2;']);

    expect(
      relocateAnchor(
        { line: { start: 1, end: 2 }, content: 'const a = 1;\r\nconst b = 2;' },
        lines,
      ),
    ).toEqual({ kind: 'located', line: { start: 1, end: 2 } });
  });
});
