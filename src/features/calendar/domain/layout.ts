/**
 * Side-by-side layout of overlapping events in one column (a day, or a room).
 *
 * Deterministic: the result for an event depends only on the SET of events, never on the order they
 * arrive in. Events are sorted by (start, longer first, id), clustered into groups of transitively
 * overlapping events, and packed greedily into the first free sub-column. A cluster with at most N
 * events overlapping at once uses exactly N sub-columns (optimal for interval graphs). Afterwards an
 * event may widen over free sub-columns to its right.
 */
export type LayoutItem = { id: string; startMin: number; endMin: number };

export type Placed = {
  id: string;
  /** Sub-column index, 0-based. */
  col: number;
  /** Width in sub-columns (>= 1): the event widened over free columns to its right. */
  span: number;
  /** Number of sub-columns in this event's cluster. */
  cols: number;
};

/** Events shorter than this are drawn this tall, so layout treats them as this long. */
export const MIN_VISUAL_MINUTES = 15;

type Effective = LayoutItem & { effectiveEnd: number };

const byStartThenLongerThenId = (a: Effective, b: Effective): number =>
  a.startMin - b.startMin ||
  b.effectiveEnd - a.effectiveEnd ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function layoutColumn(
  items: readonly LayoutItem[],
  minVisual = MIN_VISUAL_MINUTES,
): Placed[] {
  const sorted: Effective[] = items
    .map((i) => ({ ...i, effectiveEnd: Math.max(i.endMin, i.startMin + minVisual) }))
    .sort(byStartThenLongerThenId);

  const placed: Placed[] = [];
  let cluster: Effective[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (cluster.length === 0) return;
    const columns: number[] = []; // end of the last event in each sub-column
    const assignment = new Map<string, number>();
    for (const item of cluster) {
      let col = columns.findIndex((end) => end <= item.startMin);
      if (col === -1) {
        col = columns.length;
        columns.push(item.effectiveEnd);
      } else columns[col] = item.effectiveEnd;
      assignment.set(item.id, col);
    }
    const cols = columns.length;
    for (const item of cluster) {
      const col = assignment.get(item.id) as number;
      let span = 1;
      // Widen while the next sub-column holds nothing that overlaps this event in time.
      for (let next = col + 1; next < cols; next += 1) {
        const blocked = cluster.some(
          (o) =>
            o.id !== item.id &&
            assignment.get(o.id) === next &&
            o.startMin < item.effectiveEnd &&
            o.effectiveEnd > item.startMin,
        );
        if (blocked) break;
        span += 1;
      }
      placed.push({ id: item.id, col, span, cols });
    }
    cluster = [];
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) {
      flush(); // touching (end == start) is not an overlap
      clusterEnd = -Infinity;
    }
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.effectiveEnd);
  }
  flush();
  return placed;
}
