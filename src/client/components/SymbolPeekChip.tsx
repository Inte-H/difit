import { Search } from 'lucide-react';

interface SymbolPeekChipProps {
  name: string;
  x: number;
  y: number;
  onOpen: () => void;
}

const CHIP_WIDTH = 220;
const CHIP_HEIGHT = 32;
const GAP = 12;

export function SymbolPeekChip({ name, x, y, onOpen }: SymbolPeekChipProps) {
  const left = Math.max(8, Math.min(x, window.innerWidth - CHIP_WIDTH));
  const fitsBelow = y + GAP + CHIP_HEIGHT <= window.innerHeight;
  const top = fitsBelow ? y + GAP : y - GAP - CHIP_HEIGHT;
  return (
    <button
      onClick={onOpen}
      style={{ left, top, height: CHIP_HEIGHT, maxWidth: CHIP_WIDTH }}
      className="fixed z-[60] flex items-center gap-1.5 rounded-md border border-github-border bg-github-bg-secondary px-2.5 py-1.5 text-xs text-github-text-primary shadow-lg transition-colors hover:bg-github-bg-tertiary"
    >
      <Search size={12} className="shrink-0" />
      <span className="truncate">
        <code className="font-mono">{name}</code> 찾기
      </span>
    </button>
  );
}
