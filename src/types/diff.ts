export interface DiffFile {
  path: string;
  oldPath?: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  chunks: DiffChunk[];
  isGenerated?: boolean;
}

export interface DiffChunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'add' | 'delete' | 'normal' | 'hunk' | 'remove' | 'context' | 'header';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export type DiffViewMode = 'split' | 'unified';
export type DiffSide = 'old' | 'new';
export type DiffLineRange = number | { start: number; end: number };

export interface DiffCommentPosition {
  side: DiffSide;
  line: DiffLineRange;
}

export interface DiffCommentCodeSnapshot {
  content: string;
  language?: string;
  // The target commit the content was read from; absent when the target was not a commit.
  commit?: string;
}

export type BaseMode = 'direct' | 'merge-base';

export interface DiffSelection {
  baseCommitish: string;
  targetCommitish: string;
  baseMode?: BaseMode;
}

export interface DiffResponse {
  commit: string;
  files: DiffFile[];
  ignoreWhitespace?: boolean;
  isEmpty?: boolean;
  openInEditorAvailable?: boolean;
  baseCommitish?: string;
  targetCommitish?: string;
  requestedBaseCommitish?: string;
  requestedTargetCommitish?: string;
  requestedBaseMode?: BaseMode;
  clearComments?: boolean;
  repositoryId?: string;
  commentImports?: CommentImport[];
  commentImportId?: string;
}

export interface GeneratedStatusResponse {
  path: string;
  ref: string;
  isGenerated: boolean;
  source: 'path' | 'content';
}

export type LineNumber = number | [number, number];

export interface Comment {
  id: string;
  file: string;
  line: LineNumber;
  body: string;
  timestamp: string;
  author?: string;
  codeContent?: string; // The actual code content for this line
  side?: DiffSide; // Which side the comment is on
}

export interface LineSelection {
  side: DiffSide;
  lineNumber: number;
}

export interface LegacyDiffComment {
  id: string;
  filePath: string;
  body: string;
  author?: string;
  createdAt: string; // ISO 8601 format
  updatedAt: string; // ISO 8601 format

  position: DiffCommentPosition;

  codeSnapshot?: DiffCommentCodeSnapshot;
}

export interface DiffCommentMessage {
  id: string;
  body: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
}

// New data structures for enhanced comment and viewed state management
export interface DiffCommentThread {
  id: string;
  filePath: string;
  createdAt: string; // ISO 8601 format
  updatedAt: string; // ISO 8601 format

  position: DiffCommentPosition;

  codeSnapshot?: DiffCommentCodeSnapshot;

  messages: DiffCommentMessage[];
}

interface CommentImportBase {
  id?: string;
  filePath: string;
  position: DiffCommentPosition;
  body: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  codeSnapshot?: DiffCommentCodeSnapshot;
}

export interface ThreadCommentImport extends CommentImportBase {
  type: 'thread';
}

export interface ReplyCommentImport extends CommentImportBase {
  type: 'reply';
}

export type CommentImport = ThreadCommentImport | ReplyCommentImport;

export interface ViewedFileRecord {
  filePath: string;
  viewedAt: string; // ISO 8601 format
  diffContentHash: string; // SHA-256 hash
}

export interface ViewedHashIndexEntry {
  filePath: string;
  diffContentHash: string;
  hashVersion: 1;
  viewedAt: string; // ISO 8601 format
}

export interface ViewedHashIndex {
  version: 1;
  lastModifiedAt: string; // ISO 8601 format
  entries: ViewedHashIndexEntry[];
}

export interface LegacyDiffContextStorage {
  version: 1; // Schema version
  baseCommitish: string;
  targetCommitish: string;
  createdAt: string; // ISO 8601 format
  lastModifiedAt: string; // ISO 8601 format

  comments: LegacyDiffComment[];
  viewedFiles: ViewedFileRecord[];
}

export interface DiffContextStorage {
  version: 2; // Schema version
  baseCommitish: string;
  targetCommitish: string;
  baseMode?: BaseMode;
  createdAt: string; // ISO 8601 format
  lastModifiedAt: string; // ISO 8601 format

  threads: DiffCommentThread[];
  viewedFiles: ViewedFileRecord[];
  appliedCommentImportIds: string[];
  // Optional so a record stays version 2 and an older difit still reads it.
  decisions?: ReviewDecision[];
}

export type ReviewDecisionKind = 'rejected' | 'approved' | 'unapproved' | 'folded';

// Threads carry no resolved state; a thread's screen state is derived from these
// records plus the fixup commits found by trailer.
export interface ReviewDecision {
  threadId: string;
  kind: ReviewDecisionKind;
  fixupSha: string;
  // Identifies the fixup's changes across rebases that rewrite fixupSha.
  patchId?: string;
  targetSha?: string;
  at: string; // ISO 8601 format
}

export type ThreadReviewState =
  | 'awaiting-fix'
  | 'awaiting-approval'
  | 'approved'
  | 'folded'
  | 'rejected';

// A commit carrying a `Review-Thread: <threadId>` trailer is the agent's answer to that thread.
export const REVIEW_THREAD_TRAILER = 'Review-Thread';

export interface ThreadFixup {
  sha: string;
  shortSha: string;
  // Same for two commits that add and remove the same lines in the same files.
  patchId: string;
  subject: string;
  threadIds: string[];
  files: Array<Pick<DiffFile, 'path' | 'oldPath' | 'status' | 'chunks'>>;
}

export interface FixupsResponse {
  // Commits between the reviewed target and HEAD that carry the trailer, oldest first.
  fixups: ThreadFixup[];
}

// The saved snapshot is gone from the file, or occurs in more than one place.
export type AnchorStaleReason = 'missing' | 'ambiguous';

export interface CommentThread {
  id: string;
  file: string;
  // Where the thread is drawn now, relocated by snapshot content; may differ from the stored position.
  line: LineNumber;
  side?: DiffSide;
  createdAt: string;
  updatedAt: string;
  codeContent?: string;
  anchorCommit?: string;
  isOutdated?: boolean;
  outdatedReason?: AnchorStaleReason;
  messages: DiffCommentMessage[];
}

// Revision selector types
interface RevisionOption {
  value: string;
  label: string;
}

interface BranchInfo {
  name: string;
  current: boolean;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
}

export interface RevisionsResponse {
  specialOptions: RevisionOption[];
  branches: BranchInfo[];
  commits: CommitInfo[];
  originDefaultBranch?: string;
  resolvedBase?: string;
  resolvedTarget?: string;
}

// Expanded lines types for showing more context in diffs
export interface ExpandedLinesState {
  [filePath: string]: FileExpandedState;
}

export interface FileExpandedState {
  oldContent?: string[];
  newContent?: string[];
  expandedRanges: ExpandedRange[];
  oldTotalLines?: number;
  newTotalLines?: number;
}

interface ExpandedRange {
  chunkIndex: number;
  direction: 'up' | 'down';
  count: number;
}

export interface ExpandedLine extends DiffLine {
  isExpanded?: boolean;
}
