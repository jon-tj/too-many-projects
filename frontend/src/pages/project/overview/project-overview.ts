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
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ProjectPage } from '../project-page';
import { ProjectHours } from './project-hours/project-hours';
import { WorkReflection } from '../../../components/work-reflection/work-reflection';
import {
  WorkReflectionValues,
  OverviewPoint,
  OverviewRange,
  ProjectOverview as Overview,
  hoursFormat,
} from '../../../services/models';
import { MoneyPipe } from '../../../services/money.pipe';
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

/** Mood and resistance share one 0–10 scale, so unlike the chart above they are plotted as they are. */
const FEELINGS = [
  { key: 'mood', title: 'mood' },
  { key: 'resistance', title: 'resistance' },
] as const;
type FeelingKey = (typeof FEELINGS)[number]['key'];
const FEELINGS_HEIGHT = 160;
/** On phones the key is a row above the plot, as lines can be anywhere on this scale. */
const FEELINGS_COMPACT_TOP = 40;

const HEIGHT = 200;
/** The right gutter holds the totals; the bottom one the dates. */
const PAD = { left: 12, right: 132, top: 16, bottom: 24 };
/** Narrower than this (phones), the totals move into the plot's empty top-left corner and the plot spans the width. */
const COMPACT_WIDTH = 520;

