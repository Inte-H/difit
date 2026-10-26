import React, { useEffect, useState } from 'react';

import type { RewordRequest } from '../../types/diff';
import type { DirectEditFailure } from '../contexts/FixupOverlayContext';

export interface RewordControls {
  // The message the review shows for the commit; null when it could not be read.
  load: (sha: string) => Promise<string | null>;
  save: (request: RewordRequest) => Promise<DirectEditFailure | null>;
}

interface CommitMessageFormProps {
  sha: string;
  controls: RewordControls;
  onClose: () => void;
}

export function CommitMessageForm({ sha, controls, onClose }: CommitMessageFormProps) {
  const [original, setOriginal] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [failure, setFailure] = useState<DirectEditFailure | null>(null);
  const unchanged = original === null || text === original;

  const { load } = controls;
  useEffect(() => {
    let cancelled = false;
    setOriginal(null);
    setLoadFailed(false);
    void load(sha).then((message) => {
      if (cancelled) return;
      if (message === null) {
        setLoadFailed(true);
        return;
      }
      setOriginal(message);
      setText(message);
    });
    return () => {
      cancelled = true;
    };
  }, [load, sha]);

  const save = async () => {
    if (original === null || unchanged || isSaving) return;
    setIsSaving(true);
    setFailure(null);
    const result = await controls.save({
      commit: sha,
      original,
      message: text,
    });
    setIsSaving(false);
    if (result) {
      setFailure(result);
      return;
    }
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void save();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <form
      className="mx-3 my-1 rounded-md border border-github-border border-l-4 border-l-github-accent bg-github-bg-tertiary p-2 select-text"
      onSubmit={handleSubmit}
      aria-label="커밋 메시지 고치기"
    >
      {original !== null ? (
        <textarea
          aria-label="커밋 메시지"
          className="mb-2 w-full resize-y rounded border border-github-border bg-github-bg-secondary px-2 py-1.5 font-mono text-xs leading-5 text-github-text-primary focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30 disabled:opacity-50"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={Math.min(12, Math.max(3, text.split('\n').length))}
          spellCheck={false}
          autoFocus
          disabled={isSaving}
        />
      ) : loadFailed ? (
        <p
          role="alert"
          className="mb-2 rounded border border-github-danger bg-github-danger/10 px-2 py-1.5 text-xs text-github-text-primary"
        >
          이 커밋의 메시지를 읽지 못했습니다.
        </p>
      ) : (
        <p className="mb-2 text-xs text-github-text-secondary">메시지를 읽는 중…</p>
      )}

      {failure && (
        <div
          role="alert"
          className="mb-2 rounded border border-github-danger bg-github-danger/10 px-2 py-1.5 text-xs text-github-text-primary"
        >
          <p>{failure.message}</p>
          {failure.output && (
            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-github-text-secondary">
              {failure.output}
            </pre>
          )}
        </div>
      )}

      <p className="mb-2 text-xs text-github-text-secondary">
        저장하면 이 커밋의 메시지만 바꾸는 amend! 커밋이 만들어지고, 마무리 때 접힙니다.
      </p>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-github-border bg-github-bg-tertiary px-3 py-1 text-xs text-github-text-primary transition-all hover:opacity-80 disabled:opacity-50"
          disabled={isSaving}
        >
          취소
        </button>
        <button
          type="submit"
          className="rounded border border-github-accent bg-github-accent/20 px-3 py-1 text-xs font-medium text-github-text-primary transition-all disabled:opacity-50"
          disabled={unchanged || isSaving}
        >
          {isSaving ? '저장하는 중…' : '저장'}
        </button>
      </div>
    </form>
  );
}
