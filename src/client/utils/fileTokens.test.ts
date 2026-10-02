import { describe, expect, it } from 'vitest';

import { tokenizeContent } from './fileTokens';

describe('tokenizeContent', () => {
  it('does not count the end of the last line as a line of its own', () => {
    expect(tokenizeContent('x;\n'.repeat(2000), 'javascript')).toHaveLength(2001);
    expect(tokenizeContent('x;\n'.repeat(2001), 'javascript')).toBeNull();
  });

  it('breaks lines only at \\n, as git counts them', () => {
    expect(tokenizeContent('a;\rb;\nc;', 'javascript')).toHaveLength(2);
  });
});
