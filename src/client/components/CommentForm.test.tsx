import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CommentForm } from './CommentForm';

function renderWithBody(body: string) {
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  const onCancel = vi.fn();
  render(<CommentForm onSubmit={onSubmit} onCancel={onCancel} />);
  const textarea = screen.getByRole('textbox');
  fireEvent.change(textarea, { target: { value: body } });
  return { onSubmit, onCancel, textarea };
}

describe('CommentForm', () => {
  it('marks the cancel action independently from other form buttons', () => {
    const onCancel = vi.fn();
    const { container } = render(
      <CommentForm onSubmit={vi.fn()} onCancel={onCancel} selectedCode="const value = 1;" />,
    );

    const cancelButton = container.querySelector<HTMLButtonElement>('[data-comment-cancel="true"]');
    expect(cancelButton).toBe(screen.getByRole('button', { name: 'Cancel' }));

    fireEvent.click(cancelButton!);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  describe('keyboard shortcuts', () => {
    it('submits on Enter without inserting a newline', () => {
      const { onSubmit, textarea } = renderWithBody('looks good');

      const notPrevented = fireEvent.keyDown(textarea, { key: 'Enter' });

      expect(notPrevented).toBe(false);
      expect(onSubmit).toHaveBeenCalledWith('looks good');
    });

    it('leaves Shift+Enter to the textarea so it inserts a newline', () => {
      const { onSubmit, textarea } = renderWithBody('first line');

      const notPrevented = fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

      expect(notPrevented).toBe(true);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it.each([
      ['Ctrl', { ctrlKey: true }],
      ['Cmd', { metaKey: true }],
    ])('still submits on %s+Enter', (_label, modifier) => {
      const { onSubmit, textarea } = renderWithBody('looks good');

      fireEvent.keyDown(textarea, { key: 'Enter', ...modifier });

      expect(onSubmit).toHaveBeenCalledWith('looks good');
    });

    it.each([
      ['isComposing is true', { isComposing: true }],
      ['keyCode is 229', { keyCode: 229 }],
    ])('ignores Enter while an IME is composing (%s)', (_label, composition) => {
      const { onSubmit, textarea } = renderWithBody('한글');

      const notPrevented = fireEvent.keyDown(textarea, { key: 'Enter', ...composition });

      expect(notPrevented).toBe(true);
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('cancels on Escape', () => {
      const { onSubmit, onCancel, textarea } = renderWithBody('draft');

      fireEvent.keyDown(textarea, { key: 'Escape' });

      expect(onCancel).toHaveBeenCalledOnce();
      expect(onSubmit).not.toHaveBeenCalled();
    });

    it('cancels on Escape even where every key reports keyCode 229', () => {
      const { onCancel, textarea } = renderWithBody('draft');

      fireEvent.keyDown(textarea, { key: 'Escape', keyCode: 229 });

      expect(onCancel).toHaveBeenCalledOnce();
    });
  });
});
