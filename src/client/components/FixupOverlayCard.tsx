import type { DiffChunk, DiffLine, ThreadFixup } from '../../types/diff';
import { FileLevelTokensProvider } from '../contexts/FileLevelTokensContext';

import { DiffCodeLine } from './DiffCodeLine';
import type { AppearanceSettings } from './SettingsModal';

interface FixupOverlayCardProps {
  fixup: ThreadFixup;
  filePath: string;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

const NO_PRECOMPUTED_TOKENS = { getOldTokens: null, getNewTokens: null };

const getOverlayLineClass = (line: DiffLine) => {
  switch (line.type) {
    case 'add':
      return 'bg-[#d2992226] border-l-2 border-github-warning';
    case 'delete':
      return 'opacity-50 line-through border-l-2 border-transparent';
    default:
      return 'border-l-2 border-transparent';
  }
};

export function FixupOverlayCard({ fixup, filePath, syntaxTheme }: FixupOverlayCardProps) {
  const chunks: DiffChunk[] = fixup.files
    .filter((file) => file.path === filePath || file.oldPath === filePath)
    .flatMap((file) => file.chunks);

  return (
    <div
      data-testid="fixup-overlay-card"
      className="ml-6 mr-2 my-1 rounded-md border border-github-warning/60 bg-github-bg-secondary overflow-hidden"
    >
      <div className="px-3 py-1 text-xs font-mono text-github-text-secondary border-b border-github-border">
        {fixup.shortSha}
      </div>
      <FileLevelTokensProvider value={NO_PRECOMPUTED_TOKENS}>
        <table className="w-full table-fixed border-collapse font-mono text-sm leading-5">
          <tbody>
            {chunks.map((chunk, chunkIndex) =>
              chunk.lines.map((line, lineIndex) => (
                <tr key={`${chunkIndex}-${lineIndex}`} className={getOverlayLineClass(line)}>
                  <td className="w-[var(--line-number-width)] min-w-[var(--line-number-width)] max-w-[var(--line-number-width)] px-2 text-right text-github-text-muted select-none align-top">
                    {line.newLineNumber ?? line.oldLineNumber ?? ''}
                  </td>
                  <td className="p-0 w-full align-top [&_span:first-child]:!bg-transparent">
                    <DiffCodeLine
                      line={line}
                      syntaxTheme={syntaxTheme}
                      filename={filePath}
                      showPrefixBorder={false}
                    />
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </FileLevelTokensProvider>
    </div>
  );
}
