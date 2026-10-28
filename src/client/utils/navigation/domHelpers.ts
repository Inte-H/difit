import type { DiffSide } from '../../../types/diff';
import type { CursorPosition, ViewMode } from '../../hooks/keyboardNavigation/types';

/**
 * Creates a DOM element ID from a cursor position
 * Format: file-{fileIndex}-chunk-{chunkIndex}-line-{lineIndex}[-{side}]
 */
export function getElementId(position: CursorPosition, viewMode: ViewMode): string {
  const baseId = `${getFileLineIdPrefix(position.fileIndex)}${position.chunkIndex}-line-${position.lineIndex}`;
  return viewMode === 'split' ? `${baseId}-${position.side}` : baseId;
}

export function getFileLineIdPrefix(fileIndex: number): string {
  return `file-${fileIndex}-chunk-`;
}

export function positionFromElementId(id: string): CursorPosition | null {
  const match = /^file-(\d+)-chunk-(\d+)-line-(\d+)(?:-(left|right))?$/.exec(id);
  if (!match) return null;
  return {
    fileIndex: Number(match[1]),
    chunkIndex: Number(match[2]),
    lineIndex: Number(match[3]),
    side: match[4] === 'left' ? 'left' : 'right',
  };
}

/**
 * Creates a comment lookup key from file path and line number
 */
export function getCommentKey(filePath: string, lineNumber: number, side?: DiffSide): string {
  return `${filePath}:${lineNumber}:${side ?? 'any'}`;
}
