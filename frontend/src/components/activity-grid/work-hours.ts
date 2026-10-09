/** The times of a stretch of work; a null end means it is still running. */
export interface WorkSpan {
  startedAt: string;
  endedAt: string | null;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "YYYY-MM-DD" for the date's local day. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Local midnight of the day a key names. */
export function dayFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** The local midnight after the date's day. */
function nextMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
}

/** Hours worked per local day, splitting work that crosses midnight. Running work counts up to now. */
export function hoursByDay(spans: readonly WorkSpan[], now = new Date()): Map<string, number> {
  const hours = new Map<string, number>();
  for (const span of spans) {
    let from = new Date(span.startedAt);
    const to = span.endedAt ? new Date(span.endedAt) : now;
    while (from < to) {
      const midnight = nextMidnight(from);
      const end = midnight < to ? midnight : to;
      const key = dayKey(from);
      hours.set(key, (hours.get(key) ?? 0) + (end.getTime() - from.getTime()) / 3_600_000);
      from = end;
    }
  }
  return hours;
}

/** Whether the span has any time on the day the key names. */
export function overlapsDay(span: WorkSpan, key: string, now = new Date()): boolean {
  const start = dayFromKey(key);
  const end = nextMidnight(start);
  return new Date(span.startedAt) < end && (span.endedAt ? new Date(span.endedAt) : now) > start;
}

/** "3.5 h", "45 min". */
export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  return `${Math.round(hours * 10) / 10} h`;
}
