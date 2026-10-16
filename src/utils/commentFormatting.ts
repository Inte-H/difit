import type {
  BaseMode,
  Comment,
  CommentLocationRefs,
  CommentThread,
  DiffSide,
  ThreadReviewState,
} from '../types/diff';

import { isSameCommit } from './diffSelection.js';
import { reviewStateLabel } from './reviewDecisions.js';
import { hasSuggestionBlock, parseSuggestionBlocks } from './suggestionUtils.js';

export const UNKNOWN_FILE_PATH = '<unknown file>';

// A Claude Code mention ends its path at whitespace and reads `#` as the start of the lines.
const UNMENTIONABLE_PATH = /[\s#]/;

// A mention writes a range as `L42-48`.
function getLineInfo(line: number | number[], rangeEndPrefix = 'L'): string {
  return typeof line === 'number' ? `L${line}` : `L${line[0]}-${rangeEndPrefix}${line[1]}`;
}

export interface CommentPromptDiffContext {
  requestedBaseCommitish?: string;
  requestedTargetCommitish?: string;
  baseMode?: BaseMode;
  resolvedBaseCommitish?: string;
  resolvedTargetCommitish?: string;
  locationRefs?: CommentLocationRefs | null;
}

export interface CommentLocationOptions {
  refs?: CommentLocationRefs | null;
  // The commit the line numbers were counted in, when it can differ from the review target.
  lineCommit?: string;
  threadId?: string;
}

interface CommentLocation {
  file: string;
  line: number | number[];
  side?: DiffSide;
  lineCommit?: string;
  threadId?: string;
}

function matchesDisk(
  { file, threadId }: CommentLocation,
  refs: CommentLocationRefs | null | undefined,
): boolean {
  if (!refs || UNMENTIONABLE_PATH.test(file)) return false;
  if (refs.threadsMatchingDisk) {
    return threadId !== undefined && refs.threadsMatchingDisk.includes(threadId);
  }
  return !refs.pathsChangedOnDisk.includes(file);
}

// A mention attaches what is on disk now, so it is written only for lines that still match the
// reviewed new side; otherwise the location names the commit to read the lines from, if any.
function formatLocationRef(
  location: CommentLocation,
  refs: CommentLocationRefs | null | undefined,
): string {
  const { file, line, side, lineCommit } = location;
  const lines = getLineInfo(line);
  if (!file || file === UNKNOWN_FILE_PATH) {
    return `${UNKNOWN_FILE_PATH}:${lines}${side === 'old' ? ' (old)' : ''}`;
  }

  const countedInTarget =
    lineCommit === undefined ||
    (refs?.newCommit !== undefined && isSameCommit(lineCommit, refs.newCommit));
  if (side === 'old') {
    const oldCommit = countedInTarget ? refs?.oldCommit : undefined;
    if (!refs || !oldCommit) return `${file}:${lines} (old)`;
    const oldPath = (Object.hasOwn(refs.renamedFrom, file) ? refs.renamedFrom[file] : null) ?? file;
    return `${oldCommit}:${oldPath}:${lines} (old)`;
  }

  if (!countedInTarget) return `${lineCommit}:${file}:${lines}`;
  if (matchesDisk(location, refs)) return `@${file}#${getLineInfo(line, '')}`;
  return refs?.newCommit ? `${refs.newCommit}:${file}:${lines}` : `${file}:${lines}`;
}

function formatCommentLocation(
  location: CommentLocation,
  refs: CommentLocationRefs | null | undefined,
  reviewState?: ThreadReviewState,
): string {
  const stateSuffix = reviewState ? ` [${reviewStateLabel(reviewState)}]` : '';
  return `${formatLocationRef(location, refs)}${stateSuffix}`;
}

function isNonRangeCommitish(commitish: string): boolean {
  return (
    commitish === 'working' || commitish === 'staged' || commitish === '.' || commitish === 'stdin'
  );
}

function formatDiffContextHeader(context: CommentPromptDiffContext): string | null {
  const { requestedBaseCommitish, requestedTargetCommitish } = context;
  if (
    !requestedBaseCommitish ||
    !requestedTargetCommitish ||
    isNonRangeCommitish(requestedBaseCommitish) ||
    isNonRangeCommitish(requestedTargetCommitish)
  ) {
    return null;
  }

  const separator = context.baseMode === 'merge-base' ? '...' : '..';
  const requestedRange = `${requestedBaseCommitish}${separator}${requestedTargetCommitish}`;
  const { resolvedBaseCommitish, resolvedTargetCommitish } = context;
  const resolvedRange =
    resolvedBaseCommitish &&
    resolvedTargetCommitish &&
    (resolvedBaseCommitish !== requestedBaseCommitish ||
      resolvedTargetCommitish !== requestedTargetCommitish)
      ? ` (${resolvedBaseCommitish}${separator}${resolvedTargetCommitish})`
      : '';

  return `diff ${requestedRange}${resolvedRange}`;
}

function formatCommentContent(body: string, codeContent?: string): string {
  if (hasSuggestionBlock(body)) {
    const suggestions = parseSuggestionBlocks(body);
    if (suggestions.length > 0) {
      let result = '';
      let lastIndex = 0;

      for (const suggestion of suggestions) {
        const textBefore = body.slice(lastIndex, suggestion.startIndex).trim();
        if (textBefore) {
          result += `${result ? '\n' : ''}${textBefore}`;
        }

        if (codeContent) {
          result += `${result ? '\n' : ''}ORIGINAL:\n\`\`\`\n${codeContent}\n\`\`\``;
        }
        result += `${result ? '\n' : ''}SUGGESTED:\n\`\`\`\n${suggestion.suggestedCode}\n\`\`\``;
        lastIndex = suggestion.endIndex;
      }

      const textAfter = body.slice(lastIndex).trim();
      if (textAfter) {
        result += `${result ? '\n' : ''}${textAfter}`;
      }

      return result;
    }
  }

  return body;
}

function normalizeLegacyComment(comment: Comment): CommentThread {
  return {
    id: comment.id,
    file: comment.file,
    line: comment.line,
    side: comment.side,
    createdAt: comment.timestamp,
    updatedAt: comment.timestamp,
    codeContent: comment.codeContent,
    messages: [
      {
        id: comment.id,
        body: comment.body,
        author: comment.author,
        createdAt: comment.timestamp,
        updatedAt: comment.timestamp,
      },
    ],
  };
}

export function formatCommentPrompt(
  file: string,
  line: number | number[],
  body: string,
  codeContent?: string,
  side?: DiffSide,
  { refs, lineCommit, threadId }: CommentLocationOptions = {},
): string {
  const location = formatCommentLocation({ file, line, side, lineCommit, threadId }, refs);
  return `${location}\n${formatCommentContent(body, codeContent)}`;
}

export function formatAllCommentsPrompt(comments: Comment[]): string {
  if (comments.length === 0) return '';

  const prompts = comments.map((comment) =>
    formatCommentPrompt(
      comment.file,
      comment.line,
      comment.body,
      comment.codeContent,
      comment.side,
    ),
  );

  return prompts.join('\n=====\n');
}

export function formatCommentThreadPrompt(
  thread: CommentThread,
  reviewState?: ThreadReviewState,
  refs?: CommentLocationRefs | null,
): string {
  const location = {
    file: thread.file,
    line: thread.line,
    side: thread.side,
    lineCommit: thread.anchorCommit,
    threadId: thread.id,
  };
  const sections: string[] = [formatCommentLocation(location, refs, reviewState)];

  thread.messages.forEach((message, index) => {
    if (index === 0) {
      sections.push(formatCommentContent(message.body, thread.codeContent));
      return;
    }

    const replyIndex = index;
    const authorLabel = message.author?.trim() || 'Unknown';
    sections.push(`Reply ${replyIndex} (${authorLabel})`);
    sections.push(formatCommentContent(message.body, thread.codeContent));
  });

  return sections.filter(Boolean).join('\n');
}

export function formatAllCommentThreadsPrompt(
  threads: CommentThread[],
  context?: CommentPromptDiffContext,
  reviewStates?: ReadonlyMap<string, ThreadReviewState>,
): string {
  if (threads.length === 0) return '';

  const sections = threads.map((thread) =>
    formatCommentThreadPrompt(thread, reviewStates?.get(thread.id), context?.locationRefs),
  );
  if (context) {
    const header = formatDiffContextHeader(context);
    if (header) {
      sections.unshift(header);
    }
  }

  return sections.join('\n=====\n');
}

export function formatCommentsOutput(
  input: Comment[] | CommentThread[],
  reviewStates?: ReadonlyMap<string, ThreadReviewState>,
  locationRefs?: CommentLocationRefs | null,
): string {
  const threads = input.map((item) => ('messages' in item ? item : normalizeLegacyComment(item)));
  const allPrompts = formatAllCommentThreadsPrompt(threads, { locationRefs }, reviewStates);

  return [
    '\n📝 Comments from review session:',
    '='.repeat(50),
    allPrompts,
    '='.repeat(50),
    `Total comments: ${threads.length}\n`,
  ].join('\n');
}
