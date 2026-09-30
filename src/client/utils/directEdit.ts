import type { DiffLine, DirectEditRejection, ExpandedLine, LineNumber } from '../../types/diff';

export interface EditRange {
  start: number;
  end: number;
}

export function newSideLineNumbers(lines: ReadonlyArray<DiffLine | ExpandedLine>): Set<number> {
  const numbers = new Set<number>();
  for (const line of lines) {
    if (line.type !== 'delete' && line.newLineNumber !== undefined) {
      numbers.add(line.newLineNumber);
    }
  }
  return numbers;
}

export function rangeShown(lineNumbers: ReadonlySet<number>, range: EditRange): boolean {
  for (let lineNumber = range.start; lineNumber <= range.end; lineNumber++) {
    if (!lineNumbers.has(lineNumber)) return false;
  }
  return true;
}

export function hunkRange(lineNumbers: ReadonlySet<number>): EditRange | null {
  if (lineNumbers.size === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const lineNumber of lineNumbers) {
    if (lineNumber < start) start = lineNumber;
    if (lineNumber > end) end = lineNumber;
  }
  return end - start + 1 === lineNumbers.size ? { start, end } : null;
}

// The BOM stays on the first line and each line loses only the CR of its CRLF ending, so the
// lines match the committed bytes the server compares them with.
export async function fetchLinesAt(
  filePath: string,
  ref: string,
  range: EditRange,
): Promise<string[] | null> {
  try {
    const response = await fetch(
      `/api/blob/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`,
    );
    if (!response.ok) return null;
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(await response.arrayBuffer());
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    if (range.start < 1 || range.end > lines.length) return null;
    return lines.slice(range.start - 1, range.end).map((line) => line.replace(/\r$/, ''));
  } catch {
    return null;
  }
}

export function rangeOfLine(line: LineNumber): EditRange {
  return typeof line === 'number' ? { start: line, end: line } : { start: line[0], end: line[1] };
}

export function rangesOverlap(a: EditRange, b: EditRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

const EARLIER_EDIT_NOTE =
  '앞서 직접 고쳐 만든 fixup 커밋이 HEAD에 남아 있을 수 있습니다. 화면에서 되돌린 수정도 커밋은 그대로 남습니다.';

const FAILURE_MESSAGES: Record<DirectEditRejection, string> = {
  'stale-view': '화면의 코드가 리뷰 대상 커밋과 다릅니다. 새로고침한 뒤 다시 고쳐 주세요.',
  'target-not-in-head':
    '리뷰 대상 커밋이 지금 체크아웃한 브랜치에 없습니다. 그 커밋이 있는 브랜치로 옮긴 뒤 고쳐 주세요.',
  'detached-head': 'HEAD가 브랜치에 있지 않습니다. 브랜치를 체크아웃한 뒤 고쳐 주세요.',
  'not-a-file': '심볼릭 링크나 서브모듈은 고칠 수 없습니다. 일반 파일만 고칠 수 있습니다.',
  binary: '바이너리 파일은 고칠 수 없습니다.',
  'not-utf8': 'UTF-8 텍스트가 아닌 파일은 고칠 수 없습니다.',
  'missing-at-head': '이 파일이 HEAD에 없습니다. 뒤 커밋에서 지워졌거나 이름이 바뀌었습니다.',
  'dirty-file': '이 파일에 커밋하지 않은 변경이 있습니다. 먼저 커밋하거나 치운 뒤 고쳐 주세요.',
  'operation-in-progress': 'rebase, merge, cherry-pick이 도중에 멈춰 있어 커밋할 수 없습니다.',
  'mixed-commits': '고른 줄들이 서로 다른 커밋에서 왔습니다. 커밋마다 나눠서 고쳐 주세요.',
  conflict: `뒤 커밋이 같은 줄이나 바로 옆 줄을 바꿔 두어 합칠 수 없습니다. ${EARLIER_EDIT_NOTE}`,
  'fold-conflict':
    '리뷰 범위 안의 어느 커밋에 접어도 autosquash가 충돌합니다. 뒤 커밋이 바꾼 줄과 떨어진 곳을 고쳐 주세요.',
  'no-change': `HEAD에는 이미 이렇게 고쳐져 있습니다. ${EARLIER_EDIT_NOTE}`,
  'head-moved': '저장하는 동안 HEAD가 계속 바뀌어 커밋하지 못했습니다. 잠시 뒤 다시 저장해 주세요.',
  'commit-failed': 'fixup 커밋을 만들지 못했습니다. 아래 출력을 확인해 주세요.',
  'thread-has-fixup': '이 지적에는 판정을 기다리는 수정이 이미 있습니다.',
  'thread-opened-by-edit': '직접 고쳐서 연 스레드는 다시 고치지 않습니다. 줄에서 새로 고쳐 주세요.',
};

export function directEditFailureMessage(
  reason: DirectEditRejection | undefined,
  error: string,
): string {
  return reason ? FAILURE_MESSAGES[reason] : error;
}
