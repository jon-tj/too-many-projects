import { Component, computed, input } from '@angular/core';

/** A person's profile picture, or the first letter of their name. Size it from the parent. */
@Component({
  selector: 'app-avatar',
  template: `
    @if (image()) {
      <img [src]="image()" alt="" />
    } @else {
      {{ initial() }}
    }
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
      overflow: hidden;
      color: var(--secondary-text);
      background: var(--secondary-surface);
      border-radius: 50%;
      font-weight: 700;
    }
    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly image = input<string | null | undefined>(null);
  protected readonly initial = computed(() => this.name().charAt(0).toUpperCase());
}
