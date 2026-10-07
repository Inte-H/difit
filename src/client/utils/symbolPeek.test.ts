import { afterEach, describe, expect, it } from 'vitest';

import { symbolRequestFromTarget } from './symbolPeek';

const refs = { base: 'aaa1111', target: 'bbb2222' };

function wordIn(html: string): Element {
  document.body.innerHTML = html;
  const word = document.querySelector('.word-token');
  if (!word) throw new Error('fixture has no word');
  return word;
}

describe('symbolRequestFromTarget', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('looks a name on a deleted line up in the base and anything else in the target', () => {
    expect(
      symbolRequestFromTarget(
        wordIn(
          '<div data-symbol-side="old" data-symbol-path="src/a.ts"><span class="word-token" data-word="parseDiff">parseDiff</span></div>',
        ),
        refs,
      ),
    ).toEqual({ name: 'parseDiff', ref: 'aaa1111', from: 'src/a.ts' });
    expect(
      symbolRequestFromTarget(
        wordIn(
          '<div data-symbol-side="new"><span class="word-token" data-word="parseDiff">parseDiff</span></div>',
        ),
        refs,
      ),
    ).toEqual({ name: 'parseDiff', ref: 'bbb2222' });
  });

  it('uses the ref written on the code it was clicked in', () => {
    expect(
      symbolRequestFromTarget(
        wordIn(
          '<div data-symbol-ref="ccc3333" data-symbol-path="src/b.ts"><span class="word-token" data-word="helper"><b>helper</b></span></div>',
        ).firstElementChild,
        refs,
      ),
    ).toEqual({ name: 'helper', ref: 'ccc3333', from: 'src/b.ts' });
  });

  it.each([
    [
      'a number',
      '<div data-symbol-side="new"><span class="word-token" data-word="200">200</span></div>',
    ],
    [
      'code that is not searchable',
      '<div><span class="word-token" data-word="helper">helper</span></div>',
    ],
  ])('ignores %s', (_label, html) => {
    expect(symbolRequestFromTarget(wordIn(html), refs)).toBeNull();
  });

  it('ignores clicks outside a name', () => {
    document.body.innerHTML = '<div data-symbol-side="new"><span>(</span></div>';
    expect(symbolRequestFromTarget(document.querySelector('span'), refs)).toBeNull();
    expect(symbolRequestFromTarget(null, refs)).toBeNull();
  });
});
