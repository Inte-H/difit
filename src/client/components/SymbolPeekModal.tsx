import { ArrowLeft, X } from 'lucide-react';
import type { Token } from 'prism-react-renderer';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

import type { SymbolMatch, SymbolSearchResponse } from '../../types/diff';
import { useHighlightedCode } from '../hooks/useHighlightedCode';
import { fetchBlobText, tokenizeContent } from '../utils/fileTokens';
import { getPrismLanguageFromFilename } from '../utils/languageDetection';
import { fetchSymbol, type SymbolPeekRequest } from '../utils/symbolPeek';

import { EnhancedPrismSyntaxHighlighter } from './EnhancedPrismSyntaxHighlighter';
import type { AppearanceSettings } from './SettingsModal';

// Larger files are shown only around the selected line so the view stays responsive.
const MAX_SHOWN_LINES = 2000;
// Highlighting more text than this at once, or a longer single line, can stall the page.
const MAX_TOKENIZED_CHARS = 1_000_000;
const MAX_HIGHLIGHTED_LINE_LENGTH = 10_000;

function isLongLine(content: string): boolean {
  return content.length > MAX_HIGHLIGHTED_LINE_LENGTH;
}

function highlightedLength(lines: readonly string[]): number {
  let length = 0;
  for (const content of lines) {
    if (!isLongLine(content)) length += content.length;
  }
  return length;
}

interface SymbolPeekModalProps {
  request: SymbolPeekRequest;
  hidden?: boolean;
  canGoBack: boolean;
  onBack: () => void;
  onClose: () => void;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

type SearchState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'done'; result: SymbolSearchResponse };

