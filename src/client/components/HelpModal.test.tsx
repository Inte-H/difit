import { render, screen, within } from '@testing-library/react';
import { HotkeysProvider } from 'react-hotkeys-hook';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';

import { HelpModal } from './HelpModal';

describe('HelpModal', () => {
  it('lists the previous and next commit keys', () => {
    render(
      <HotkeysProvider initiallyActiveScopes={['navigation']}>
        <HelpModal isOpen onClose={vi.fn()} />
      </HotkeysProvider>,
    );

    const section = screen.getByRole('heading', { name: 'Commit Navigation' }).closest('section');
    expect(section).not.toBeNull();
    const rows = within(section!).getAllByText(/commit/i, { selector: 'span' });
    expect(rows.map((row) => row.textContent)).toEqual([
      'Previous commit (the last one from the whole review)',
      'Next commit (the first one from the whole review)',
    ]);
    expect(
      within(section!)
        .getAllByText(/^[<>]$/)
        .map((key) => key.textContent),
    ).toEqual(['<', '>']);
  });
});
