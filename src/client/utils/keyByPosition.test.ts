import { describe, expect, it } from 'vitest';

import { keyByPosition } from './keyByPosition';

describe('keyByPosition', () => {
  it('reads a letter from where the key sits, whatever the input method types', () => {
    expect(keyByPosition({ key: 'ㅓ', code: 'KeyJ' })).toBe('j');
    expect(keyByPosition({ key: 'ㅇ', code: 'KeyD' })).toBe('d');
    expect(keyByPosition({ key: 'k', code: 'KeyK' })).toBe('k');
  });

  it('keeps the typed key for anything but a letter', () => {
    expect(keyByPosition({ key: 'ArrowDown', code: 'ArrowDown' })).toBe('ArrowDown');
    expect(keyByPosition({ key: 'Escape', code: 'Escape' })).toBe('Escape');
    expect(keyByPosition({ key: 'Enter', code: 'Enter' })).toBe('Enter');
    expect(keyByPosition({ key: '1', code: 'Digit1' })).toBe('1');
    expect(keyByPosition({ key: ']', code: 'BracketRight' })).toBe(']');
  });
});
