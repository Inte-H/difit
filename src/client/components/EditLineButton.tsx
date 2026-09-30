import { Pencil } from 'lucide-react';
import React from 'react';

interface EditLineButtonProps {
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

export const EditLineButton: React.FC<EditLineButtonProps> = React.memo(({ onClick }) => {
  return (
    <button
      type="button"
      className="absolute -right-[4.5rem] top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded border border-github-accent bg-github-bg-secondary text-github-accent transition-all duration-150 hover:scale-110 z-10"
      data-edit-line-button="true"
      onMouseDown={(e) => {
        e.stopPropagation();
        if (e.shiftKey) e.preventDefault();
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      title="직접 고치기 (Shift-클릭으로 범위)"
      aria-label="줄 직접 고치기"
    >
      <Pencil className="w-4 h-4" />
    </button>
  );
});

EditLineButton.displayName = 'EditLineButton';

export function EditHunkButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="invisible absolute right-2 top-1 z-[5] flex items-center gap-1 rounded border border-github-accent bg-github-bg-secondary px-2 py-0.5 text-xs text-github-text-primary group-focus-within/hunk:visible group-hover/hunk:visible"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Pencil className="w-3 h-3" />
      hunk 고치기
    </button>
  );
}
