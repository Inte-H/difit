import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { computeWordLevelDiff } from '../utils/wordLevelDiff';

import { WordLevelDiffHighlighter } from './WordLevelDiffHighlighter';

describe('WordLevelDiffHighlighter', () => {
  it('marks names in changed and unchanged segments so they can be looked up', () => {
    const { container } = render(
      <WordLevelDiffHighlighter
        segments={[
          { type: 'unchanged', value: 'const total = ' },
          { type: 'added', value: 'addOne(count)' },
          { type: 'unchanged', value: ';' },
        ]}
      />,
    );

    expect(
      Array.from(container.querySelectorAll('.word-token')).map((word) =>
        word.getAttribute('data-word'),
      ),
    ).toEqual(['const', 'total', 'addOne', 'count']);
    expect(container.textContent).toBe('const total = addOne(count);');
    expect(container.querySelector('.word-diff-added')?.textContent).toBe('addOne(count)');
  });

  it('cuts a token at the changed part and colors every piece of it', () => {
    const { newSegments } = computeWordLevelDiff(
      'const label = "foo bar";',
      'const label = "foo baz";',
    );
    const { container } = render(
      <WordLevelDiffHighlighter segments={newSegments} filename="label.ts" />,
    );

    const stringPieces = Array.from(container.querySelectorAll('.token.string'));
    expect(stringPieces.map((piece) => piece.textContent).join('')).toBe('"foo baz"');
    expect(stringPieces.length).toBeGreaterThan(1);
    const added = container.querySelector('.word-diff-added');
    expect(added?.textContent).toBe('baz');
    expect(added?.querySelector('.token.string .word-token[data-word="baz"]')).not.toBeNull();
    expect(container.querySelector('.token.keyword')?.textContent).toBe('const');
    expect(container.textContent).toBe('const label = "foo baz";');
  });

  it('takes the precomputed tokens of the line when they spell the same text', () => {
    const { container } = render(
      <WordLevelDiffHighlighter
        segments={[
          { type: 'unchanged', value: 'foo ' },
          { type: 'added', value: 'bar' },
        ]}
        filename="notes.ts"
        precomputedTokens={[[{ types: ['comment'], content: 'foo bar' }]]}
      />,
    );

    expect(
      Array.from(container.querySelectorAll('.token.comment')).map((piece) => piece.textContent),
    ).toEqual(['foo ', 'bar']);
    expect(container.querySelector('.word-diff-added .token.comment')?.textContent).toBe('bar');
  });
});
