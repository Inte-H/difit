import { ArrowUpCircle } from 'lucide-react';

import type { NewerTarget } from '../../types/diff';

interface NewerTargetButtonProps {
  newerTarget: NewerTarget | undefined;
  onReopen: (commit: string) => void;
  compact?: boolean;
}

export function NewerTargetButton({
  newerTarget,
  onReopen,
  compact = false,
}: NewerTargetButtonProps) {
  if (!newerTarget) {
    return null;
  }

  const { ref, commit, commitCount } = newerTarget;
  const label = `${ref}에 새 커밋 ${commitCount}개 · 다시 열기`;
  return (
    <button
      type="button"
      onClick={() => onReopen(commit)}
      className={`flex items-center gap-1.5 text-xs rounded-md border bg-github-text-primary text-github-bg-primary border-github-text-primary ${
        compact ? 'px-2 py-2' : 'px-3 py-1.5'
      }`}
      title={`${commit.slice(0, 7)}로 리뷰를 다시 연다`}
      aria-label={compact ? label : undefined}
    >
      <ArrowUpCircle size={12} />
      {compact ? <span className="sr-only">{label}</span> : label}
    </button>
  );
}
