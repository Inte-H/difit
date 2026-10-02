import React, { useMemo } from 'react';

import { isWordToken } from '../utils/wordDetection';
import { type DiffSegment } from '../utils/wordLevelDiff';

interface WordLevelDiffHighlighterProps {
  segments: DiffSegment[];
  className?: string;
}

/**
 * Renders code with word-level diff highlighting.
 * Each segment is marked as unchanged, added, or removed with appropriate styling.
 */
export const WordLevelDiffHighlighter = React.memo(function WordLevelDiffHighlighter({
  segments,
  className = '',
}: WordLevelDiffHighlighterProps) {
  const renderedContent = useMemo(() => {
    return segments.map((segment, index) => {
      const diffClass =
        segment.type === 'added'
          ? 'word-diff-added'
          : segment.type === 'removed'
            ? 'word-diff-removed'
            : '';

      return (
        <span key={index} className={diffClass}>
          {segment.value.split(/(\w+)/).map((part, partIndex) =>
            isWordToken(part) ? (
              <span key={partIndex} className="word-token" data-word={part}>
                {part}
              </span>
            ) : (
              part
            ),
          )}
        </span>
      );
    });
  }, [segments]);

  return <span className={className}>{renderedContent}</span>;
});
