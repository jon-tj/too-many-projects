import { DatePipe, DecimalPipe } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  computed,
  effect,
  inject,
  input,
  numberAttribute,
  signal,
  viewChild,
} from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ProjectPage } from '../project-page';
import { OverviewPoint, OverviewRange, ProjectOverview as Overview } from '../../../services/models';
import { WorkspaceApi } from '../../../services/workspace-api';

const RANGES: { value: OverviewRange; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '1y', label: '1Y' },
];

/**
 * Both measures share one plot, each indexed to its own total for the period (0–100%), so the chart shows
 * the shape of the curves rather than comparing hours with tasks. Real totals are listed at the right.
 */
const SERIES = [
  { key: 'tasksCompleted', title: 'tasks done', format: (value: number) => String(value) },
  { key: 'hours', title: 'hours worked', format: (value: number) => value.toFixed(1) },
] as const;
type SeriesKey = (typeof SERIES)[number]['key'];

const HEIGHT = 200;
/** The right gutter holds the totals; the bottom one the dates. */
const PAD = { left: 12, right: 132, top: 16, bottom: 24 };

@Component({
  selector: 'app-project-overview',
  imports: [DatePipe, DecimalPipe],
  templateUrl: './project-overview.html',
  styleUrl: './project-overview.css',
})
export class ProjectOverview implements OnDestroy {
  readonly projectId = input.required({ transform: numberAttribute });
  private readonly api = inject(WorkspaceApi);
  private readonly router = inject(Router);
  private readonly project = inject(ProjectPage).project;
  /** "yyyy-MM" for this month and last month (UTC, like the report). */
  protected readonly months = (() => {
    const now = new Date();
    const month = (offset: number) =>
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1)).toISOString().slice(0, 7);
    return [month(0), month(1)];
  })();
  /** Billing is for owners of billing-enabled projects only. */
  protected readonly billing = rxResource({
    params: () => {
      const project = this.project.value();
      return project?.billingEnabled && project.myRole === 'Owner' ? project.id : undefined;
    },
    stream: ({ params }) => forkJoin(this.months.map((month) => this.api.billingReport(params, month))),
  });
  protected readonly ranges = RANGES;
  protected readonly range = signal<OverviewRange>('30d');
  protected readonly overview = rxResource({
    params: () => ({ projectId: this.projectId(), range: this.range() }),
    stream: ({ params }) => this.api.projectOverview(params.projectId, params.range),
  });
  /** The last loaded data, kept on screen (dimmed) while a new range loads instead of flashing empty. */
  protected readonly shown = signal<Overview | null>(null);
  protected readonly busy = signal(false);

  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');
  protected readonly width = signal(600);
  private readonly resize = new ResizeObserver(([entry]) => this.width.set(entry.contentRect.width));
  /** The point under the crosshair. */
  protected readonly hovered = signal<number | null>(null);

  protected readonly height = HEIGHT;
  protected readonly pad = PAD;
  private readonly points = computed(() => this.shown()?.points ?? []);
  protected readonly lines = computed(() => SERIES.map((series) => this.line(series.key, series.title)));
  /** Halfway through the period at half the total: a curve above it is slowing down, below it speeding up. */
  protected readonly center = computed(() => ({
    x: PAD.left + this.innerWidth() / 2,
    y: PAD.top + (HEIGHT - PAD.top - PAD.bottom) / 2,
  }));
  protected readonly xLabels = computed(() => {
    const points = this.points();
    if (!points.length) return [];
    const indexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    return indexes.map((index) => ({ x: this.x(index), date: points[index].date }));
  });

  constructor() {
    effect(() => {
      const value = this.overview.value();
      if (value) this.shown.set(value);
    });
    effect(() => {
      const frame = this.frame()?.nativeElement;
      if (frame) this.resize.observe(frame);
    });
  }

  ngOnDestroy(): void {
    this.resize.disconnect();
  }

  /** Opens the printable report in a new tab. */
  protected openReport(month: string): void {
    window.open(this.router.serializeUrl(this.router.createUrlTree(['/report', this.projectId(), month])), '_blank');
  }

  protected monthStart(month: string): string {
    return `${month}-01T00:00:00Z`;
  }

  protected setWorking(working: boolean): void {
    this.busy.set(true);
    this.api.setWorking(this.projectId(), working).subscribe({
      next: () => {
        this.busy.set(false);
        this.overview.reload();
      },
      error: () => this.busy.set(false),
    });
  }

  /** The crosshair snaps to the nearest point. */
  protected onPointerMove(event: PointerEvent): void {
    const count = this.points().length;
    if (count < 2) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const index = Math.round(((event.clientX - rect.left - PAD.left) / this.innerWidth()) * (count - 1));
    this.hovered.set(Math.max(0, Math.min(count - 1, index)));
  }

  /** Arrow keys move the crosshair, so the values are reachable without a pointer. */
  protected onKeydown(event: KeyboardEvent): void {
    const count = this.points().length;
    if (!count || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const current = this.hovered() ?? count - 1;
    this.hovered.set(Math.max(0, Math.min(count - 1, current + (event.key === 'ArrowLeft' ? -1 : 1))));
  }

  protected hoveredPoint(): OverviewPoint | null {
    const index = this.hovered();
    return index === null ? null : (this.points()[index] ?? null);
  }

  protected hoveredX(): number {
    return this.x(this.hovered() ?? 0);
  }

  protected format(key: SeriesKey, value: number): string {
    return SERIES.find((series) => series.key === key)!.format(value);
  }

  private innerWidth(): number {
    return Math.max(0, this.width() - PAD.left - PAD.right);
  }

  private x(index: number): number {
    const count = this.points().length;
    return count < 2 ? PAD.left + this.innerWidth() : PAD.left + (index / (count - 1)) * this.innerWidth();
  }

  /** One series as a share of its period total; flat along the bottom while the total is still 0. */
  private line(key: SeriesKey, title: string) {
    const values = this.points().map((point) => point[key]);
    const total = values.at(-1) ?? 0;
    const y = (value: number) =>
      PAD.top + (1 - (total > 0 ? value / total : 0)) * (HEIGHT - PAD.top - PAD.bottom);
    const last = values.length - 1;
    return {
      key,
      title,
      total: this.format(key, total),
      path: values.map((value, index) => `${index ? 'L' : 'M'}${this.x(index)},${y(value)}`).join(' '),
      end: last < 0 ? null : { x: this.x(last), y: y(values[last]) },
      hoverY: (index: number) => y(values[index] ?? 0),
    };
  }
}
