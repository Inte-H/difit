import { FloatingPortal, autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react';
import { MessageSquare, Pencil } from 'lucide-react';
import { type SyntheticEvent, useLayoutEffect } from 'react';

interface SelectionCommentBarProps {
  range: Range;
  container: HTMLElement | null;
  canHover: boolean;
  onComment: () => void;
  onEdit?: () => void;
  onPress: () => void;
}

const endOfRange = (range: Range): DOMRect => {
  const rects = range.getClientRects();
  return rects.item(rects.length - 1) ?? range.getBoundingClientRect();
};

const keepSelection = (e: SyntheticEvent) => e.preventDefault();

export function SelectionCommentBar({
  range,
  container,
  canHover,
  onComment,
  onEdit,
  onPress,
}: SelectionCommentBarProps) {
  const { refs, floatingStyles } = useFloating({
    placement: 'bottom-end',
    // Leaves room below the selection for the handles a phone draws there.
    middleware: [offset(canHover ? 6 : 28), flip(), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate,
  });

  useLayoutEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => endOfRange(range),
      contextElement: container ?? undefined,
    });
  }, [refs, range, container]);

  return (
    <FloatingPortal>
      <div
        ref={refs.setFloating}
        style={floatingStyles}
        role="toolbar"
        aria-label="고른 부분"
        className="z-[60] flex items-center gap-1 rounded-md border border-github-border bg-github-bg-secondary p-1 text-xs shadow-lg"
        onPointerDown={onPress}
        onMouseDown={keepSelection}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onComment();
          }}
          className="flex items-center gap-1.5 rounded px-2.5 py-1.5 whitespace-nowrap"
          style={{
            backgroundColor: 'var(--color-yellow-btn-bg)',
            color: 'var(--color-yellow-btn-text)',
            border: '1px solid var(--color-yellow-btn-border)',
          }}
        >
          <MessageSquare className="w-3.5 h-3.5" />
          고른 부분에 지적 달기
        </button>
        {onEdit && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            className="flex items-center gap-1.5 rounded border border-github-accent px-2.5 py-1.5 whitespace-nowrap text-github-accent"
          >
            <Pencil className="w-3.5 h-3.5" />
            직접 고치기
          </button>
        )}
      </div>
    </FloatingPortal>
  );
}
