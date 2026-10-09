import { afterNextRender, afterRenderEffect, Component, computed, ElementRef, input, model, viewChild } from '@angular/core';
import { dayKey, formatHours } from './work-hours';

interface DayCell {
  key: string;
  date: Date;
  hours: number;
  /** 0 for nothing logged, then 1–4 by hours worked. */
  level: number;
}

/** Hours at which a day reaches levels 1–4. */
const LEVELS = [0, 2, 4, 6];

/** The Monday that starts the first column of a grid with the given number of weeks, ending with this week. */
export function gridStart(weeks: number, today = new Date()): Date {
  const mondayOffset = (today.getDay() + 6) % 7;
  return new Date(today.getFullYear(), today.getMonth(), today.getDate() - mondayOffset - (weeks - 1) * 7);
}

/**
 * GitHub-style grid of hours worked per day: one column per week (Monday on top), the latest week on the right.
 * Purely visual: give it hours per day key ("YYYY-MM-DD"), and bind `selected` to know which day was clicked.
 * Projected content is shown in the footer, to the left of the legend.
 */
@Component({
  selector: 'app-activity-grid',
  templateUrl: './activity-grid.html',
  styleUrl: './activity-grid.css',
})
export class ActivityGrid {
  readonly hours = input.required<ReadonlyMap<string, number>>();
  readonly weeks = input(53);
  /** The clicked day's key, or null. */
  readonly selected = model<string | null>(null);
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  protected readonly LEVELS = [0, 1, 2, 3, 4];
  protected readonly WEEKDAYS = [
    { row: 0, label: 'Mon' },
    { row: 2, label: 'Wed' },
    { row: 4, label: 'Fri' },
  ];

  /** Columns of seven days; days after today are left out. */
  protected readonly columns = computed(() => {
    const hours = this.hours();
    const today = new Date();
    const start = gridStart(this.weeks(), today);
    return Array.from({ length: this.weeks() }, (_, week) =>
      Array.from({ length: 7 }, (_, weekday): DayCell | null => {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + weekday);
        if (date > today) return null;
        const key = dayKey(date);
        const worked = hours.get(key) ?? 0;
        const level = worked <= 0 ? 0 : LEVELS.filter((threshold) => worked >= threshold).length;
        return { key, date, hours: worked, level };
      }),
    );
  });

  /** A month name over the first week that contains its 1st, skipping ones too close to the previous label. */
  protected readonly months = computed(() => {
    const labels: { column: number; text: string }[] = [];
    this.columns().forEach((days, column) => {
      const first = days.find((day) => day?.date.getDate() === 1) ?? (column === 0 ? days[0] : null);
      if (!first || (labels.length && column - labels[labels.length - 1].column < 3)) return;
      labels.push({ column, text: first.date.toLocaleDateString(undefined, { month: 'short' }) });
    });
    return labels;
  });

  constructor() {
    // Start scrolled to the latest weeks when the grid is wider than its container.
    afterNextRender(() => {
      const element = this.scroller().nativeElement;
      element.scrollLeft = element.scrollWidth;
    });
    // Keep the selected day in view when it changes, e.g. jumping to today after scrolling back.
    afterRenderEffect(() => {
      this.selected();
      this.scroller()
        .nativeElement.querySelector('.cell.selected')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
  }

  protected label(day: DayCell): string {
    const date = day.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    return day.hours > 0 ? `${formatHours(day.hours)} on ${date}` : `Nothing logged on ${date}`;
  }
}
