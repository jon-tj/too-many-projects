import { DatePipe } from '@angular/common';
import { Component, ElementRef, computed, input, model, viewChild } from '@angular/core';
import { OverviewPoint, OverviewRange } from '../../services/models';
import { PAD, TimeAxis } from './time-axis';

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

/** Tasks done and hours worked over time (cumulative), with a steady pace line to compare them with. */
@Component({
  selector: 'app-velocity-chart',
  imports: [DatePipe],
  templateUrl: './velocity-chart.html',
  styleUrl: './overview-charts.css',
})
export class VelocityChart {
  readonly points = input.required<OverviewPoint[]>();
  readonly range = input.required<OverviewRange>();
  /** Dims the chart while new data loads. */
  readonly loading = input(false);
  /** The point under the crosshair; shared with the charts next to it, so they show the same date. */
  readonly hovered = model<number | null>(null);

  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');
  protected readonly axis = new TimeAxis(this.points, this.frame, this.hovered);
  protected readonly height = HEIGHT;
  /** Where the totals start: in the right gutter, or inside the plot at its top left, where the rising lines never are. */
  protected readonly keyOrigin = computed(() =>
    this.axis.compact()
      ? { x: PAD.left + 4, y: PAD.top + 4 }
      : { x: this.axis.width() - PAD.right + 16, y: PAD.top + 8 },
  );
  protected readonly lines = computed(() => SERIES.map((series) => this.line(series.key, series.title)));
  /**
   * Steady pace: the same amount every day, from nothing at the start to the whole total at the end. A curve above it
   * did more early on (slowing down); below it, more late (speeding up).
   */
  protected readonly steadyPace = computed(() => ({
    x1: this.axis.pad().left,
    y1: HEIGHT - PAD.bottom,
    x2: this.axis.pad().left + this.axis.innerWidth(),
    y2: PAD.top,
  }));

  protected hoveredPoint(): OverviewPoint | null {
    const index = this.hovered();
    return index === null ? null : (this.points()[index] ?? null);
  }

  protected format(key: SeriesKey, value: number): string {
    return SERIES.find((series) => series.key === key)!.format(value);
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
      path: values.map((value, index) => `${index ? 'L' : 'M'}${this.axis.x(index)},${y(value)}`).join(' '),
      end: last < 0 ? null : { x: this.axis.x(last), y: y(values[last]) },
      hoverY: (index: number) => y(values[index] ?? 0),
    };
  }
}
