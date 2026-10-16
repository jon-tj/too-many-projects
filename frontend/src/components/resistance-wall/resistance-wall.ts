import { Component, computed, input } from '@angular/core';

const MAX_ROWS = 10;
/** One brick and the mortar around it, in viewBox units. */
const BRICK = { width: 40, height: 16, gap: 3 };
const WIDTH = BRICK.width * 2 + BRICK.gap;
const HALF = (BRICK.width - BRICK.gap) / 2;
const HEIGHT = MAX_ROWS * (BRICK.height + BRICK.gap);

/**
 * Bricks in each row, two bricks wide and interwoven like a real wall: even rows hold two whole bricks, odd rows a half,
 * a whole and a half, so every joint sits over the middle of a brick below.
 */
const ROWS = Array.from({ length: MAX_ROWS }, (_, row) => {
  const y = HEIGHT - (row + 1) * (BRICK.height + BRICK.gap) + BRICK.gap;
  const spans =
    row % 2 === 0
      ? [[0, BRICK.width], [BRICK.width + BRICK.gap, BRICK.width]]
      : [[0, HALF], [HALF + BRICK.gap, BRICK.width], [HALF + BRICK.width + BRICK.gap * 2, HALF]];
  return spans.map(([x, width]) => ({ x, y, width, height: BRICK.height }));
});

/**
 * A wall as tall as the resistance, 0 to 10 rows of bricks, built from the ground up: rows drop into place as it rises
 * and lift away as it falls. Null shows a faded, empty plot. Size it with [height].
 */
@Component({
  selector: 'app-resistance-wall',
  template: `
    <svg [attr.viewBox]="viewBox" [attr.height]="height()" [attr.width]="height() * aspect" aria-hidden="true">
      @for (row of rows; track $index) {
        <g class="row" [class.built]="$index < built()">
          @for (brick of row; track $index) {
            <rect [attr.x]="brick.x" [attr.y]="brick.y" [attr.width]="brick.width" [attr.height]="brick.height" rx="2" />
          }
        </g>
      }
      <line class="ground" x1="-4" [attr.x2]="width + 4" [attr.y1]="groundY" [attr.y2]="groundY" />
    </svg>
  `,
  host: {
    role: 'img',
    '[attr.aria-label]': 'resistance() === null ? "No resistance given" : "Resistance " + resistance() + " out of 10"',
    '[class.empty]': 'resistance() === null',
  },
  styles: `
    :host {
      display: inline-block;
      line-height: 0;
    }
    :host(.empty) {
      opacity: 0.35;
    }
    svg {
      overflow: visible;
    }
    .row {
      opacity: 0;
      transform: translateY(-12px);
      transition:
        opacity 0.18s ease,
        transform 0.18s ease;
    }
    .row.built {
      opacity: 1;
      transform: none;
    }
    rect {
      fill: var(--priority-high);
    }
    .ground {
      stroke: var(--secondary-surface);
      stroke-width: 3;
      stroke-linecap: round;
    }
    @media (prefers-reduced-motion: reduce) {
      .row {
        transition: none;
      }
    }
  `,
})
export class ResistanceWall {
  readonly resistance = input<number | null>(null);
  readonly height = input(24);
  protected readonly rows = ROWS;
  protected readonly width = WIDTH;
  protected readonly groundY = HEIGHT + 1.5;
  protected readonly viewBox = `0 0 ${WIDTH} ${HEIGHT + 3}`;
  protected readonly aspect = WIDTH / (HEIGHT + 3);
  protected readonly built = computed(() => this.resistance() ?? 0);
}
