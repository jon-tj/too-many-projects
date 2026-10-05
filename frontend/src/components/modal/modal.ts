import { Component, ElementRef, effect, input, model, viewChild } from '@angular/core';
import { Icon } from '../icon/icon';

/** Native <dialog> wrapper: `<app-modal heading="..." [(open)]="signal">content</app-modal>`. */
@Component({
  selector: 'app-modal',
  imports: [Icon],
  template: `
    <dialog #dialog (close)="open.set(false)" (click)="closeOnBackdrop($event)">
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
  `,
})
export class Modal {
  readonly heading = input.required<string>();
  readonly open = model(false);
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');

  constructor() {
    effect(() => {
      const dialog = this.dialog().nativeElement;
      if (this.open() && !dialog.open) dialog.showModal();
      else if (!this.open()) dialog.close();
    });
  }

  /** The dialog has no padding, so a click whose target is the dialog itself landed on the backdrop. */
  protected closeOnBackdrop(event: MouseEvent): void {
    if (event.target === this.dialog().nativeElement) this.open.set(false);
  }
}
