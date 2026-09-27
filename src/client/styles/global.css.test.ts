import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import postcss, { type Declaration, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const stylesheet = postcss.parse(readFileSync(resolve(__dirname, 'global.css'), 'utf8'));

const rulesMatching = (predicate: (selector: string) => boolean) => {
  const rules: Rule[] = [];
  stylesheet.walkRules((rule) => {
    if (predicate(rule.selector)) rules.push(rule);
  });
  return rules;
};

const declarationsOf = (rules: Rule[]) => {
  const declarations: Declaration[] = [];
  for (const rule of rules) {
    rule.walkDecls((declaration) => {
      declarations.push(declaration);
    });
  }
  return declarations;
};

describe('global.css keyboard cursor highlight', () => {
  const cursorColorDeclarations = declarationsOf(
    rulesMatching((selector) => selector.includes('keyboard-cursor')),
  ).filter(({ prop }) => prop === 'background-color' || prop === 'box-shadow');

  it('takes its colors from custom properties only', () => {
    expect(cursorColorDeclarations.length).toBeGreaterThan(0);
    for (const { value } of cursorColorDeclarations) {
      expect(value).not.toMatch(/rgba?\(|#[0-9a-f]{3,8}\b/i);
    }
  });

  it('turns neutral in a review pinned to a commit', () => {
    const cursorProperties = new Set(
      cursorColorDeclarations.flatMap(({ value }) =>
        [...value.matchAll(/var\((--[\w-]+)/g)].map(([, name]) => name),
      ),
    );
    const fixupReviewProperties = new Set(
      declarationsOf(rulesMatching((selector) => selector === '[data-fixup-review]')).map(
        ({ prop }) => prop,
      ),
    );

    expect(cursorProperties.size).toBeGreaterThan(0);
    for (const property of cursorProperties) {
      expect(fixupReviewProperties).toContain(property);
    }
  });
});
