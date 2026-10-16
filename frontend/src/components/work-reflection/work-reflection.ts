import { Component, effect, input, model, output, signal } from '@angular/core';
import { WorkReflectionValues } from '../../services/models';
import { Modal } from '../modal/modal';
import { MoodFace } from '../mood-face/mood-face';
import { ResistanceWall } from '../resistance-wall/resistance-wall';

/**
 * Asked when finishing work: mood and resistance on 0–10 sliders, each under its picture (a smiley whose mouth bends
 * with the mood, a wall as many bricks tall as the resistance), and an optional message. "Skip" finishes without them;
 * closing the dialog keeps working.
 */
@Component({
  selector: 'app-work-reflection',
  imports: [Modal, MoodFace, ResistanceWall],
  template: `
    <app-modal heading="How did it go?" [(open)]="open">
      <form (submit)="$event.preventDefault(); send()">
        <div class="gauges">
          <label>
            <app-mood-face [mood]="mood()" [size]="104" />
            <span class="caption">Mood <output>{{ mood() }}</output></span>
            <input type="range" min="0" max="10" step="1" [value]="mood()" (input)="mood.set(+$any($event.target).value)" />
          </label>
          <label>
            <app-resistance-wall [resistance]="resistance()" [height]="104" />
            <span class="caption">Resistance <output>{{ resistance() }}</output></span>
            <input type="range" min="0" max="10" step="1" [value]="resistance()" (input)="resistance.set(+$any($event.target).value)" />
          </label>
        </div>
        <label>
          Message (optional)
          <textarea rows="3" maxlength="1000" placeholder="Anything worth remembering about this session?" [value]="message()" (input)="message.set($any($event.target).value)"></textarea>
        </label>
        <footer>
          <button class="primary" type="submit" [disabled]="busy()">{{ busy() ? 'Saving…' : 'Submit' }}</button>
          <button class="transparent" type="button" [disabled]="busy()" (click)="skipped.emit()">Skip</button>
        </footer>
      </form>
    </app-modal>
  `,
  styles: `
    .gauges {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
    }
    .gauges label {
      align-items: center;
      gap: 10px;
    }
    .gauges app-mood-face,
    .gauges app-resistance-wall {
      display: grid;
      height: 112px;
      place-items: end center;
    }
    .caption {
      display: flex;
      gap: 6px;
    }
    output {
      min-width: 2ch;
      color: var(--secondary-surface);
      font-variant-numeric: tabular-nums;
    }
    input[type='range'] {
      width: 100%;
      accent-color: var(--secondary-surface);
    }
  `,
})
export class WorkReflection {
  readonly open = model(false);
  /** While the parent saves; the buttons are disabled. */
  readonly busy = input(false);
  readonly submitted = output<WorkReflectionValues>();
  readonly skipped = output<void>();
  protected readonly mood = signal(5);
  protected readonly resistance = signal(5);
  protected readonly message = signal('');

  constructor() {
    // Each time it opens, it starts from the middle again.
    effect(() => {
      if (!this.open()) return;
      this.mood.set(5);
      this.resistance.set(5);
      this.message.set('');
    });
  }

  protected send(): void {
    const message = this.message().trim();
    this.submitted.emit({ mood: this.mood(), resistance: this.resistance(), message: message || null });
  }
}
