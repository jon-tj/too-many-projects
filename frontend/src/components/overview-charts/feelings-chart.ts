import { DatePipe } from '@angular/common';
import { Component, ElementRef, computed, input, model, viewChild } from '@angular/core';
import { OverviewPoint, OverviewRange } from '../../services/models';
import { PAD, TimeAxis } from './time-axis';

/** Mood and resistance share one 0–10 scale, so unlike the velocity chart they are plotted as they are. */
const FEELINGS = [
  { key: 'mood', title: 'mood' },
  { key: 'resistance', title: 'resistance' },
] as const;
type FeelingKey = (typeof FEELINGS)[number]['key'];
const HEIGHT = 160;
/** On phones the key is a row above the plot, as lines can be anywhere on this scale. */
const COMPACT_TOP = 40;

/** How the work felt: the members' mood and resistance, averaged over the last five days, over time. */
@Component({
  selector: 'app-feelings-chart',
  imports: [DatePipe],
  templateUrl: './feelings-chart.html',
  styleUrl: './overview-charts.css',
})
export class FeelingsChart {
  readonly points = input.required<OverviewPoint[]>();
  readonly range = input.required<OverviewRange>();
  /** Dims the chart while new data loads. */
  readonly loading = input(false);
  /** The point under the crosshair; shared with the charts next to it, so they show the same date. */
  readonly hovered = model<number | null>(null);

  private readonly frame = viewChild<ElementRef<HTMLElement>>('frame');
  protected readonly axis = new TimeAxis(this.points, this.frame, this.hovered);
  protected readonly height = HEIGHT;
  protected readonly top = computed(() => (this.axis.compact() ? COMPACT_TOP : PAD.top));
  protected readonly lines = computed(() => FEELINGS.map((feeling, index) => this.line(feeling.key, feeling.title, index)));
  /** Whether anyone gave a mood or resistance in the period; otherwise the chart says so instead of staying blank. */
  protected readonly anyRatings = computed(() => this.points().some((point) => point.mood !== null || point.resistance !== null));
  /** Gridlines at 0, 5 and 10, labelled at the left. */
  protected readonly ticks = computed(() => [10, 5, 0].map((value) => ({ value, y: this.y(value) })));
  /** Where the key's third row says what the values are. */
  protected readonly note = computed(() =>
    this.axis.compact() ? null : { x: this.axis.width() - PAD.right + 16, y: PAD.top + 8 + FEELINGS.length * 24 },
  );

  protected hoveredPoint(): OverviewPoint | null {
    const index = this.hovered();
    return index === null ? null : (this.points()[index] ?? null);
  }

  protected value(value: number | null): string {
    return value === null ? '–' : value.toFixed(1);
  }

  private y(value: number): number {
    const top = this.top();
    return top + (1 - value / 10) * (HEIGHT - top - PAD.bottom);
  }

  /**
   * Mood or resistance on the 0–10 scale. Days without any are gaps: the line breaks there, and a value with gaps on
   * both sides gets a dot so it still shows. The key gives the latest value.
   */
  private line(key: FeelingKey, title: string, index: number) {
    const values = this.points().map((point) => point[key]);
    const at = (i: number) => ({ x: this.axis.x(i), y: this.y(values[i] ?? 0) });
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
      latest: this.value(latest),
      path,
      lone,
      keyAt: this.axis.compact()
        ? { x: PAD.left + 4 + index * 120, y: 14 }
        : { x: this.axis.width() - PAD.right + 16, y: PAD.top + 8 + index * 24 },
      hoverY: (i: number) => (values[i] == null ? null : at(i).y),
    };
  }
}
