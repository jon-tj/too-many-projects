import { Component, computed, input } from '@angular/core';

/**
 * A smiley for a mood from 0 to 10: the mouth bends from a deep frown at 0, through flat at 5, to a broad smile at 10,
 * easing between them. Null shows a faded, flat face. Size it with [size].
 */
@Component({
  selector: 'app-mood-face',
  template: `
    <svg viewBox="0 0 100 100" [attr.width]="size()" [attr.height]="size()" aria-hidden="true">
      <circle class="face" cx="50" cy="50" r="44" />
      <circle class="eye" cx="35" cy="40" r="5" />
      <circle class="eye" cx="65" cy="40" r="5" />
      <path class="mouth" [style.d]="mouth()" />
    </svg>
  `,
  host: {
    role: 'img',
    '[attr.aria-label]': 'mood() === null ? "No mood given" : "Mood " + mood() + " out of 10"',
    '[class.empty]': 'mood() === null',
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
    .face {
      fill: color-mix(in srgb, var(--doing) 30%, var(--primary-surface));
      stroke: var(--doing);
      stroke-width: 4;
    }
    .eye {
      fill: var(--primary-text);
    }
    .mouth {
      fill: none;
      stroke: var(--primary-text);
      stroke-width: 5;
      stroke-linecap: round;
      transition: d 0.25s ease;
    }
    @media (prefers-reduced-motion: reduce) {
      .mouth {
        transition: none;
      }
    }
  `,
})
export class MoodFace {
  readonly mood = input<number | null>(null);
  readonly size = input(24);

  /** A curve between the mouth's corners; its middle dips (frown) or sags (smile) by up to 22 units. */
  protected readonly mouth = computed(() => {
    const bend = ((this.mood() ?? 5) - 5) * 4.4;
    // A frown sits a little lower in the face, a smile a little higher, so both look centred.
    const corners = 68 - bend * 0.25;
    return `path("M 30 ${corners} Q 50 ${corners + bend * 2} 70 ${corners}")`;
  });
}
