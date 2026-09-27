import { describe, expect, it, vi } from 'vitest';

import type { ThreadFixup } from '../../types/diff';

import { recordWithPatchId } from './FixupOverlayContext';

describe('recordWithPatchId', () => {
  it('records the patch id of the fixup being judged', () => {
    const record = vi.fn();
    const fixup: ThreadFixup = {
      sha: 'a'.repeat(40),
      shortSha: 'aaaaaaa',
      patchId: 'change-1',
      subject: 'fixup! x',
      threadIds: ['t1'],
      files: [],
    };

    recordWithPatchId(record, new Map([['t1', [fixup]]]))('t1', 'rejected', fixup.sha);

    expect(record).toHaveBeenCalledWith('t1', 'rejected', fixup.sha, 'change-1');
  });
});
