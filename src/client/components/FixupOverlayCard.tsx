import type { CommentThread, DiffChunk, DiffLine, ThreadFixup } from '../../types/diff';
import { FileLevelTokensProvider } from '../contexts/FileLevelTokensContext';
import { overlaidFixup, useFixupOverlay } from '../contexts/FixupOverlayContext';

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

function FixupOverlayCard({ fixup, filePath, syntaxTheme }: FixupOverlayCardProps) {
  const isThisFile = (file: ThreadFixup['files'][number]) =>
    file.path === filePath || file.oldPath === filePath;
  const chunks: DiffChunk[] = fixup.files.filter(isThisFile).flatMap((file) => file.chunks);
  const otherPaths = fixup.files.filter((file) => !isThisFile(file)).map((file) => file.path);

  return (
    <div
      data-testid="fixup-overlay-card"
      className="ml-6 mr-2 my-1 rounded-md border border-github-warning/60 bg-github-bg-secondary overflow-hidden"
    >
      <div className="px-3 py-1 text-xs font-mono text-github-text-secondary border-b border-github-border">
        {fixup.shortSha}
        {otherPaths.length > 0 && <span> · 다른 파일도 고침: {otherPaths.join(', ')}</span>}
      </div>
      <FileLevelTokensProvider value={NO_PRECOMPUTED_TOKENS}>
        <table className="w-full table-fixed border-collapse font-mono text-sm leading-5">
          <tbody>
            {chunks.map((chunk, chunkIndex) =>
              chunk.lines.map((line, lineIndex) => (
                <tr key={`${chunkIndex}-${lineIndex}`} className={getOverlayLineClass(line)}>
                  <td className="w-[var(--line-number-width)] min-w-[var(--line-number-width)] max-w-[var(--line-number-width)] px-2 max-md:px-0.5 max-md:text-[11px] text-right text-github-text-muted select-none align-top">
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

interface FixupOverlayRowProps {
  thread: CommentThread;
  filePath: string | undefined;
  colSpan: number;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

export function FixupOverlayRow({ thread, filePath, colSpan, syntaxTheme }: FixupOverlayRowProps) {
  const fixup = overlaidFixup(useFixupOverlay(), thread);
  if (!fixup || !filePath) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <FixupOverlayCard fixup={fixup} filePath={filePath} syntaxTheme={syntaxTheme} />
      </td>
    </tr>
  );
}
