import {
  afterNextRender,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  linkedSignal,
  numberAttribute,
  signal,
  viewChild,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { forkJoin } from 'rxjs';
import { Router, RouterLink } from '@angular/router';
import { Icon } from '../../../components/icon/icon';
import { ProjectTask, TaskPriority } from '../../../services/models';
import { WorkspaceApi } from '../../../services/workspace-api';
import { addDays, criticalPath, daysFrom, layoutRoadmap, RoadmapBar, startOfDay, workChain } from './roadmap-layout';

/** Row height, bar height and the date axis height, in pixels. */
const ROW = 34;
const BAR = 18;
const AXIS = 44;
const MIN_DAY_WIDTH = 3;
const MAX_DAY_WIDTH = 160;

/** Pan offset in pixels and zoom as the width of one day. */
interface RoadmapView {
  x: number;
  y: number;
  dayWidth: number;
}

const DEFAULT_VIEW: RoadmapView = { x: 24, y: 0, dayWidth: 32 };

/**
 * Tasks on a timeline of days since the project was created. A task starts the day after its last dependency is due
 * (tasks without dependencies from day 0) and runs to its own due date. Drag or scroll to pan, Ctrl+scroll to zoom.
 */
@Component({
  selector: 'app-project-roadmap',
  imports: [RouterLink, Icon],
  templateUrl: './project-roadmap.html',
  styleUrl: './project-roadmap.css',
})
export class ProjectRoadmap {
  readonly projectId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  protected readonly project = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.project(params),
  });
  protected readonly tasks = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) => this.api.projectTasks(params),
    defaultValue: [],
  });
  private readonly chart = viewChild.required<ElementRef<SVGSVGElement>>('chart');
  protected readonly size = signal({ width: 0, height: 0 });
  /** Your own pan and zoom per project, kept in this browser. */
  protected readonly view = linkedSignal(() => this.readStoredView(this.projectId()));

  protected readonly ROW = ROW;
  protected readonly BAR = BAR;
  protected readonly AXIS = AXIS;
  protected readonly Math = Math;

  /** Day 0: local midnight of the day the project was created. */
  private readonly origin = computed(() => {
    const project = this.project.value();
    return startOfDay(project ? new Date(project.createdAt) : new Date());
  });
  protected readonly bars = computed(() => layoutRoadmap(this.tasks.value(), this.origin()));
  protected readonly today = computed(() => daysFrom(this.origin(), new Date()));
  protected readonly error = signal('');
  protected readonly notice = signal('');
  /** The task whose due date is being dragged. */
  private readonly dragging = signal<number | null>(null);
  /** The new due date, shown beside the dragged bar's end. */
  protected readonly dragLabel = computed(() => {
    const bar = this.bars().find((candidate) => candidate.task.id === this.dragging());
    if (!bar) return null;
    return {
      x: bar.end * this.view().dayWidth + 6,
      y: bar.row * ROW + ROW / 2,
      text: addDays(this.origin(), bar.end - 1).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }),
    };
  });

  /** Dependency arrows from the end of each dependency to the start of the task waiting on it. */
  protected readonly arrows = computed(() => {
    const bars = this.bars();
    const byId = new Map(bars.map((bar) => [bar.task.id, bar]));
    return bars.flatMap((bar) =>
      bar.task.dependsOn.flatMap((id) => {
        const dependency = byId.get(id);
        if (!dependency) return [];
        return [{ key: `${id}-${bar.task.id}`, path: this.arrowPath(dependency, bar), done: dependency.task.status === 'done' }];
      }),
    );
  });

  /** The days on screen, with a day to spare on each side. */
  private readonly visibleDays = computed(() => {
    const { x, dayWidth } = this.view();
    const first = Math.floor(-x / dayWidth) - 1;
    const last = Math.ceil((this.size().width - x) / dayWidth) + 1;
    return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => {
      const day = first + index;
      return { day, date: addDays(this.origin(), day) };
    });
  });

  /** Day numbers when zoomed in, Mondays when further out, nothing when only months fit. */
  protected readonly ticks = computed(() => {
    const { dayWidth } = this.view();
    if (dayWidth < 6) return [];
    const days = this.visibleDays();
    return dayWidth >= 22 ? days : days.filter(({ date }) => date.getDay() === 1);
  });

  /** A label at each month start, and one pinned to the left edge for the month already under way. */
  protected readonly months = computed(() => {
    const { x, dayWidth } = this.view();
    const label = (date: Date) => date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    const starts = this.visibleDays().filter(({ date }) => date.getDate() === 1);
    const months = starts.map(({ day, date }) => ({ key: day, x: x + day * dayWidth + 4, label: label(date) }));
    const firstOnScreen = this.visibleDays().find(({ day }) => x + day * dayWidth >= 0);
    if (firstOnScreen && (!months.length || months[0].x > 90)) {
      months.unshift({ key: Number.MIN_SAFE_INTEGER, x: 4, label: label(firstOnScreen.date) });
    }
    return months;
  });

  /** Shaded Saturdays and Sundays, once days are wide enough to tell apart. */
  protected readonly weekends = computed(() =>
    this.view().dayWidth < 8 ? [] : this.visibleDays().filter(({ date }) => date.getDay() === 0 || date.getDay() === 6),
  );

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const element = this.chart().nativeElement;
      const observer = new ResizeObserver(() => {
        const rect = element.getBoundingClientRect();
        this.size.set({ width: rect.width, height: rect.height });
      });
      observer.observe(element);
      destroyRef.onDestroy(() => observer.disconnect());
    });
  }

  protected barTitle(bar: RoadmapBar): string {
    const format = (day: number) => addDays(this.origin(), day).toLocaleDateString();
    const range = bar.hasDue ? `${format(bar.start)} – ${format(bar.end - 1)}` : `from ${format(bar.start)}, no due date`;
    const late = bar.late ? ' · due before its dependencies are' : '';
    const blocked = bar.task.blocked ? ' · blocked' : '';
    return `${bar.task.title}\n${range}${late}${blocked}`;
  }

  /** Taps open the task; dragging a bar moves its due date, dragging elsewhere pans the view. */
  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const element = this.chart().nativeElement;
    element.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, view: this.view() };
    const taskId = this.taskIdAt(event.target);
    const bar = this.bars().find((candidate) => candidate.task.id === taskId);
    let moved = false;
    const move = (next: PointerEvent) => {
      const dx = next.clientX - start.x;
      const dy = next.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      if (bar) {
        // Snaps to whole days; a task cannot be due before the day it can start.
        const end = Math.max(bar.start + 1, bar.end + Math.round(dx / start.view.dayWidth));
        this.dragging.set(bar.task.id);
        this.setDueAt(bar.task.id, this.dueAtFor(end));
      } else {
        this.view.set({ ...start.view, x: start.view.x + dx, y: this.clampY(start.view.y + dy) });
      }
    };
    const end = () => {
      element.removeEventListener('pointermove', move);
      element.removeEventListener('pointerup', end);
      element.removeEventListener('pointercancel', end);
      this.dragging.set(null);
      if (!moved) this.openTask(taskId);
      else if (bar) this.saveDueAt(bar.task);
      else this.save();
    };
    element.addEventListener('pointermove', move);
    element.addEventListener('pointerup', end);
    element.addEventListener('pointercancel', end);
  }

  /** Scrolling pans (Shift+scroll sideways); Ctrl+scroll zooms around the pointer, like the canvas. */
  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      this.zoom(Math.exp(-event.deltaY * 0.01), event.clientX);
      return;
    }
    const dx = event.shiftKey ? event.deltaY : event.deltaX;
    const dy = event.shiftKey ? 0 : event.deltaY;
    this.view.update((view) => ({ ...view, x: view.x - dx, y: this.clampY(view.y - dy) }));
    this.save();
  }

  /** Zooms the time axis around the given screen x, or the middle of the chart. */
  protected zoom(factor: number, clientX?: number): void {
    const rect = this.chart().nativeElement.getBoundingClientRect();
    const cx = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    this.view.update((view) => {
      const dayWidth = Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, view.dayWidth * factor));
      return { ...view, x: cx - (cx - view.x) * (dayWidth / view.dayWidth), dayWidth };
    });
    this.save();
  }

  /**
   * Repaints the priorities of unfinished tasks: critical for those on the critical path; high for those starting the
   * longest chains of work (at most half of all tasks not on the critical path); low for the rest.
   * Done tasks still shape the schedule but keep their priority.
   */
  protected paintPriorities(): void {
    const bars = this.bars();
    const critical = criticalPath(bars);
    const chain = workChain(bars);
    // In roadmap order, so ties go to the task that starts first.
    const open = bars.map((bar) => bar.task).filter((task) => task.status !== 'done');
    const high = new Set(
      open
        .filter((task) => !critical.has(task.id))
        .sort((a, b) => chain.get(b.id)! - chain.get(a.id)!)
        .slice(0, Math.floor((bars.length - critical.size) / 2))
        .map((task) => task.id),
    );
    const target = (task: ProjectTask): TaskPriority =>
      critical.has(task.id) ? 'critical' : high.has(task.id) ? 'high' : 'low';
    const changes = (['critical', 'high', 'low'] as const)
      .map((priority) => ({ priority, tasks: open.filter((task) => task.priority !== priority && target(task) === priority) }))
      .filter((change) => change.tasks.length);

    this.error.set('');
    if (!changes.length) {
      this.notice.set('Priorities already match the schedule.');
      return;
    }
    const summary = changes.map((change) => `${change.tasks.length} ${change.priority}`).join(', ');
    if (!confirm(`Change priorities: ${summary}?`)) return;

    const previous = this.tasks.value();
    const updated = new Map(changes.flatMap((change) => change.tasks.map((task) => [task.id, change.priority] as const)));
    this.tasks.update((all) => all.map((task) => (updated.has(task.id) ? { ...task, priority: updated.get(task.id)! } : task)));
    this.notice.set('');
    forkJoin(
      changes.map((change) =>
        this.api.setTasksPriority(this.projectId(), change.tasks.map((task) => task.id), change.priority),
      ),
    ).subscribe({
      next: () => this.notice.set(`Priorities updated: ${summary}.`),
      error: () => {
        this.tasks.set(previous);
        this.error.set('Could not update the priorities. Please try again.');
      },
    });
  }

  /** Puts today a third of the way in. */
  protected goToToday(): void {
    this.view.update((view) => ({ ...view, x: this.size().width / 3 - this.today() * view.dayWidth }));
    this.save();
  }

  /** Zooms so every task and today fit across the chart, and scrolls to the top. */
  protected fit(): void {
    const bars = this.bars();
    const first = Math.min(0, this.today(), ...bars.map((bar) => bar.start));
    const last = Math.max(this.today() + 1, ...bars.map((bar) => bar.end));
    const dayWidth = Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, (this.size().width - 48) / (last - first)));
    this.view.set({ x: 24 - first * dayWidth, y: 0, dayWidth });
    this.save();
  }

  /** Elbow from the dependency's end down to the task's start, detouring left when the task starts right away. */
  private arrowPath(from: RoadmapBar, to: RoadmapBar): string {
    const { dayWidth } = this.view();
    const x1 = from.end * dayWidth - 2;
    const y1 = from.row * ROW + ROW / 2;
    const x2 = to.start * dayWidth;
    const y2 = to.row * ROW + ROW / 2;
    if (x2 - x1 >= 14) return `M${x1},${y1} H${x1 + 6} V${y2} H${x2}`;
    const gap = to.row * ROW;
    return `M${x1},${y1} H${x1 + 6} V${gap} H${x2 - 8} V${y2} H${x2}`;
  }

  /** Keeps the rows from scrolling away entirely. */
  private clampY(y: number): number {
    const content = this.bars().length * ROW;
    const room = this.size().height - AXIS - 24;
    return Math.min(0, Math.max(Math.min(0, room - content), y));
  }

  private taskIdAt(target: EventTarget | null): number | null {
    const id = (target as Element | null)?.closest('[data-task]')?.getAttribute('data-task');
    return id ? Number(id) : null;
  }

  private openTask(taskId: number | null): void {
    if (taskId !== null) void this.router.navigate(['/projects', this.projectId(), 'tasks', taskId]);
  }

  /** The due date for a bar ending at the given day, saved like the task form does: UTC midnight of that date. */
  private dueAtFor(end: number): string {
    return new Date(addDays(this.origin(), end - 1).toLocaleDateString('sv-SE')).toISOString();
  }

  /** Changes the due date locally, so the bar and everything waiting on it move while dragging. */
  private setDueAt(taskId: number, dueAt: string | null): void {
    this.tasks.update((tasks) => tasks.map((task) => (task.id === taskId ? { ...task, dueAt } : task)));
  }

  /** Saves the dragged due date; puts the old one back if the server refuses. */
  private saveDueAt(original: ProjectTask): void {
    const task = this.tasks.value().find((candidate) => candidate.id === original.id);
    if (!task || task.dueAt === original.dueAt) return;
    this.error.set('');
    this.api.updateTask(task).subscribe({
      error: () => {
        this.setDueAt(original.id, original.dueAt);
        this.error.set('Could not change the due date. Please try again.');
      },
    });
  }

  private readStoredView(projectId: number): RoadmapView {
    try {
      const stored = JSON.parse(localStorage.getItem(`roadmap-view:${projectId}`) ?? 'null');
      return stored && typeof stored.dayWidth === 'number' ? stored : DEFAULT_VIEW;
    } catch {
      return DEFAULT_VIEW;
    }
  }

  private save(): void {
    try {
      localStorage.setItem(`roadmap-view:${this.projectId()}`, JSON.stringify(this.view()));
    } catch {
      // Storage can be unavailable (e.g. private windows); the view then lasts until reload.
    }
  }
}
