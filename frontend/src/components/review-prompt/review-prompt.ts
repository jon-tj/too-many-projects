import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ReviewPrompt as Prompt } from '../../services/models';
import { WorkspaceApi } from '../../services/workspace-api';
import { Icon } from '../icon/icon';
import { Modal } from '../modal/modal';

/** How long "Not now" keeps the prompt away, per round, in this browser. */
const SNOOZE_DAYS = 3;
const snoozeKey = (round: number) => `review-snoozed-${round}`;

/**
 * Asks for a review 10, 40 and 150 days after the account was created: stars, a few words, and whether it may be shown
 * on the website (optionally with one of their projects). A review adds days to a running trial. "Not now" asks again in
 * a few days; "No thanks" waits for the next round.
 */
@Component({
  selector: 'app-review-prompt',
  imports: [Modal, Icon, ReactiveFormsModule],
  templateUrl: './review-prompt.html',
  styleUrl: './review-prompt.css',
})
export class ReviewPrompt implements OnInit {
  /** After a review extended the trial, so the plan can be shown again. */
  readonly trialExtended = output<void>();
  private readonly api = inject(WorkspaceApi);
  protected readonly prompt = signal<Prompt | null>(null);
  protected readonly open = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** Set after sending: the thank-you shown instead of the form. */
  protected readonly thanks = signal<string | null>(null);
  protected readonly hovered = signal(0);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    stars: [0, [Validators.min(1), Validators.max(5)]],
    body: ['', [Validators.required, Validators.maxLength(2000)]],
    mayPublish: [false],
    projectName: [''],
  });
  private readonly stars = signal(0);
  /** The stars to light up: the ones under the pointer, else the chosen ones. */
  protected readonly lit = computed(() => this.hovered() || this.stars());
  protected readonly heading = computed(() => {
    const round = this.prompt()?.round;
    return round === 10 ? 'How is it going so far?' : 'How is TooManyProjects working for you?';
  });

  ngOnInit(): void {
    this.api.reviewPrompt().subscribe({
      next: (prompt) => {
        if (!prompt || this.snoozed(prompt.round)) return;
        this.prompt.set(prompt);
        this.open.set(true);
      },
    });
  }

  protected setStars(stars: number): void {
    this.stars.set(stars);
    this.form.controls.stars.setValue(stars);
  }

  protected submit(): void {
    const prompt = this.prompt();
    if (!prompt || this.form.invalid || !this.form.value.body?.trim()) return;
    const { stars, body, mayPublish, projectName } = this.form.getRawValue();
    this.busy.set(true);
    this.error.set('');
    this.api
      .submitReview({ round: prompt.round, stars, body, mayPublish, projectName: mayPublish && projectName ? projectName : null })
      .subscribe({
        next: ({ trialEndsAt }) => {
          this.busy.set(false);
          if (trialEndsAt) {
            const date = new Date(trialEndsAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
            this.thanks.set(`Thank you! Your free trial now runs until ${date}.`);
            this.trialExtended.emit();
          } else {
            this.thanks.set('Thank you! It really helps us make TooManyProjects better.');
          }
        },
        error: (response: HttpErrorResponse) => {
          this.busy.set(false);
          this.error.set(response.error?.error ?? 'Could not send your review. Please try again.');
        },
      });
  }

  /** Closing the dialog any way but "No thanks" (or after sending) asks again in a few days. */
  protected openChange(open: boolean): void {
    this.open.set(open);
    const prompt = this.prompt();
    if (!open && prompt && !this.thanks()) this.snooze(prompt.round);
  }

  protected notNow(): void {
    this.openChange(false);
  }

  protected noThanks(): void {
    const prompt = this.prompt();
    this.open.set(false);
    if (prompt) this.api.dismissReview(prompt.round).subscribe();
  }

  private snoozed(round: number): boolean {
    try {
      const until = Number(localStorage.getItem(snoozeKey(round)));
      return until > Date.now();
    } catch {
      return false;
    }
  }

  private snooze(round: number): void {
    try {
      localStorage.setItem(snoozeKey(round), String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
    } catch {
      // Storage can be unavailable (e.g. private windows); the prompt then comes back on the next visit.
    }
  }
}
