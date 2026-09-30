import { useMemo, useState } from 'react';

import type { CommentThread, DiffLine, ExpandedLine } from '../../types/diff';
import {
  canAnswerByEdit,
  threadAnsweredByEdit,
  useFixupOverlay,
} from '../contexts/FixupOverlayContext';
import {
  type EditRange,
  hunkRange,
  newSideLineNumbers,
  rangeOfLine,
  rangeShown,
} from '../utils/directEdit';

interface OpenEdit extends EditRange {
  threadId?: string;
}

const NO_LINES: ReadonlySet<number> = new Set();

export function useDirectEditing(
  lines: ReadonlyArray<DiffLine | ExpandedLine>,
  threads: CommentThread[],
) {
  const overlay = useFixupOverlay();
  const controls = overlay.directEdit;
  const editable = controls !== null;
  const lineNumbers = useMemo(
    () => (editable ? newSideLineNumbers(lines) : NO_LINES),
    [editable, lines],
  );
  const hunk = useMemo(() => (editable ? hunkRange(lineNumbers) : null), [editable, lineNumbers]);
  const [editing, setEditing] = useState<OpenEdit | null>(null);
  const [anchor, setAnchor] = useState<number | null>(null);

  const open = (range: EditRange, threadId?: string) => {
    if (!rangeShown(lineNumbers, range)) return;
    setEditing({
      ...range,
      threadId: threadId ?? threadAnsweredByEdit(overlay, threads, range),
    });
  };

  const editLine = (lineNumber: number, extend: boolean) => {
    if (extend && anchor !== null) {
      open({ start: Math.min(anchor, lineNumber), end: Math.max(anchor, lineNumber) });
      return;
    }
    setAnchor(lineNumber);
    open({ start: lineNumber, end: lineNumber });
  };

  return {
    controls,
    targetCommit: overlay.targetCommit,
    editing: controls ? editing : null,
    close: () => setEditing(null),
    editLine: controls ? editLine : undefined,
    editHunk: controls && hunk ? () => open(hunk) : undefined,
    editThread: (thread: CommentThread) => {
      const range = rangeOfLine(thread.line);
      return canAnswerByEdit(overlay, thread) && rangeShown(lineNumbers, range)
        ? () => open(range, thread.id)
        : undefined;
    },
  };
}
