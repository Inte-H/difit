import type { DiffSelection, DiffSide, LineNumber } from '../../types/diff';

import { rangeOfLine } from './directEdit';

export async function fetchFixupTarget(
  view: DiffSelection,
  filePath: string,
  line: LineNumber,
  side: DiffSide,
): Promise<string | undefined> {
  const { start, end } = rangeOfLine(line);
  const params = new URLSearchParams({
    base: view.baseCommitish,
    target: view.targetCommitish,
    path: filePath,
    start: String(start),
    end: String(end),
    side,
  });
  try {
    const response = await fetch(`/api/fixup-target?${params.toString()}`);
    if (!response.ok) return undefined;
    const body = (await response.json()) as { fixupTarget?: unknown };
    return typeof body.fixupTarget === 'string' ? body.fixupTarget : undefined;
  } catch {
    return undefined;
  }
}
