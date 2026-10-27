import type { DiffFile, DiffSide, DiffViewMode, LineNumber } from '../../../types/diff';

/**
 * Represents the current cursor position in the diff viewer
 */
export interface CursorPosition {
  fileIndex: number;
  chunkIndex: number;
  lineIndex: number;
  side: 'left' | 'right';
}

/**
 * Function that determines if a position should be included in navigation
 */
export type NavigationFilter = (position: CursorPosition, files: DiffFile[]) => boolean;

/**
 * Result of a navigation attempt
 */
export interface NavigationResult {
  position: CursorPosition | null;
  scrollTarget: string | null;
}

export interface CommentNavigationItem {
  file: string;
  line: LineNumber;
  side?: DiffSide;
}

/**
 * Props for the useKeyboardNavigation hook
 */
export interface UseKeyboardNavigationProps {
  files: DiffFile[];
  comments: CommentNavigationItem[];
  viewMode?: DiffViewMode;
  reviewedFiles: Set<string>;
  onToggleReviewed: (filePath: string) => void;
  onCreateComment?: () => void;
  onCopyAllComments?: () => void;
  onDeleteAllComments?: () => void;
  onToggleCommentsPanel?: () => void;
  onToggleFileList?: () => void;
  onRefresh?: () => void;
  onPreviousCommit?: () => void;
  onNextCommit?: () => void;
  isModalOpen?: boolean;
  getHoveredFileIndex?: () => number | null;
  // Called before a file or comment jump moves the cursor, with where it lands.
  onJump?: (to: CursorPosition) => void;
}

/**
 * Return value of the useKeyboardNavigation hook
 */
export interface UseKeyboardNavigationReturn {
  cursor: CursorPosition | null;
  isHelpOpen: boolean;
  setIsHelpOpen: (open: boolean) => void;
  setCursorPosition: (position: CursorPosition | null) => void;
  rememberFilePosition: (fileIndex: number) => void;
}

/**
 * View modes for the diff viewer
 */
export type ViewMode = DiffViewMode;

/**
 * Navigation direction
 */
export type NavigationDirection = 'next' | 'prev';

/**
 * Constants for scroll behavior
 */
export const SCROLL_CONSTANTS = {
  /** Position element at 1/3 from top of viewport */
  VIEWPORT_OFFSET_RATIO: 1 / 3,
} as const;
