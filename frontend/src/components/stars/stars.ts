import { Component, computed, input } from '@angular/core';
import { Icon } from '../icon/icon';

/** A 1–5 star rating, read only. Size it with [size]. */
@Component({
  selector: 'app-stars',
  imports: [Icon],
  template: `
    @for (filled of stars(); track $index) {
      <app-icon name="star" [size]="size()" [class.filled]="filled" />
    }
  `,
  host: { role: 'img', '[attr.aria-label]': 'value() + " out of 5 stars"' },
  styles: `
    :host {
      display: inline-flex;
      gap: 1px;
      color: var(--border);
    }
    .filled {
      color: var(--doing);
      font-variation-settings: 'FILL' 1;
    }
  `,
})
export class Stars {
  readonly value = input.required<number>();
  readonly size = input(16);
  protected readonly stars = computed(() => [1, 2, 3, 4, 5].map((star) => star <= this.value()));
}
