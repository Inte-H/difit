import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';

import type { DiffLine, DiffSide, LineNumber, LineSelection } from '../../types/diff';
import { extendTo, type LinePick, pickLines, type PickChange, toggleLine } from '../utils/linePick';

const NOTICE_MS = 2500;
const FLASH_MS = 1400;

const MIXED_SIDES_NOTICE = '지운 줄과 남은 줄은 지적 하나에 함께 고를 수 없습니다';

export interface LinePickStore {
  // The lines the open comment form is on; null while no form is open.
  pick: LinePick | null;
  quote?: string;
  // Plain clicks on line numbers add and take out lines, for screens without Ctrl.
  addMode: boolean;
  notice: string | null;
  flashedThreadId: string | null;
  start: (side: DiffSide, line: LineNumber, quote?: string) => void;
  // Like start, but closes the form when it is already open on exactly these lines.
  open: (side: DiffSide, line: LineNumber) => void;
  toggle: (selection: LineSelection) => void;
  extend: (selection: LineSelection) => void;
  // The line clicked last, where a Shift+click starts.
  setAnchor: (selection: LineSelection) => void;
  setAddMode: (on: boolean) => void;
  close: () => void;
  contentOf: (side: DiffSide, line: LineNumber) => string;
  flash: (threadId: string) => void;
}

const lineNumberOn = (line: DiffLine, side: DiffSide) =>
  side === 'old' ? line.oldLineNumber : line.newLineNumber;

const sameSelection = (a: LineSelection | null, b: LineSelection | null) =>
  !!a && !!b && a.side === b.side && a.lineNumber === b.lineNumber;

// `cursorLine` is the line under the keyboard cursor: a Ctrl+click picks the line clicked before
// it too while the cursor still sits there.
function useLinePickState(
  lines: readonly DiffLine[],
  cursorLine: LineSelection | null,
): LinePickStore {
  const [pick, setPick] = useState<LinePick | null>(null);
  const [quote, setQuote] = useState<string | undefined>();
  const [anchor, setAnchor] = useState<LineSelection | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [flashedThreadId, setFlashedThreadId] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cursorLineRef = useRef(cursorLine);
  cursorLineRef.current = cursorLine;

  useEffect(
    () => () => {
      clearTimeout(noticeTimer.current);
      clearTimeout(flashTimer.current);
    },
    [],
  );

  const shownOn = useCallback(
    (side: DiffSide) =>
      lines.flatMap((line) => {
        const lineNumber = lineNumberOn(line, side);
        return lineNumber === undefined ? [] : [lineNumber];
      }),
    [lines],
  );

  const apply = useCallback((change: PickChange) => {
    if ('mixedSides' in change) {
      setNotice(MIXED_SIDES_NOTICE);
      clearTimeout(noticeTimer.current);
      noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
      return;
    }
    setPick(change.pick);
    setQuote(undefined);
    if (!change.pick) setAddMode(false);
  }, []);

  const close = useCallback(() => {
    setPick(null);
    setQuote(undefined);
    setAddMode(false);
  }, []);

  const start = useCallback((side: DiffSide, line: LineNumber, nextQuote?: string) => {
    setPick(pickLines(side, line));
    setQuote(nextQuote);
  }, []);

  const open = useCallback(
    (side: DiffSide, line: LineNumber) => {
      const next = pickLines(side, line);
      const same =
        quote === undefined &&
        pick?.side === side &&
        pick.lines.length === next.lines.length &&
        pick.lines.every((lineNumber, index) => lineNumber === next.lines[index]);
      if (same) close();
      else start(side, line);
    },
    [pick, quote, close, start],
  );

  const toggle = useCallback(
    (selection: LineSelection) => {
      const seed = sameSelection(anchor, cursorLineRef.current) ? (anchor ?? undefined) : undefined;
      apply(toggleLine(pick, selection, seed));
      setAnchor(selection);
    },
    [anchor, pick, apply],
  );

  const extend = useCallback(
    (selection: LineSelection) => {
      apply(extendTo(pick, anchor, selection, shownOn(selection.side)));
      if (!pick?.adding) setAnchor(selection);
    },
    [pick, anchor, shownOn, apply],
  );

  const contentOf = useCallback(
    (side: DiffSide, line: LineNumber) => {
      const [start, end] = Array.isArray(line) ? line : [line, line];
      return lines
        .filter((diffLine) => {
          const lineNumber = lineNumberOn(diffLine, side);
          return lineNumber !== undefined && lineNumber >= start && lineNumber <= end;
        })
        .map((diffLine) => diffLine.content)
        .join('\n');
    },
    [lines],
  );

  const flash = useCallback((threadId: string) => {
    setFlashedThreadId(threadId);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashedThreadId(null), FLASH_MS);
  }, []);

  return useMemo(
    () => ({
      pick,
      quote,
      addMode,
      notice,
      flashedThreadId,
      start,
      open,
      toggle,
      extend,
      setAnchor,
      setAddMode,
      close,
      contentOf,
      flash,
    }),
    [
      pick,
      quote,
      addMode,
      notice,
      flashedThreadId,
      start,
      open,
      toggle,
      extend,
      close,
      contentOf,
      flash,
    ],
  );
}

const LinePickContext = createContext<LinePickStore | null>(null);

// Shares one pick across the parts of a file's diff, so a comment can take lines from several.
export function LinePickProvider({
  lines,
  cursorLine,
  children,
}: {
  lines: readonly DiffLine[];
  cursorLine: LineSelection | null;
  children: ReactNode;
}) {
  const store = useLinePickState(lines, cursorLine);
  return <LinePickContext.Provider value={store}>{children}</LinePickContext.Provider>;
}

export function useLinePick(
  lines: readonly DiffLine[],
  cursorLine: LineSelection | null,
): LinePickStore {
  const own = useLinePickState(lines, cursorLine);
  return useContext(LinePickContext) ?? own;
}

export function cursorLineOf(
  line: DiffLine | undefined,
  cursorSide: 'left' | 'right' | undefined,
): LineSelection | null {
  if (!line) return null;
  const side: DiffSide = cursorSide === 'left' ? 'old' : 'new';
  const lineNumber = lineNumberOn(line, side);
  return lineNumber === undefined ? null : { side, lineNumber };
}
