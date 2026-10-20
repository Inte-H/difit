import type { CommitGraphCell } from '../../utils/commitGraph';

const LANE_X = [9, 23] as const;
const MAIN_COLOR = 'var(--color-github-accent)';
const BRANCH_COLORS = [1, 2, 3].map((n) => `var(--commit-graph-branch-${n})`);
// Drawn on a 32 by 32 box stretched to the row's height.
const BRANCH_PATH = {
  fork: 'M9 0 A14 16 0 0 0 23 16 L23 32',
  through: 'M23 0 L23 32',
  join: 'M23 0 A14 16 0 0 1 9 16',
} as const;
const FORK_BELOW_PATH = 'M9 16 A14 16 0 0 1 23 32';
const STROKE_WIDTH = 2;

const branchColor = (color: number) => BRANCH_COLORS[color % BRANCH_COLORS.length];

// Fills the row's height, so the lines of rows next to each other meet.
// `bleed` is the negative margin that cancels the row's vertical padding.
export function CommitGraph({ cell, bleed }: { cell: CommitGraphCell; bleed: string }) {
  const x = LANE_X[0];
  return (
    <span className={`relative shrink-0 self-stretch ${bleed} w-[32px]`} aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full overflow-visible">
        {cell.above && (
          <line x1={x} y1="0" x2={x} y2="50%" stroke={MAIN_COLOR} strokeWidth={STROKE_WIDTH} />
        )}
        {cell.below && (
          <line x1={x} y1="50%" x2={x} y2="100%" stroke={MAIN_COLOR} strokeWidth={STROKE_WIDTH} />
        )}
        {cell.branch && (
          <svg viewBox="0 0 32 32" preserveAspectRatio="none" width="100%" height="100%">
            <path
              d={BRANCH_PATH[cell.branch.shape]}
              fill="none"
              vectorEffect="non-scaling-stroke"
              stroke={branchColor(cell.branch.color)}
              strokeWidth={STROKE_WIDTH}
            />
          </svg>
        )}
        {cell.forkBelow !== null && (
          <svg viewBox="0 0 32 32" preserveAspectRatio="none" width="100%" height="100%">
            <path
              d={FORK_BELOW_PATH}
              fill="none"
              vectorEffect="non-scaling-stroke"
              stroke={branchColor(cell.forkBelow)}
              strokeWidth={STROKE_WIDTH}
            />
          </svg>
        )}
        {cell.dot && (
          <circle
            cx={LANE_X[cell.dot.lane]}
            cy="50%"
            r={5}
            fill={cell.dot.lane === 1 && cell.branch ? branchColor(cell.branch.color) : MAIN_COLOR}
          />
        )}
      </svg>
    </span>
  );
}