export function SymbolPeekModal({
  request,
  hidden = false,
  canGoBack,
  onBack,
  onClose,
  syntaxTheme,
}: SymbolPeekModalProps) {
  const [search, setSearch] = useState<SearchState>({ status: 'loading' });
  const [selected, setSelected] = useState<SymbolMatch | null>(null);

  useHotkeys('escape', () => onClose(), { enabled: !hidden }, [onClose, hidden]);

  useEffect(() => {
    const controller = new AbortController();
    setSearch({ status: 'loading' });
    setSelected(null);
    fetchSymbol(request, controller.signal).then(
      (result) => {
        if (controller.signal.aborted) return;
        setSearch({ status: 'done', result });
        setSelected(result.definitions[0] ?? result.references[0] ?? null);
      },
      () => {
        if (!controller.signal.aborted) setSearch({ status: 'failed' });
      },
    );
    return () => controller.abort();
  }, [request]);

  return (
    <div
      hidden={hidden}
      className={`fixed inset-0 z-50 items-stretch justify-center md:items-center ${hidden ? 'hidden' : 'flex'}`}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        role="dialog"
        aria-label={`${request.name} 찾기`}
        className="relative flex h-full w-full flex-col overflow-hidden border border-github-border bg-github-bg-primary shadow-lg md:mx-4 md:h-[85vh] md:max-w-6xl md:rounded-lg"
      >
        <div className="flex items-center gap-2 border-b border-github-border px-4 py-3">
          {canGoBack && (
            <button
              onClick={onBack}
              className="text-github-text-secondary transition-colors hover:text-github-text-primary"
              aria-label="뒤로"
            >
              <ArrowLeft size={18} />
            </button>
          )}
          <h2 className="min-w-0 flex-1 truncate text-sm text-github-text-primary">
            <code className="font-mono font-semibold">{request.name}</code>
            <span className="ml-2 text-xs text-github-text-secondary">@ {request.ref}</span>
          </h2>
          <button
            onClick={onClose}
            className="text-github-text-secondary transition-colors hover:text-github-text-primary"
            aria-label="닫기"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav className="max-h-[35vh] shrink-0 overflow-y-auto border-b border-github-border md:max-h-none md:w-80 md:border-b-0 md:border-r">
            {search.status === 'loading' && <Notice>찾는 중…</Notice>}
            {search.status === 'failed' && <Notice>이 리비전에서는 찾을 수 없습니다.</Notice>}
            {search.status === 'done' && (
              <MatchList result={search.result} selected={selected} onSelect={setSelected} />
            )}
          </nav>
          <div className="min-h-0 min-w-0 flex-1 overflow-auto">
            {selected && (
              <SymbolFileView
                key={selected.path}
                path={selected.path}
                gitRef={request.ref}
                line={selected.line}
                syntaxTheme={syntaxTheme}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-3 text-sm text-github-text-secondary">{children}</p>;
}

interface MatchListProps {
  result: SymbolSearchResponse;
  selected: SymbolMatch | null;
  onSelect: (match: SymbolMatch) => void;
}

function MatchList({ result, selected, onSelect }: MatchListProps) {
  if (result.definitions.length === 0 && result.references.length === 0) {
    return <Notice>찾지 못했습니다.</Notice>;
  }

  const section = (title: string, matches: SymbolMatch[]) =>
    matches.length > 0 && (
      <section>
        <h3 className="sticky top-0 bg-github-bg-secondary px-4 py-1.5 text-xs font-semibold text-github-text-secondary">
          {title} {matches.length}
        </h3>
        <ul>
          {matches.map((match) => {
            const isSelected = match === selected;
            return (
              <li key={`${match.path}:${match.line}`}>
                <button
                  onClick={() => onSelect(match)}
                  aria-current={isSelected}
                  className={`block w-full px-4 py-1.5 text-left transition-colors hover:bg-github-bg-tertiary ${isSelected ? 'bg-github-bg-tertiary' : ''}`}
                >
                  <span className="block truncate text-xs text-github-text-secondary">
                    {match.path}:{match.line}
                  </span>
                  <code className="block truncate font-mono text-xs text-github-text-primary">
                    {match.text.trim()}
                  </code>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );

  return (
    <>
      {section('선언', result.definitions)}
      {section('쓰인 곳', result.references)}
      {result.truncated && <Notice>결과가 많아 일부만 보여 줍니다.</Notice>}
    </>
  );
}

interface SymbolFileViewProps {
  path: string;
  gitRef: string;
  line: number;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

function SymbolFileView({ path, gitRef, line, syntaxTheme }: SymbolFileViewProps) {
  const [text, setText] = useState<string | null | undefined>(undefined);
  const language = useMemo(() => getPrismLanguageFromFilename(path), [path]);
  const { ready: grammarReady } = useHighlightedCode(language);
  const targetRow = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchBlobText(path, gitRef, controller.signal).then((fetched) => {
      if (!controller.signal.aborted) setText(fetched?.replace(/\r\n/g, '\n') ?? null);
    });
    return () => controller.abort();
  }, [path, gitRef]);

  const lines = useMemo(() => {
    if (!text) return text === '' ? [] : null;
    const split = text.split('\n');
    if (split.at(-1) === '') split.pop();
    return split;
  }, [text]);
  const total = lines?.length ?? 0;
  const windowed = total > MAX_SHOWN_LINES;
  const first = windowed
    ? Math.max(1, Math.min(line - MAX_SHOWN_LINES / 2, total - MAX_SHOWN_LINES + 1))
    : 1;
  const last = windowed ? first + MAX_SHOWN_LINES - 1 : total;
  const shown = useMemo(() => lines?.slice(first - 1, last) ?? null, [lines, first, last]);
  const fileTokens = useMemo(() => {
    if (!lines || !grammarReady || highlightedLength(lines) > MAX_TOKENIZED_CHARS) return null;
    const tokens: (Token[] | null)[] = [];
    let run: string[] = [];
    const tokenizeRun = () => {
      if (run.length === 0) return;
      const runTokens = tokenizeContent(run.join('\n'), language, null);
      run.forEach((_, index) => tokens.push(runTokens?.[index] ?? null));
      run = [];
    };
    for (const content of lines) {
      if (isLongLine(content)) {
        tokenizeRun();
        tokens.push(null);
      } else {
        run.push(content);
      }
    }
    tokenizeRun();
    return tokens;
  }, [lines, grammarReady, language]);
  const plainText = useMemo(() => {
    if (fileTokens || !shown) return false;
    return highlightedLength(shown) > MAX_TOKENIZED_CHARS;
  }, [fileTokens, shown]);
  const lineTokens = useMemo(
    () =>
      fileTokens?.slice(first - 1, last).map((tokenLine) => (tokenLine ? [tokenLine] : null)) ??
      null,
    [fileTokens, first, last],
  );

  useEffect(() => {
    targetRow.current?.scrollIntoView?.({ block: 'center' });
  }, [shown, line]);

  if (text === null) return <Notice>파일을 읽지 못했습니다.</Notice>;
  if (!shown) return <Notice>파일을 읽는 중…</Notice>;

  return (
    <div className="font-mono text-xs" data-symbol-ref={gitRef} data-symbol-path={path}>
      <div className="sticky top-0 z-10 border-b border-github-border bg-github-bg-secondary px-4 py-1.5 text-xs text-github-text-secondary">
        {path}
        {windowed && ` · ${first}-${last}줄만 보여 줍니다`}
      </div>
      <table className="w-full border-collapse">
        <tbody>
          {shown.map((content, index) => {
            const lineNumber = first + index;
            const isTarget = lineNumber === line;
            return (
              <tr
                key={lineNumber}
                ref={isTarget ? targetRow : undefined}
                className={isTarget ? 'bg-github-accent/15' : undefined}
              >
                <td className="w-12 select-none border-r border-github-border px-2 text-right align-top text-github-text-muted">
                  {lineNumber}
                </td>
                <td className="px-3 align-top">
                  {plainText || isLongLine(content) ? (
                    <span className="whitespace-pre-wrap break-all text-github-text-primary select-text">
                      {content}
                    </span>
                  ) : (
                    <EnhancedPrismSyntaxHighlighter
                      code={content}
                      className="whitespace-pre-wrap break-all text-github-text-primary select-text [&_pre]:m-0 [&_pre]:p-0 [&_pre]:!bg-transparent [&_pre]:font-inherit [&_pre]:text-inherit [&_pre]:leading-inherit [&_code]:!bg-transparent [&_code]:font-inherit [&_code]:text-inherit [&_code]:leading-inherit"
                      syntaxTheme={syntaxTheme}
                      filename={path}
                      precomputedTokens={lineTokens?.[index] ?? null}
                    />
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
