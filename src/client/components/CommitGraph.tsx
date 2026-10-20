import type { CommitGraphCell, CommitGraphStroke } from '../../utils/commitGraph';

const LANE_X = [9, 23] as const;
const LIT = 'var(--color-github-accent)';
const DIM_LINE = 'var(--color-github-border)';
const DIM_DOT = 'var(--color-github-text-secondary)';
// Drawn on a 32 by 32 box stretched to the row's height.
const BRANCH_PATH = {
  fork: 'M9 0 C9 9 23 7 23 16 L23 32',
  through: 'M23 0 L23 32',
  join: 'M23 0 C23 9 9 7 9 16',
} as const;

function strokeOf(stroke: CommitGraphStroke) {
  return stroke === 'lit' ? { stroke: LIT, strokeWidth: 3 } : { stroke: DIM_LINE, strokeWidth: 2 };
}

// Fills the row's height, so the lines of rows next to each other meet.
export function CommitGraph({ cell }: { cell: CommitGraphCell }) {
  const x = LANE_X[0];
  return (
    <span className="relative shrink-0 self-stretch -my-1.5 w-8" aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {cell.above && <line x1={x} y1="0" x2={x} y2="50%" {...strokeOf(cell.above)} />}
        {cell.below && <line x1={x} y1="50%" x2={x} y2="100%" {...strokeOf(cell.below)} />}
        {cell.branch && (
          <svg viewBox="0 0 32 32" preserveAspectRatio="none" width="100%" height="100%">
            <path
              d={BRANCH_PATH[cell.branch.shape]}
              fill="none"
              vectorEffect="non-scaling-stroke"
              {...strokeOf(cell.branch.lit ? 'lit' : 'dim')}
            />
          </svg>
        )}
        {cell.dot && (
          <circle
            data-lit={cell.dot.lit ? '' : undefined}
            cx={LANE_X[cell.dot.lane]}
            cy="50%"
            r={cell.dot.lane === 0 ? 5 : 3.5}
            fill={cell.dot.lit ? LIT : 'var(--color-github-bg-secondary)'}
            stroke={cell.dot.lit ? LIT : DIM_DOT}
            strokeWidth={2}
          />
        )}
      </svg>
    </span>
  );
}
