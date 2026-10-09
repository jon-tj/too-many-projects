import { PRIORITY_RANK, ProjectTask } from '../../../services/models';

/** A task placed on the roadmap, in whole days counted from the day the project was created. */
export interface RoadmapBar {
  task: ProjectTask;
  row: number;
  /** The first day the task can be worked on: the day after its last dependency is due, or day 0 without dependencies. */
  start: number;
  /** The day after its last day. */
  end: number;
  /** False when the task has no due date; it is then drawn one day long. */
  hasDue: boolean;
  /** Due on or before the day it can start; drawn one day long and flagged. */
  late: boolean;
}

const DAY_MS = 86_400_000;

/** Local midnight of the date. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Whole days from origin (a local midnight) to the date's day; rounding absorbs daylight saving shifts. */
export function daysFrom(origin: Date, date: Date): number {
  return Math.round((startOfDay(date).getTime() - origin.getTime()) / DAY_MS);
}

/** Due dates are saved as UTC midnight of the chosen day, so the calendar day is the date part. */
export function dueDay(dueAt: string): Date {
  const [year, month, day] = dueAt.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Ids of the tasks with no float: the latest each may end without pushing back the last due date is its own end.
 * Works backwards from the last due date: a task must end by the time every task waiting on it has to start.
 */
export function criticalPath(bars: RoadmapBar[]): Set<number> {
  if (!bars.length) return new Set();
  const finish = Math.max(...bars.map((bar) => bar.end));
  const latestEnd = new Map<number, number>();
  // Bars are ordered by start and a task starts after its dependencies end, so walking backwards
  // reaches every task before the tasks it depends on.
  for (const bar of [...bars].reverse()) {
    const latestStart = (latestEnd.get(bar.task.id) ?? finish) - (bar.end - bar.start);
    for (const id of bar.task.dependsOn) latestEnd.set(id, Math.min(latestEnd.get(id) ?? finish, latestStart));
  }
  return new Set(bars.filter((bar) => (latestEnd.get(bar.task.id) ?? finish) === bar.end).map((bar) => bar.task.id));
}

/**
 * For each task: the length in days of the longest chain of work it starts, from its own start to the end of the last
 * task waiting on it directly or through others (or its own end when nothing waits on it). Long chains give their
 * first tasks the most, and a long task on its own counts its own length.
 */
export function workChain(bars: RoadmapBar[]): Map<number, number> {
  const reach = new Map<number, number>();
  // Walking backwards reaches every task before the tasks it depends on, so a task's reach is complete when visited.
  for (const bar of [...bars].reverse()) {
    const end = Math.max(bar.end, reach.get(bar.task.id) ?? bar.end);
    reach.set(bar.task.id, end);
    for (const id of bar.task.dependsOn) reach.set(id, Math.max(reach.get(id) ?? end, end));
  }
  return new Map(bars.map((bar) => [bar.task.id, reach.get(bar.task.id)! - bar.start]));
}

/**
 * Places every task: it starts right after its last dependency is due (or on day 0 without dependencies)
 * and runs until its own due date. One task per row, ordered by start so dependencies sit above their dependents.
 */
export function layoutRoadmap(tasks: ProjectTask[], origin: Date): RoadmapBar[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const placed = new Map<number, Omit<RoadmapBar, 'row'>>();
  const place = (task: ProjectTask, visiting: Set<number>): Omit<RoadmapBar, 'row'> => {
    const known = placed.get(task.id);
    if (known) return known;
    visiting.add(task.id);
    let start = 0;
    for (const id of task.dependsOn) {
      const dependency = byId.get(id);
      // The server refuses loops; skipping tasks already on the path keeps a bad state from recursing forever.
      if (dependency && !visiting.has(id)) start = Math.max(start, place(dependency, visiting).end);
    }
    visiting.delete(task.id);
    const end = task.dueAt ? daysFrom(origin, dueDay(task.dueAt)) + 1 : null;
    const late = end !== null && end <= start;
    const bar = { task, start, end: end !== null && !late ? end : start + 1, hasDue: end !== null, late };
    placed.set(task.id, bar);
    return bar;
  };
  return tasks
    .map((task) => place(task, new Set()))
    .sort(
      (a, b) =>
        a.start - b.start ||
        a.end - b.end ||
        PRIORITY_RANK[b.task.priority] - PRIORITY_RANK[a.task.priority] ||
        a.task.id - b.task.id,
    )
    .map((bar, row) => ({ ...bar, row }));
}
