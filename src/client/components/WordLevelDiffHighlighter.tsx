import { Highlight, type Token } from 'prism-react-renderer';
import React from 'react';

import { useHighlightedCode } from '../hooks/useHighlightedCode';
import { getPrismLanguageFromFilename } from '../utils/languageDetection';
import Prism from '../utils/prism';
import { getSyntaxTheme } from '../utils/syntaxThemes';
import { isWordToken } from '../utils/wordDetection';
import { type DiffSegment } from '../utils/wordLevelDiff';

import type { AppearanceSettings } from './SettingsModal';

interface WordLevelDiffHighlighterProps {
  segments: DiffSegment[];
  className?: string;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
  filename?: string;
  precomputedTokens?: Token[][] | null;
}

type GetTokenProps = (options: { token: Token }) => Record<string, unknown>;

const textOf = (tokens: Token[]) => tokens.map((token) => token.content).join('');

function tokensPerSegment(tokens: Token[], segments: DiffSegment[]): Token[][] {
  let offset = 0;
  const placed = tokens.map((token) => {
    const start = offset;
    offset += token.content.length;
    return { token, start };
  });
  let segmentStart = 0;
  return segments.map((segment) => {
    const start = segmentStart;
    const end = start + segment.value.length;
    segmentStart = end;
    return placed.flatMap(({ token, start: tokenStart }) => {
      const content = token.content.slice(
        Math.max(0, start - tokenStart),
        Math.max(0, end - tokenStart),
      );
      return content ? [{ ...token, content }] : [];
    });
  });
}

function renderWords(text: string) {
  return text.split(/(\w+)/).map((part, partIndex) =>
    isWordToken(part) ? (
      <span key={partIndex} className="word-token" data-word={part}>
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function diffClassOf(segment: DiffSegment) {
  if (segment.type === 'added') return 'word-diff-added';
  if (segment.type === 'removed') return 'word-diff-removed';
  return '';
}

export const WordLevelDiffHighlighter = React.memo(function WordLevelDiffHighlighter({
  segments,
  className = '',
  syntaxTheme = 'vsDark',
  filename = '',
  precomputedTokens,
}: WordLevelDiffHighlighterProps) {
  const code = segments.map((segment) => segment.value).join('');
  const { actualLang } = useHighlightedCode(
    filename ? getPrismLanguageFromFilename(filename) : 'text',
  );
  const precomputedLine = precomputedTokens?.[0];
  const usablePrecomputed =
    precomputedLine && textOf(precomputedLine) === code ? precomputedLine : null;

  const renderSegments = (lineTokens: Token[] | null, getTokenProps: GetTokenProps) => {
    const pieces = lineTokens ? tokensPerSegment(lineTokens, segments) : null;
    return segments.map((segment, index) => {
      const segmentTokens = pieces?.[index];
      return (
        <span key={index} className={diffClassOf(segment)}>
          {segmentTokens
            ? segmentTokens.map((token, tokenIndex) => (
                <span key={tokenIndex} {...getTokenProps({ token })}>
                  {renderWords(token.content)}
                </span>
              ))
            : renderWords(segment.value)}
        </span>
      );
    });
  };

  return (
    <Highlight
      code={usablePrecomputed ? '' : code}
      language={actualLang}
      theme={getSyntaxTheme(syntaxTheme)}
      prism={Prism}
    >
      {({ style, tokens, getTokenProps }) => {
        const lineTokens = usablePrecomputed ?? tokens[0] ?? null;
        return (
          <span
            className={className}
            style={{ ...style, background: 'transparent', backgroundColor: 'transparent' }}
          >
            {renderSegments(
              lineTokens && textOf(lineTokens) === code ? lineTokens : null,
              getTokenProps,
            )}
          </span>
        );
      }}
    </Highlight>
  );
});
