import { describe, expect, it } from 'vitest';

import { isSymbolName } from './symbolName';

describe('isSymbolName', () => {
  it('accepts identifiers and refuses anything git could read as an option or pattern', () => {
    expect(isSymbolName('parseDiff')).toBe(true);
    expect(isSymbolName('$scope')).toBe(true);
    expect(isSymbolName('-e')).toBe(false);
    expect(isSymbolName('a.b')).toBe(false);
    expect(isSymbolName('')).toBe(false);
    expect(isSymbolName('a'.repeat(101))).toBe(false);
  });
});
