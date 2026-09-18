import type { AnchorStaleReason, DiffCommentThread, DiffFile, LineNumber } from '../../types/diff';
import { relocateAnchor } from '../../utils/anchorRelocation';

export interface FileLineIndex {
  old: Map<number, string>;
  new: Map<number, string>;
}

export interface ThreadPlacement {
  line: LineNumber;
  isOutdated: boolean;
  outdatedReason?: AnchorStaleReason;
}

export function buildFileLineIndex(file: DiffFile): FileLineIndex {
  const oldIndex = new Map<number, string>();
  const newIndex = new Map<number, string>();

  for (const chunk of file.chunks) {
    for (const line of chunk.lines) {
      if (line.oldLineNumber !== undefined) {
        oldIndex.set(line.oldLineNumber, line.content);
      }
      if (line.newLineNumber !== undefined) {
        newIndex.set(line.newLineNumber, line.content);
      }
    }
  }

  return { old: oldIndex, new: newIndex };
}

const toLineNumber = (line: DiffCommentThread['position']['line']): LineNumber =>
  typeof line === 'number' ? line : [line.start, line.end];

// A stale thread keeps its stored position.
export function locateThread(
  thread: DiffCommentThread,
  index: FileLineIndex | undefined,
): ThreadPlacement {
  const storedLine = toLineNumber(thread.position.line);
  const snapshot = thread.codeSnapshot?.content;
  if (snapshot === undefined) return { line: storedLine, isOutdated: false };
  if (!index) return { line: storedLine, isOutdated: true, outdatedReason: 'missing' };

  const relocation = relocateAnchor(
    { line: thread.position.line, content: snapshot },
    thread.position.side === 'old' ? index.old : index.new,
  );
  if (relocation.kind === 'stale') {
    return { line: storedLine, isOutdated: true, outdatedReason: relocation.reason };
  }
  return { line: toLineNumber(relocation.line), isOutdated: false };
}
