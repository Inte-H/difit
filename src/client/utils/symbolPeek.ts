import type { SymbolSearchResponse } from '../../types/diff';
import { isSymbolName } from '../../utils/symbolName';

export interface SymbolPeekRequest {
  name: string;
  ref: string;
  from?: string;
}

export interface ReviewRefs {
  base?: string;
  target?: string;
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
  return from ? { name, ref, from } : { name, ref };
}

export async function fetchSymbol(
  request: SymbolPeekRequest,
  signal?: AbortSignal,
): Promise<SymbolSearchResponse> {
  const params = new URLSearchParams({ name: request.name, ref: request.ref });
  if (request.from) params.set('from', request.from);
  const response = await fetch(`/api/symbol?${params.toString()}`, { signal });
  if (!response.ok) throw new Error(`Symbol search failed: ${response.status}`);
  return (await response.json()) as SymbolSearchResponse;
}
