import { normalizeTokens, type Token } from 'prism-react-renderer';

import Prism from './prism';

// Larger files fall back to per-line highlighting so the whole blob is not tokenized at once.
const MAX_WHOLE_FILE_LINES = 2000;

export async function fetchBlobText(
  filePath: string,
  ref: string,
  signal?: AbortSignal,
): Promise<string | null> {
  try {
    const url = `/api/blob/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(ref)}`;
    const response = await (signal ? fetch(url, { signal }) : fetch(url));
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

// `maxLines: null` leaves the size check to the caller.
export function tokenizeContent(
  content: string,
  language: string,
  maxLines: number | null = MAX_WHOLE_FILE_LINES,
): Token[][] | null {
  if (maxLines !== null && exceedsLineCount(content, maxLines)) return null;
  const grammar = Prism.languages[language];
  if (!grammar) return null;
  try {
    // Lines are counted at \n, as git does, but the tokenizer would also break at a lone \r.
    const raw = Prism.tokenize(content.replace(/\r(?!\n)/g, ' '), grammar);
    return normalizeTokens(raw);
  } catch {
    return null;
  }
}

function exceedsLineCount(content: string, limit: number): boolean {
  let lines = 0;
  let at = 0;
  while (at < content.length) {
    lines += 1;
    if (lines > limit) return true;
    const next = content.indexOf('\n', at);
    if (next === -1) break;
    at = next + 1;
  }
  return false;
}
