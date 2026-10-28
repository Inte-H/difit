import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom';

import { FilePathText } from './FilePathText';

describe('FilePathText', () => {
  const path = 'app/src/main/java/kr/port/repository/AccessPasswordAttemptPort.java';

  it('draws the whole path once, in a box that cuts it from the front', () => {
    const { container } = render(<FilePathText path={path} />);
    const box = screen.getByTitle(path);

    expect(container.textContent).toBe(path);
    expect(box).toHaveClass('min-w-0', 'text-ellipsis', 'whitespace-nowrap', '[direction:rtl]');
    expect(box.querySelector('bdi')).toHaveAttribute('dir', 'ltr');
  });

  it('keeps a renamed path as one piece', () => {
    const renamed = 'src/old/A.ts → src/new/B.ts';
    const { container } = render(<FilePathText path={renamed} />);

    expect(container.textContent).toBe(renamed);
  });
});
