import React, { useEffect, useState } from 'react';

import type { DirectEditControls, DirectEditFailure } from '../contexts/FixupOverlayContext';
import { type EditRange, fetchLinesAt } from '../utils/directEdit';

interface DirectEditFormProps {
  filePath: string;
  range: EditRange;
  targetCommit: string;
  threadId?: string;
  controls: DirectEditControls;
  onClose: () => void;
}

export function DirectEditForm({
  filePath,
  range,
  targetCommit,
  threadId,
  controls,
  onClose,
}: DirectEditFormProps) {
  const [original, setOriginal] = useState<string[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failure, setFailure] = useState<DirectEditFailure | null>(null);
  const unchanged = original === null || text === original.join('\n');

  const { start, end } = range;
  useEffect(() => {
    let cancelled = false;
    setOriginal(null);
    setLoadFailed(false);
    void fetchLinesAt(filePath, targetCommit, { start, end }).then((lines) => {
      if (cancelled) return;
      if (lines) {
        setOriginal(lines);
        setText(lines.join('\n'));
      } else {
        setLoadFailed(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [filePath, targetCommit, start, end]);

  const submit = async (replacement: string[]) => {
    if (original === null || isSubmitting) return;

    setIsSubmitting(true);
    setFailure(null);
    const result = await controls.submit({
      filePath,
      startLine: range.start,
      endLine: range.end,
      original,
      replacement,
      ...(threadId === undefined ? {} : { threadId }),
    });
    setIsSubmitting(false);
    if (result) {
      setFailure(result);
      return;
    }
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (unchanged) return;
    void submit(text.split('\n'));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const lineLabel = range.start === range.end ? `L${range.start}` : `L${range.start}-L${range.end}`;

  return (
    <form
      className="m-2 mx-3 rounded-md border border-github-border border-l-4 border-l-github-accent bg-github-bg-tertiary p-3"
      onSubmit={handleSubmit}
      onClick={(e) => e.stopPropagation()}
      aria-label="직접 고치기"
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-github-text-primary">
          {filePath}:{lineLabel} 직접 고치기
        </span>
        <span className="text-xs text-github-text-secondary">
          {threadId ? '이 줄의 지적에 대한 답으로 저장합니다' : '새 스레드로 저장합니다'}
        </span>
      </div>

      {original ? (
        <textarea
          aria-label="고칠 코드"
          className="mb-2 w-full resize-y rounded border border-github-border bg-github-bg-secondary px-3 py-2 font-mono text-sm leading-5 text-github-text-primary focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30 disabled:opacity-50"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={Math.max(3, text.split('\n').length)}
          spellCheck={false}
          autoFocus
          disabled={isSubmitting}
        />
      ) : loadFailed ? (
        <p
          role="alert"
          className="mb-2 rounded border border-github-danger bg-github-danger/10 px-3 py-2 text-sm text-github-text-primary"
        >
          리뷰 대상 커밋에서 이 줄들을 읽지 못했습니다.
        </p>
      ) : (
        <p className="mb-2 text-sm text-github-text-secondary">리뷰 대상 커밋의 코드를 읽는 중…</p>
      )}

      {failure && (
        <div
          role="alert"
          className="mb-2 rounded border border-github-danger bg-github-danger/10 px-3 py-2 text-sm text-github-text-primary"
        >
          <p>{failure.message}</p>
          {failure.output && (
            <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap text-xs text-github-text-secondary">
              {failure.output}
            </pre>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-github-text-secondary">커밋 훅은 실행하지 않습니다.</span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-github-border bg-github-bg-tertiary px-3 py-1.5 text-xs text-github-text-primary transition-all hover:opacity-80 disabled:opacity-50"
            disabled={isSubmitting}
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void submit([])}
            className="rounded border border-github-danger bg-github-danger/10 px-3 py-1.5 text-xs text-github-text-primary transition-all hover:opacity-80 disabled:opacity-50"
            disabled={original === null || isSubmitting}
          >
            줄 지우기
          </button>
          <button
            type="submit"
            className="rounded border border-github-accent bg-github-accent/20 px-3 py-1.5 text-xs font-medium text-github-text-primary transition-all disabled:opacity-50"
            disabled={unchanged || isSubmitting}
          >
            {isSubmitting ? '커밋하는 중…' : 'fixup 커밋'}
          </button>
        </div>
      </div>
    </form>
  );
}
