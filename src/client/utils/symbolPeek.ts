import type { SymbolMatch, SymbolSearchResponse } from '../../types/diff';
import { isSymbolName } from '../../utils/symbolName';

export interface SymbolPeekRequest {
  name: string;
  ref: string;
  from?: string;
  // Where the name was clicked in `from`: a 1-based line and the 0-based UTF-16 offset of the
  // name in that line, which lets a commit's index tell apart names that look the same.
  line?: number;
  column?: number;
}

export interface ReviewRefs {
  base?: string;
  target?: string;
}

// Offset of `name` within `line`, not counting the `+`/`-` marker of a diff row.
function columnOf(word: Element, name: string, line: Element): number | null {
  const walker = line.ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let column = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (word.contains(node)) {
      return column + Math.max(0, (word.textContent ?? '').indexOf(name));
    }
    if (!node.parentElement?.closest('[data-diff-prefix]')) {
      column += node.nodeValue?.length ?? 0;
    }
  }
  return null;
}

function positionOf(word: Element, name: string, host: Element) {
  const line = word.closest<HTMLElement>('[data-symbol-line]');
  if (!line || !host.contains(line) || host.closest('[data-symbol-no-position]')) return {};
  const lineNumber = Number(line.dataset.symbolLine);
  if (!Number.isInteger(lineNumber) || lineNumber < 1) return {};
  const column = columnOf(word, name, line);
  return column === null ? {} : { line: lineNumber, column };
}

// Code that can be searched carries `data-symbol-ref`, or `data-symbol-side` when it is a diff
// line whose ref depends on the side it is on.
export function symbolRequestFromTarget(
  target: EventTarget | null,
  refs: ReviewRefs,
): SymbolPeekRequest | null {
  if (!(target instanceof Element)) return null;
  const word = target.closest<HTMLElement>('.word-token');
  const name = word?.dataset.word;
  if (!word || !name || !isSymbolName(name)) return null;

  const host = word.closest<HTMLElement>('[data-symbol-ref], [data-symbol-side]');
  if (!host) return null;
  const ref =
    host.dataset.symbolRef ?? (host.dataset.symbolSide === 'old' ? refs.base : refs.target);
  if (!ref) return null;

  const from = host.dataset.symbolPath;
  return from ? { name, ref, from, ...positionOf(word, name, host) } : { name, ref };
}

export async function fetchSymbol(
  request: SymbolPeekRequest,
  signal?: AbortSignal,
): Promise<SymbolSearchResponse> {
  const params = new URLSearchParams({ name: request.name, ref: request.ref });
  if (request.from) params.set('from', request.from);
  if (request.line !== undefined && request.column !== undefined) {
    params.set('line', String(request.line));
    params.set('column', String(request.column));
  }
  const response = await fetch(`/api/symbol?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Symbol search failed: ${response.status}`);
  return (await response.json()) as SymbolSearchResponse;
}

export function isSameMatch(a: SymbolMatch | null, b: SymbolMatch | null): boolean {
  return a !== null && b !== null && a.path === b.path && a.line === b.line;
}

export function reselect(
  current: SymbolMatch | null,
  result: SymbolSearchResponse,
): SymbolMatch | null {
  const matches = [...result.definitions, ...result.references];
  return matches.find((match) => isSameMatch(match, current)) ?? matches[0] ?? null;
}
