import { DestroyRef, ElementRef, Signal, WritableSignal, computed, effect, inject, signal } from '@angular/core';
import { OverviewRange } from '../../services/models';

export const OVERVIEW_RANGES: { value: OverviewRange; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '1y', label: '1Y' },
];

/** The right gutter holds the key; the bottom one the dates. */
export const PAD = { left: 12, right: 132, top: 16, bottom: 24 };
/** Narrower than this (phones), the key moves into or above the plot and the plot spans the width. */
const COMPACT_WIDTH = 520;

/**
 * The time axis the overview charts share, so their dates line up: the chart's width (followed as it resizes), its
 * gutters, where each point sits, the date labels, and the crosshair moved by pointer or arrow keys. Made in a chart
 * component's constructor.
 */
export class TimeAxis {
  readonly width = signal(600);
  readonly compact = computed(() => this.width() < COMPACT_WIDTH);
  readonly pad = computed(() => (this.compact() ? { ...PAD, right: 12 } : PAD));
  /** The first, middle and last dates; the first and last aligned inward, so they are not cut off at the edges. */
  readonly labels = computed(() => {
    const points = this.points();
    if (!points.length) return [];
    const last = points.length - 1;
    const indexes = [...new Set([0, Math.floor(last / 2), last])];
    return indexes.map((index) => ({
      x: this.x(index),
      date: points[index].date,
      anchor: last === 0 ? 'middle' : index === 0 ? 'start' : index === last ? 'end' : 'middle',
    }));
  });

  constructor(
    private readonly points: Signal<{ date: string }[]>,
    frame: Signal<ElementRef<HTMLElement> | undefined>,
    /** The point under the crosshair. */
    private readonly hovered: WritableSignal<number | null>,
  ) {
    const resize = new ResizeObserver(([entry]) => this.width.set(entry.contentRect.width));
    effect(() => {
      const element = frame()?.nativeElement;
      if (element) resize.observe(element);
    });
    inject(DestroyRef).onDestroy(() => resize.disconnect());
  }

  innerWidth(): number {
    return Math.max(0, this.width() - this.pad().left - this.pad().right);
  }

  x(index: number): number {
    const count = this.points().length;
    return count < 2 ? this.pad().left + this.innerWidth() : this.pad().left + (index / (count - 1)) * this.innerWidth();
  }

  hoveredX(): number {
    return this.x(this.hovered() ?? 0);
  }

  /** The crosshair snaps to the nearest point. */
  pointerMove(event: PointerEvent): void {
    const count = this.points().length;
    if (count < 2) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const index = Math.round(((event.clientX - rect.left - this.pad().left) / this.innerWidth()) * (count - 1));
    this.hovered.set(Math.max(0, Math.min(count - 1, index)));
  }

  /** Arrow keys move the crosshair, so the values are reachable without a pointer. */
  keydown(event: KeyboardEvent): void {
    const count = this.points().length;
    if (!count || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
    event.preventDefault();
    const current = this.hovered() ?? count - 1;
    this.hovered.set(Math.max(0, Math.min(count - 1, current + (event.key === 'ArrowLeft' ? -1 : 1))));
  }
}
