import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
});
