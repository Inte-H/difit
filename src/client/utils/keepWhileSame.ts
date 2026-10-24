// Returns previous itself while next holds, index by index, items that same finds equal to it.
export function keepWhileSame<T>(
  previous: readonly T[],
  next: readonly T[],
  same: (next: T, previous: T) => boolean,
): readonly T[] {
  const kept =
    previous.length === next.length &&
    next.every((item, index) => {
      const before = previous[index];
      return before !== undefined && same(item, before);
    });
  return kept ? previous : next;
}
