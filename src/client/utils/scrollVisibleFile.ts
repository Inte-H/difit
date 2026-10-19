// Jumping to a file scrolls to a fractional rect top, which can land just short of it.
const TOP_EDGE_TOLERANCE_PX = 1;

export function findScrollVisibleFileIndex(
  scrollTop: number,
  fileTops: readonly number[],
): number | null {
  if (fileTops.length === 0) return null;

  let visibleIndex = 0;
  fileTops.forEach((top, index) => {
    if (Number.isFinite(top) && top <= scrollTop + TOP_EDGE_TOLERANCE_PX) {
      visibleIndex = index;
    }
  });
  return visibleIndex;
}
