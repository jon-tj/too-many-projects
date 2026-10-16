import { HttpErrorResponse } from '@angular/common/http';
import { Component, effect, inject, model, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { WorkspaceApi } from '../../services/workspace-api';
import { Icon } from '../icon/icon';
import { Modal } from '../modal/modal';

/** A dialog for asking for a feature: a short title and optional details, sent to the admin. */
@Component({
  selector: 'app-feature-request',
  imports: [Modal, Icon, ReactiveFormsModule],
  template: `
    <app-modal [heading]="sent() ? 'Thank you' : 'Suggest a feature'" [(open)]="open">
      @if (sent()) {
        <div class="thanks">
          <app-icon name="lightbulb" [size]="28" />
          <p>Got it! We read every request, and it helps us decide what to build next.</p>
          <footer>
            <button class="primary" type="button" (click)="open.set(false)">Close</button>
          </footer>
        </div>
      } @else {
        <form [formGroup]="form" (ngSubmit)="send()">
          <p class="intro">Missing something, or have an idea that would make your work easier? Tell us.</p>
          <label>
            What would you like?
            <input
              formControlName="title"
              maxlength="120"
              placeholder="e.g. Recurring tasks"
              (keydown.control.enter)="submitFromKeyboard($event)"
              (keydown.meta.enter)="submitFromKeyboard($event)"
            />
          </label>
          <label>
            Details (optional)
            <textarea
              formControlName="description"
              rows="5"
              maxlength="2000"
              placeholder="What would it help you do? How do you work around it today?"
              (keydown.control.enter)="submitFromKeyboard($event)"
              (keydown.meta.enter)="submitFromKeyboard($event)"
            ></textarea>
          </label>
          @if (error()) {
            <p class="error" role="alert">{{ error() }}</p>
          }
          <footer>
            <button class="primary" type="submit" [disabled]="form.invalid || busy()">{{ busy() ? 'Sending…' : 'Send' }}</button>
            <button class="transparent" type="button" (click)="open.set(false)">Cancel</button>
          </footer>
        </form>
      }
    </app-modal>
  `,
  styles: `
    p {
      margin: 0;
    }
    .intro {
      font-size: 13px;
      line-height: 1.5;
    }
    .error {
      color: var(--priority-critical);
      font-size: 12px;
    }
    .thanks {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      text-align: center;
      font-size: 14px;
      line-height: 1.5;
    }
    .thanks app-icon {
      color: var(--doing);
      font-variation-settings: 'FILL' 1;
    }
  `,
})
export class FeatureRequest {
  readonly open = model(false);
  private readonly api = inject(WorkspaceApi);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    title: ['', [Validators.required, Validators.maxLength(120), Validators.pattern(/\S/)]],
    description: ['', Validators.maxLength(2000)],
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly sent = signal(false);

  constructor() {
    // Each time it opens, it starts empty.
    effect(() => {
      if (!this.open()) return;
      this.form.reset();
      this.error.set('');
      this.sent.set(false);
    });
  }

  /** Ctrl+Enter (⌘+Enter on a Mac) sends, like the Send button. */
  protected submitFromKeyboard(event: Event): void {
    event.preventDefault();
    (event.target as HTMLElement).closest('form')?.requestSubmit();
  }

  protected send(): void {
    if (this.form.invalid || this.busy()) return;
    const { title, description } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set('');
    this.api.requestFeature(title.trim(), description.trim()).subscribe({
      next: () => {
        this.busy.set(false);
        this.sent.set(true);
      },
      error: (response: HttpErrorResponse) => {
        this.busy.set(false);
        this.error.set(response.error?.error ?? 'Could not send your request. Please try again.');
      },
    });
  }
}
