import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom';

import { FilePathText } from './FilePathText';

describe('FilePathText', () => {
  const path = 'app/src/main/java/kr/port/repository/AccessPasswordAttemptPort.java';

  it('draws the directories and the file name apart so the directories give way first', () => {
    const { container } = render(<FilePathText path={path} />);
    const [directory, name] = container.querySelectorAll('[aria-hidden="true"]');

    expect(directory).toHaveTextContent('app/src/main/java/kr/port/repository/');
    expect(directory).toHaveClass('min-w-0', 'text-ellipsis', '[direction:rtl]');
    expect(directory?.querySelector('bdi')).toHaveAttribute('dir', 'ltr');
    expect(name).toHaveTextContent(/^AccessPasswordAttemptPort\.java$/);
    expect(name).toHaveClass('shrink-0', 'max-w-full', 'text-ellipsis');
  });

  it('shows the whole path on hover and reads it as one piece', () => {
    render(<FilePathText path={path} />);

    expect(screen.getByTitle(path)).toBeInTheDocument();
    expect(screen.getByText(path)).toHaveClass('sr-only');
  });

  it('draws only the name for a file at the top of the repository', () => {
    const { container } = render(<FilePathText path="README.md" />);

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(1);
    expect(container.querySelector('bdi')).toBeNull();
  });
});
