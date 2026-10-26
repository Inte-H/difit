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

  it('accepts names written in other scripts', () => {
    expect(isSymbolName('기본값')).toBe(true);
    expect(isSymbolName('회원_조회2')).toBe(true);
    expect(isSymbolName('2회원')).toBe(false);
    expect(isSymbolName('회원 조회')).toBe(false);
  });
});
