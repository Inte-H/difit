import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SymbolPeekChip } from './SymbolPeekChip';

describe('SymbolPeekChip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sits below the click, or above it when the click is near the bottom of the window', () => {
    vi.stubGlobal('innerHeight', 800);
    vi.stubGlobal('innerWidth', 390);

    const { rerender } = render(<SymbolPeekChip name="helper" x={40} y={100} onOpen={vi.fn()} />);
    expect(screen.getByRole('button').style.top).toBe('112px');

    rerender(<SymbolPeekChip name="helper" x={40} y={780} onOpen={vi.fn()} />);
    expect(screen.getByRole('button').style.top).toBe('736px');
  });
});