@Component({
  selector: 'app-project-overview',
  imports: [DatePipe, DecimalPipe, MoneyPipe, ProjectHours, RouterLink, WorkReflection],
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
  /** How much each month's amount just changed, shown for a few seconds after hours change; keyed by "yyyy-MM". */
  protected readonly billingChange = signal<Record<string, number>>({});
  private lastAmounts: Record<string, number> | null = null;
  private billingChangeTimer?: ReturnType<typeof setTimeout>;
  protected readonly ranges = RANGES;
  protected readonly range = signal<OverviewRange>('30d');
  protected readonly overview = rxResource({
    params: () => ({ projectId: this.projectId(), range: this.range() }),
    stream: ({ params }) => this.api.projectOverview(params.projectId, params.range),
  });
  /** The last loaded data, kept on screen (dimmed) while a new range loads instead of flashing empty. */
  protected readonly shown = signal<Overview | null>(null);
  /** Shown when switching between working and idle failed, after the switch was undone. */
  protected readonly workError = signal('');

  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');
  protected readonly width = signal(600);
  private readonly resize = new ResizeObserver(([entry]) => this.width.set(entry.contentRect.width));
  /** The point under the crosshair. */
  protected readonly hovered = signal<number | null>(null);

  protected readonly height = HEIGHT;
  protected readonly compact = computed(() => this.width() < COMPACT_WIDTH);
  protected readonly pad = computed(() => (this.compact() ? { ...PAD, right: 12 } : PAD));
  /** Where the totals start: in the right gutter, or inside the plot at its top left, where the rising lines never are. */
  protected readonly keyOrigin = computed(() =>
    this.compact()
      ? { x: PAD.left + 4, y: PAD.top + 4 }
      : { x: this.width() - PAD.right + 16, y: PAD.top + 8 },
  );
  private readonly points = computed(() => this.shown()?.points ?? []);
  protected readonly lines = computed(() => SERIES.map((series) => this.line(series.key, series.title)));
  /**
   * Steady pace: the same amount every day, from nothing at the start to the whole total at the end. A curve above it
   * did more early on (slowing down); below it, more late (speeding up).
   */
  protected readonly steadyPace = computed(() => ({
    x1: this.pad().left,
    y1: HEIGHT - PAD.bottom,
    x2: this.pad().left + this.innerWidth(),
    y2: PAD.top,
  }));
  protected readonly feelingsHeight = FEELINGS_HEIGHT;
  protected readonly feelingsTop = computed(() => (this.compact() ? FEELINGS_COMPACT_TOP : PAD.top));
  protected readonly feelings = computed(() => FEELINGS.map((feeling, index) => this.feelingLine(feeling.key, feeling.title, index)));
  /** Whether anyone gave a mood or resistance in the period; otherwise the chart says so instead of staying blank. */
  protected readonly anyFeelings = computed(() => this.points().some((point) => point.mood !== null || point.resistance !== null));
  /** Gridlines at 0, 5 and 10, labelled at the left. */
  protected readonly feelingTicks = computed(() => [10, 5, 0].map((value) => ({ value, y: this.feelingY(value) })));
  /** Where the key's third row says what the values are. */
  protected readonly feelingsNote = computed(() =>
    this.compact() ? null : { x: this.width() - PAD.right + 16, y: PAD.top + 8 + FEELINGS.length * 24 },
  );
  protected readonly xLabels = computed(() => {
    const points = this.points();
    if (!points.length) return [];
    const indexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
    // The first and last labels are aligned inward, so they are not cut off at the chart's edges.
    const last = points.length - 1;
    return indexes.map((index) => ({
      x: this.x(index),
      date: points[index].date,
      anchor: last === 0 ? 'middle' : index === 0 ? 'start' : index === last ? 'end' : 'middle',
    }));
  });

  constructor() {
    effect(() => {
      const value = this.overview.value();
      if (value) this.shown.set(value);
    });
    // Compares each reload with the one before; the first load has nothing to compare with.
    effect(() => {
      const reports = this.billing.value();
      if (!reports) return;
      const amounts = Object.fromEntries(reports.map((report) => [report.month, report.amountWithVat ?? report.amount]));
      const previous = this.lastAmounts;
      this.lastAmounts = amounts;
      if (!previous) return;
      const changes = Object.fromEntries(
        Object.entries(amounts)
          .map(([month, amount]) => [month, Math.round((amount - (previous[month] ?? 0)) * 100) / 100])
          .filter(([, change]) => change !== 0),
      );
      if (!Object.keys(changes).length) return;
      this.billingChange.set(changes);
      clearTimeout(this.billingChangeTimer);
      this.billingChangeTimer = setTimeout(() => this.billingChange.set({}), 5000);
    });
    effect(() => {
      const frame = this.frame()?.nativeElement;
      if (frame) this.resize.observe(frame);
    });
  }

  ngOnDestroy(): void {
    this.resize.disconnect();
  }

  protected readonly invoiceError = signal('');

  /**
   * Opens the month's invoice in a new tab: its draft, made now if there is none, or the finalized invoice when the
   * month is invoiced already.
   */
  protected openInvoice(month: string): void {
    // Opened before the request, so the browser treats it as opened by the click and does not block it.
    const tab = window.open('', '_blank');
    const open = (documentId: number) => {
      const url = this.router.serializeUrl(this.router.createUrlTree(['/projects', this.projectId(), 'documents', documentId]));
      if (tab) tab.location.href = url;
      else window.location.href = url;
    };
    this.api.createDocument(this.projectId(), { type: 'invoice', month }).subscribe({
      next: (document) => open(document.id),
      error: (error) => {
        if (error.status === 409 && error.error?.documentId) {
          open(error.error.documentId);
          return;
        }
        tab?.close();
        this.invoiceError.set(error.error?.error ?? 'Could not open the invoice.');
      },
    });
  }

  private openTab(commands: unknown[]): void {
    window.open(this.router.serializeUrl(this.router.createUrlTree(commands)), '_blank');
  }

  protected readonly hoursFormat = hoursFormat;

  protected monthStart(month: string): string {
    return `${month}-01T00:00:00Z`;
  }

  private readonly hoursTable = viewChild(ProjectHours);
  /** The "How did it go?" dialog, shown when finishing work. */
  protected readonly reflecting = signal(false);

  /** Finishing work first asks how it went; starting needs no questions, and the current state is left alone. */
  protected setWorking(working: boolean): void {
    if (working === !!this.shown()?.working) return;
    if (!working) {
      this.reflecting.set(true);
      return;
    }
    this.sendWorking(working);
  }

  /** Finishes work with the answers from the dialog, or without them when skipped. */
  protected finishWork(reflection?: WorkReflectionValues): void {
    this.sendWorking(false, reflection);
  }

  /** Hours changed in the table below: the chart and the billing totals follow. */
  protected hoursChanged(): void {
    this.overview.reload();
    this.billing.reload();
  }

  protected readonly abs = Math.abs;

  /** Switches straight away, without waiting for the server, and switches back if it refuses. */
  private sendWorking(working: boolean, reflection?: WorkReflectionValues): void {
    const before = this.shown();
    this.shown.update((shown) =>
      shown ? { ...shown, working, workingSince: working ? new Date().toISOString() : null } : shown,
    );
    this.reflecting.set(false);
    this.workError.set('');
    this.api.setWorking(this.projectId(), working, reflection).subscribe({
      next: () => {
        this.overview.reload();
        this.hoursTable()?.reload();
        this.billing.reload();
      },
      error: () => {
        this.shown.set(before);
        this.workError.set(working ? 'Could not start working. Please try again.' : 'Could not stop working. Please try again.');
      },
    });
  }

  /** The crosshair snaps to the nearest point. */
  protected onPointerMove(event: PointerEvent): void {
    const count = this.points().length;
    if (count < 2) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const index = Math.round(((event.clientX - rect.left - this.pad().left) / this.innerWidth()) * (count - 1));
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

  protected feelingValue(value: number | null): string {
    return value === null ? '–' : value.toFixed(1);
  }

  protected format(key: SeriesKey, value: number): string {
    return SERIES.find((series) => series.key === key)!.format(value);
  }

  private innerWidth(): number {
    return Math.max(0, this.width() - this.pad().left - this.pad().right);
  }

  private x(index: number): number {
    const count = this.points().length;
    return count < 2 ? this.pad().left + this.innerWidth() : this.pad().left + (index / (count - 1)) * this.innerWidth();
  }

  private feelingY(value: number): number {
    const top = this.feelingsTop();
    return top + (1 - value / 10) * (FEELINGS_HEIGHT - top - PAD.bottom);
  }

  /**
   * Mood or resistance on the 0–10 scale. Days without any are gaps: the line breaks there, and a value with gaps on
   * both sides gets a dot so it still shows. The key gives the latest value.
   */
  private feelingLine(key: FeelingKey, title: string, index: number) {
    const values = this.points().map((point) => point[key]);
    const at = (i: number) => ({ x: this.x(i), y: this.feelingY(values[i] ?? 0) });
    const path = values
      .map((value, i) => (value === null ? '' : `${i && values[i - 1] !== null ? 'L' : 'M'}${at(i).x},${at(i).y}`))
      .join(' ');
    const lone = values.flatMap((value, i) =>
      value !== null && values[i - 1] == null && values[i + 1] == null ? [at(i)] : [],
    );
    const latest = [...values].reverse().find((value) => value !== null) ?? null;
    return {
      key,
      title,
      latest: this.feelingValue(latest),
      path,
      lone,
      keyAt: this.compact()
        ? { x: PAD.left + 4 + index * 120, y: 14 }
        : { x: this.width() - PAD.right + 16, y: PAD.top + 8 + index * 24 },
      hoverY: (i: number) => (values[i] == null ? null : at(i).y),
    };
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
