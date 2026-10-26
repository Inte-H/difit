import { useState } from 'react';

import type {
  CommentThread,
  DiffChunk,
  DiffLine,
  MessageAmendment,
  ThreadFixup,
} from '../../types/diff';
import {
  combineChangeKinds,
  LEAVES_CODE_ALONE_LABEL,
  LEAVES_CODE_ALONE_TITLE,
  leavesCodeAlone,
} from '../../utils/changeKind';
import { locationLabel } from '../../utils/commentPosition';
import { FileLevelTokensProvider } from '../contexts/FileLevelTokensContext';
import { useFixupOverlay } from '../contexts/FixupOverlayContext';
import { fixupFileElementId } from '../utils/domUtils';
import {
  type FixupBox,
  type FixupFile,
  fixupFileKey,
  fixupFileLabels,
  fixupFileName,
  overlaidFixups,
} from '../utils/fixupSpread';

import { DiffCodeLine } from './DiffCodeLine';
import type { AppearanceSettings } from './SettingsModal';

interface FixupOverlayCardProps {
  fixup: ThreadFixup;
  threadId: string;
  filePath: string;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

const NO_PRECOMPUTED_TOKENS = { getOldTokens: null, getNewTokens: null };

const getOverlayLineClass = (line: DiffLine) => {
  switch (line.type) {
    case 'add':
      return 'bg-fixup-addition-bg border-l-2 border-github-warning';
    case 'delete':
      return 'opacity-50 line-through border-l-2 border-transparent';
    default:
      return 'border-l-2 border-transparent';
  }
};

function FixupFileLabels({ file }: { file: FixupFile }) {
  return fixupFileLabels(file).map((label) => (
    <span key={label} className="ml-2 text-github-text-secondary">
      {label}
    </span>
  ));
}

// The chunks are the fixup's own diff, so a deleted line is in the fixup's parent.
const symbolAttributes = (line: DiffLine, fixupSha: string, file: FixupFile) =>
  line.type === 'delete'
    ? {
        'data-symbol-ref': `${fixupSha}^`,
        'data-symbol-path': file.oldPath ?? file.path,
        'data-symbol-line': line.oldLineNumber,
      }
    : {
        'data-symbol-ref': fixupSha,
        'data-symbol-path': file.path,
        'data-symbol-line': line.newLineNumber,
      };

function FixupChunksTable({
  chunks,
  fixupSha,
  file,
  syntaxTheme,
}: {
  chunks: DiffChunk[];
  fixupSha: string;
  file: FixupFile;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}) {
  return (
    <FileLevelTokensProvider value={NO_PRECOMPUTED_TOKENS}>
      <table className="w-full table-fixed border-collapse font-mono text-sm leading-5">
        <tbody>
          {chunks.map((chunk, chunkIndex) =>
            chunk.lines.map((line, lineIndex) => (
              <tr key={`${chunkIndex}-${lineIndex}`} className={getOverlayLineClass(line)}>
                <td className="w-[var(--line-number-width)] min-w-[var(--line-number-width)] max-w-[var(--line-number-width)] px-2 max-md:px-0.5 max-md:text-[11px] text-right text-github-text-muted select-none align-top">
                  {line.newLineNumber ?? line.oldLineNumber ?? ''}
                </td>
                <td
                  className="p-0 w-full align-top [&_span:first-child]:!bg-transparent"
                  {...symbolAttributes(line, fixupSha, file)}
                >
                  <DiffCodeLine
                    line={line}
                    syntaxTheme={syntaxTheme}
                    filename={file.path}
                    showPrefixBorder={false}
                  />
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </FileLevelTokensProvider>
  );
}

function AmendedMessage({ message, separated }: { message: MessageAmendment; separated: boolean }) {
  const sides = [
    { label: '지금 메시지', text: message.before },
    { label: '바뀔 메시지', text: message.after },
  ];
  return (
    <div
      data-testid="fixup-amended-message"
      className={`grid grid-cols-2 max-md:grid-cols-1 border-github-border ${separated ? 'border-b' : ''}`}
    >
      {sides.map(({ label, text }) => (
        <div
          key={label}
          className="px-3 py-1.5 min-w-0 border-github-border [&+&]:border-l max-md:[&+&]:border-l-0 max-md:[&+&]:border-t"
        >
          <div className="text-xs text-github-text-secondary">{label}</div>
          <pre className="m-0 whitespace-pre-wrap break-words font-mono text-sm text-github-text-primary">
            {text}
          </pre>
        </div>
      ))}
    </div>
  );
}

function FixupOverlayCard({ fixup, threadId, filePath, syntaxTheme }: FixupOverlayCardProps) {
  const { revealFixupFile, fixupReviewPaths, fixupPlaces } = useFixupOverlay();
  const keyOf = (file: FixupFile) => fixupFileKey({ fixupSha: fixup.sha, path: file.path });
  const isThisFile = (file: FixupFile) =>
    (fixupReviewPaths.get(keyOf(file)) ?? file.oldPath ?? file.path) === filePath;
  const isHeldHere = (file: FixupFile) => {
    const place = fixupPlaces.get(keyOf(file));
    return place?.kind === 'card' && place.threadId === threadId;
  };
  const thisFiles = fixup.files.filter(isThisFile);
  const heldFiles = fixup.files.filter((file) => !isThisFile(file) && isHeldHere(file));
  const otherFiles = fixup.files.filter((file) => !isThisFile(file) && !isHeldHere(file));
  const changeKind = combineChangeKinds(
    fixup.files.flatMap((file) => file.chunks.map((chunk) => chunk.changeKind)),
  );

  return (
    <div
      data-testid="fixup-overlay-card"
      className="ml-6 mr-2 my-1 rounded-md border border-github-warning/60 bg-github-bg-secondary overflow-hidden"
    >
      <div className="px-3 py-1 text-xs font-mono text-github-text-secondary border-b border-github-border">
        {fixup.shortSha}
        {leavesCodeAlone(changeKind) && (
          <span
            data-testid="fixup-change-kind"
            title={LEAVES_CODE_ALONE_TITLE[changeKind]}
            className="ml-2 rounded px-1.5 bg-github-bg-tertiary text-github-text-primary"
          >
            {LEAVES_CODE_ALONE_LABEL[changeKind]}
          </span>
        )}
      </div>
      {fixup.amendedMessage && (
        <AmendedMessage message={fixup.amendedMessage} separated={thisFiles.length > 0} />
      )}
      {thisFiles.map((file) => (
        <FixupChunksTable
          key={file.path}
          chunks={file.chunks}
          fixupSha={fixup.sha}
          file={file}
          syntaxTheme={syntaxTheme}
        />
      ))}
      {heldFiles.map((file) => (
        <div key={file.path} className="border-t border-github-border">
          <div className="px-3 py-1 text-xs font-mono text-github-text-secondary">
            {fixupFileName(file)}
            <FixupFileLabels file={file} />
          </div>
          <FixupChunksTable
            chunks={file.chunks}
            fixupSha={fixup.sha}
            file={file}
            syntaxTheme={syntaxTheme}
          />
        </div>
      ))}
      {otherFiles.length > 0 && (
        <div className="px-3 py-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs border-t border-github-border">
          <span className="text-github-text-secondary">이 fixup에서 수정한 다른 파일:</span>
          {otherFiles.map((file) => (
            <span key={file.path}>
              <button
                type="button"
                onClick={() => revealFixupFile(fixup.sha, file.path)}
                className="font-mono text-github-accent hover:underline"
              >
                {fixupFileName(file)}
              </button>
              <FixupFileLabels file={file} />
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const locationOf = ({ file, line }: Pick<CommentThread, 'file' | 'line'>) =>
  locationLabel(file, line);

// Read aloud, a line number ending in 2, 4, 5 or 9 ends in a vowel; a path read letter by letter
// ends in a consonant only after l, m, n or r.
const objectParticle = (label: string) => (/[2459]$|[^0-9lmnr]$/i.test(label) ? '를' : '을');

function FixupFileBox({
  box,
  syntaxTheme,
}: {
  box: FixupBox;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}) {
  const { focusedFixupFile, pickThread } = useFixupOverlay();
  const { fixup, threads, file, chunk, chunkIndex } = box;
  const [isOpen, setIsOpen] = useState(!file.isGenerated);
  const isFocused = focusedFixupFile?.fixupSha === fixup.sha && focusedFixupFile.path === file.path;
  if (isFocused && !isOpen) setIsOpen(true);
  const lastThread = threads[threads.length - 1];
  const lastLabel = lastThread ? locationOf(lastThread) : '';
  return (
    <div
      id={chunkIndex === 0 ? fixupFileElementId(fixup.sha, file.path) : undefined}
      data-testid="fixup-file-box"
      className={`ml-6 mr-2 my-1 rounded-md bg-github-bg-secondary overflow-hidden ${
        isFocused ? 'border-2 border-github-accent' : 'border border-github-warning/60'
      }`}
    >
      <div className="px-3 py-1 text-xs text-github-text-secondary border-b border-github-border">
        <span className="font-mono">{fixup.shortSha}</span> · 지적{' '}
        {threads.map((thread, index) => (
          <span key={thread.id}>
            {index > 0 && ', '}
            <button
              type="button"
              onClick={() => pickThread(thread.id)}
              className="font-mono text-github-accent hover:underline"
            >
              {locationOf(thread)}
            </button>
          </span>
        ))}
        {objectParticle(lastLabel)} 고치며 함께 수정함 · 승인과 거절은 그 지적 카드에서
        {file.isGenerated && <span className="ml-2">생성된 파일</span>}
        {!isOpen && (
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="ml-2 text-github-accent hover:underline"
          >
            펼치기
          </button>
        )}
      </div>
      {isOpen && (
        <FixupChunksTable
          chunks={[chunk]}
          fixupSha={fixup.sha}
          file={file}
          syntaxTheme={syntaxTheme}
        />
      )}
    </div>
  );
}

function FixupBoxes({
  boxes,
  syntaxTheme,
}: {
  boxes: readonly FixupBox[];
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}) {
  return boxes.map((box) => (
    <FixupFileBox
      key={`${box.fixup.sha}-${box.file.path}-${box.chunkIndex}`}
      box={box}
      syntaxTheme={syntaxTheme}
    />
  ));
}

interface FixupBoxRowsProps {
  filePath: string | undefined;
  lineNumber: number | undefined;
  colSpan: number;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

export function FixupBoxRows({ filePath, lineNumber, colSpan, syntaxTheme }: FixupBoxRowsProps) {
  const { boxesByFile } = useFixupOverlay();
  if (!filePath || lineNumber === undefined) return null;
  const boxes = boxesByFile.get(filePath)?.get(lineNumber);
  if (!boxes) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <FixupBoxes boxes={boxes} syntaxTheme={syntaxTheme} />
      </td>
    </tr>
  );
}

interface FixupOverlayRowProps {
  thread: CommentThread;
  filePath: string | undefined;
  colSpan: number;
  syntaxTheme?: AppearanceSettings['syntaxTheme'];
}

export function FixupOverlayBlock({
  thread,
  filePath,
  syntaxTheme,
}: Omit<FixupOverlayRowProps, 'colSpan'>) {
  const fixups = overlaidFixups(useFixupOverlay(), thread);
  if (fixups.length === 0 || !filePath) return null;
  return fixups.map((fixup) => (
    <FixupOverlayCard
      key={fixup.sha}
      fixup={fixup}
      threadId={thread.id}
      filePath={filePath}
      syntaxTheme={syntaxTheme}
    />
  ));
}

export function FixupOverlayRow({ thread, filePath, colSpan, syntaxTheme }: FixupOverlayRowProps) {
  if (overlaidFixups(useFixupOverlay(), thread).length === 0 || !filePath) return null;
  return (
    <tr>
      <td colSpan={colSpan} className="p-0">
        <FixupOverlayBlock thread={thread} filePath={filePath} syntaxTheme={syntaxTheme} />
      </td>
    </tr>
  );
}
