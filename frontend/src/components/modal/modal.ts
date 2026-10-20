import { Component, DestroyRef, ElementRef, effect, inject, input, model, viewChild } from '@angular/core';
import { Icon } from '../icon/icon';

/** Native <dialog> wrapper: `<app-modal heading="..." [(open)]="signal">content</app-modal>`. */
@Component({
  selector: 'app-modal',
  imports: [Icon],
  template: `
    <dialog #dialog [style.width]="'min(100% - 32px, ' + width() + 'px)'" (close)="open.set(false)" (click)="closeOnBackdrop($event)">
      <div>
        <header>
          <h2>{{ heading() }}</h2>
          <button class="transparent" type="button" aria-label="Close" (click)="open.set(false)">
            <app-icon name="close" />
          </button>
        </header>
        <ng-content />
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(100% - 32px, 440px);
      padding: 0;
      color: inherit;
      background: var(--primary-surface);
      border: 1px solid var(--border);
      border-radius: 6px;
    }
    dialog::backdrop {
      background: rgb(0 0 0 / 0.3);
    }
    div {
      padding: 24px;
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }
    h2 {
      margin: 0;
      font-size: 18px;
    }
    /*
     * Phones: kept within the part of the screen the on-screen keyboard leaves visible (see fitToVisibleArea), at its
     * top, scrolling inside itself; so the buttons at the bottom of a form stay reachable while typing.
     */
    @media (max-width: 700px) {
      dialog {
        margin: calc(var(--visible-top, 0px) + 16px) auto auto;
        max-height: calc(var(--visible-height, 100dvh) - 32px);
      }
    }
  `,
})
export class Modal {
  readonly heading = input.required<string>();
  /** Widest it gets, in pixels; it narrows on small screens. */
  readonly width = input(440);
  readonly open = model(false);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      if (this.open() && !dialog.open) {
        dialog.showModal();
        this.fitToVisibleArea();
      } else if (!this.open()) dialog.close();
    });
    // The keyboard opening or closing, or the page scrolling under it, changes the visible area.
    window.visualViewport?.addEventListener('resize', this.fitToVisibleArea);
    window.visualViewport?.addEventListener('scroll', this.fitToVisibleArea);
    inject(DestroyRef).onDestroy(() => {
      window.visualViewport?.removeEventListener('resize', this.fitToVisibleArea);
      window.visualViewport?.removeEventListener('scroll', this.fitToVisibleArea);
    });
  }

  /**
   * Tells the CSS where the visible part of the screen is. An on-screen keyboard shrinks only the visual viewport, so a
   * dialog sized to the whole screen would end behind the keyboard, hiding its buttons.
   */
  private readonly fitToVisibleArea = (): void => {
    const viewport = window.visualViewport;
    const dialog = this.dialog().nativeElement;
    if (!viewport || !dialog.open) return;
    dialog.style.setProperty('--visible-height', `${viewport.height}px`);
    dialog.style.setProperty('--visible-top', `${viewport.offsetTop}px`);
  };

  /** The dialog has no padding, so a click whose target is the dialog itself landed on the backdrop. */
  protected closeOnBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.open.set(false);
  }
}
