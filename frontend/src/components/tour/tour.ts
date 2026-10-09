import { Component, computed, effect, input, output, signal } from '@angular/core';

/** One stop on a tour: the element to point at and what to say about it. */
export interface TourStep {
  target: HTMLElement;
  title: string;
  text: string;
}

const CARD_WIDTH = 280;
const GAP = 14;
const RING_PADDING = 6;

/**
 * Walks through steps one at a time: dims the page, rings the step's element and explains it in a card beside it.
 * The page cannot be clicked while it is open. Emits `done` when finished or skipped (Escape skips too).
 */
@Component({
  selector: 'app-tour',
  templateUrl: './tour.html',
  styleUrl: './tour.css',
  host: {
    '(window:resize)': 'measure()',
    '(window:scroll)': 'measure()',
    '(document:keydown.escape)': 'finish()',
  },
})
export class Tour {
  readonly steps = input.required<TourStep[]>();
  readonly done = output<void>();
  protected readonly index = signal(0);
  protected readonly step = computed(() => this.steps()[this.index()]);
  protected readonly last = computed(() => this.index() === this.steps().length - 1);
  private readonly rect = signal<DOMRect | null>(null);

  protected readonly ring = computed(() => {
    const rect = this.rect();
    if (!rect) return null;
    return {
      top: rect.top - RING_PADDING,
      left: rect.left - RING_PADDING,
      width: rect.width + RING_PADDING * 2,
      height: rect.height + RING_PADDING * 2,
    };
  });

  /** Beside the element when there is room on the right, otherwise below it; always kept on screen. */
  protected readonly card = computed(() => {
    const rect = this.rect();
    if (!rect) return null;
    const fitsRight = rect.right + GAP + CARD_WIDTH <= window.innerWidth - 8;
    const left = fitsRight ? rect.right + GAP : rect.left;
    const top = fitsRight ? rect.top - 8 : rect.bottom + GAP;
    return {
      left: Math.max(8, Math.min(left, window.innerWidth - CARD_WIDTH - 8)),
      top: Math.max(8, top),
      width: CARD_WIDTH,
    };
  });

  constructor() {
    effect(() => {
      const step = this.step();
      step?.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      this.measure();
    });
  }

  protected measure(): void {
    this.rect.set(this.step()?.target.getBoundingClientRect() ?? null);
  }

  protected next(): void {
    if (this.last()) this.finish();
    else this.index.update((index) => index + 1);
  }

  protected back(): void {
    this.index.update((index) => Math.max(0, index - 1));
  }

  protected finish(): void {
    this.done.emit();
  }
}
