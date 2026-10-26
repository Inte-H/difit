import type { ReviewDecision, ThreadFixup } from '../types/diff.js';

import { isThreadDeleted, pendingFixupsFor } from './reviewDecisions.js';

const isDropped = (fixup: ThreadFixup, decisions: ReviewDecision[]) =>
  fixup.threadIds.some(
    (threadId) =>
      isThreadDeleted(threadId, decisions) ||
      pendingFixupsFor(threadId, [fixup], decisions).length === 0,
  );

// Keyed by the reviewed commit amend! commits fold into; the message the last one not rejected
// leaves there. Left out when that is the message the commit has now, or when a later squash!, or
// an amend! the server could not read, makes it unknown. Fixups come oldest first, the order
// autosquash folds them in.
export function amendedMessagesByCommit(
  fixups: readonly ThreadFixup[],
  decisions: ReviewDecision[],
): Map<string, string> {
  const current = new Map<string, string>();
  const messages = new Map<string, string | null>();
  for (const fixup of fixups) {
    const { foldTargetSha, amendedMessage } = fixup;
    if (!foldTargetSha) continue;
    if (amendedMessage && !current.has(foldTargetSha)) {
      current.set(foldTargetSha, amendedMessage.before);
    }
    if (isDropped(fixup, decisions)) continue;
    if (amendedMessage) {
      messages.set(foldTargetSha, amendedMessage.after);
    } else if (/^(?:squash|amend)! /.test(fixup.subject) && messages.has(foldTargetSha)) {
      messages.set(foldTargetSha, null);
    }
  }
  const known = new Map<string, string>();
  for (const [sha, message] of messages) {
    if (message !== null && message !== current.get(sha)) known.set(sha, message);
  }
  return known;
}
