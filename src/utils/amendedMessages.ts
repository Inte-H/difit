import type { ReviewDecision, ThreadFixup } from '../types/diff.js';

import { isThreadDeleted, pendingFixupsFor } from './reviewDecisions.js';

// Keyed by the reviewed commit an amend! folds into; the message the last amend! not rejected
// leaves there. Fixups come oldest first, the order autosquash folds them in.
export function amendedMessagesByCommit(
  fixups: readonly ThreadFixup[],
  decisions: ReviewDecision[],
): Map<string, string> {
  const messages = new Map<string, string>();
  for (const fixup of fixups) {
    const { foldTargetSha, amendedMessage } = fixup;
    if (!foldTargetSha || !amendedMessage) continue;
    const isDropped = fixup.threadIds.some(
      (threadId) =>
        isThreadDeleted(threadId, decisions) ||
        pendingFixupsFor(threadId, [fixup], decisions).length === 0,
    );
    if (!isDropped) messages.set(foldTargetSha, amendedMessage.after);
  }
  return messages;
}
