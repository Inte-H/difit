import type { DiffLine, DiffSide, LineNumber } from '../../types/diff';
import { type EditRange, rangeOfLine } from '../utils/directEdit';

export interface FoldedLines {
  start: number;
  end: number;
  summary: string;
  folded: boolean;
  locked?: boolean;
  onToggle: () => void;
}

export const NO_FOLDS: readonly FoldedLines[] = [];

export const foldAt = (folds: readonly FoldedLines[], index: number) =>
  folds.find((fold) => index >= fold.start && index <= fold.end);

export function lockFoldsUnderForms(
  folds: readonly FoldedLines[],
  lines: DiffLine[],
  commentingLine: { side: DiffSide; lineNumber: LineNumber } | null,
  editing: EditRange | null,
): readonly FoldedLines[] {
  const forms: { side: DiffSide; range: EditRange }[] = [];
  if (commentingLine) {
    forms.push({ side: commentingLine.side, range: rangeOfLine(commentingLine.lineNumber) });
  }
  if (editing) forms.push({ side: 'new', range: editing });
  if (folds.length === 0 || forms.length === 0) return folds;

  const touches = (fold: FoldedLines) => {
    for (let index = fold.start; index <= fold.end; index++) {
      const line = lines[index];
      const held = forms.some(({ side, range }) => {
        const lineNumber = side === 'old' ? line?.oldLineNumber : line?.newLineNumber;
        return lineNumber !== undefined && range.start <= lineNumber && lineNumber <= range.end;
      });
      if (held) return true;
    }
    return false;
  };
  let changed = false;
  const lockedFolds = folds.map((fold) => {
    if (!touches(fold)) return fold;
    changed = true;
    return { ...fold, folded: false, locked: true };
  });
  return changed ? lockedFolds : folds;
}

function FoldedLinesButton({ fold }: { fold: FoldedLines }) {
  return (
    <button
      type="button"
      onClick={fold.onToggle}
      disabled={fold.locked}
      title={fold.locked ? '입력창이 열려 있는 동안에는 접을 수 없습니다' : undefined}
      aria-expanded={!fold.folded}
      className="w-full px-3 py-1.5 text-left text-xs font-mono bg-github-bg-secondary text-github-text-secondary enabled:hover:text-github-text-primary enabled:hover:bg-github-bg-tertiary border-y border-github-border enabled:cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {`${fold.summary} · ${fold.folded ? '펼치기' : '접기'}`}
    </button>
  );
}

export function FoldedLinesRow({ fold, colSpan }: { fold: FoldedLines; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <FoldedLinesButton fold={fold} />
      </td>
    </tr>
  );
}
