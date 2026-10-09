import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { readAttribution, rememberAttribution, utmParams } from '../../../services/attribution';
import { AuthService } from '../../../services/auth.service';

/** Values match the backend's SignupController lists. */
const USE_CASES = [
  { value: 'client-work', label: 'Client work' },
  { value: 'product-development', label: 'Building a product' },
  { value: 'internal-operations', label: 'Internal operations' },
  { value: 'personal', label: 'Personal projects' },
  { value: 'other', label: 'Something else' },
];
const TEAM_ROLES = [
  { value: 'founder', label: 'Founder or owner' },
  { value: 'manager', label: 'Manager or team lead' },
  { value: 'contributor', label: 'Team member' },
  { value: 'freelancer', label: 'Freelancer or consultant' },
  { value: 'other', label: 'Other' },
];

/**
 * Sign-up for the 30-day trial. Remembers the utm_* parameters it was opened with (or that the landing page saw)
 * and sends them along, so we know which links bring people in.
 */
@Component({
  selector: 'app-register-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register-form.html',
  styleUrl: './register-form.css',
})
export class RegisterForm {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly USE_CASES = USE_CASES;
  protected readonly TEAM_ROLES = TEAM_ROLES;
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** Carried on the "Log in" link, so a visitor who goes there and back keeps their campaign. */
  protected readonly utm = utmParams(inject(ActivatedRoute).snapshot.queryParams);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    displayName: ['', [Validators.required, Validators.maxLength(80)]],
    email: ['', [Validators.required, Validators.email]],
    userName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(64)]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    primaryUseCase: ['', Validators.required],
    teamRole: ['', Validators.required],
  });

  constructor() {
    if (this.auth.isAuthenticated()) void this.router.navigateByUrl('/dashboard');
    rememberAttribution(inject(ActivatedRoute).snapshot.queryParams);
  }

  protected submit(): void {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const details = this.form.getRawValue();
    this.auth.register({ ...details, displayName: details.displayName.trim(), userName: details.userName.trim() }, readAttribution()).subscribe({
      next: () => void this.router.navigateByUrl('/dashboard'),
      error: (error: HttpErrorResponse) => {
        this.error.set(error.error?.error ?? 'We could not create your account. Please try again.');
        this.busy.set(false);
      },
    });
  }
}
