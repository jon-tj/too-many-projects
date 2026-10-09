import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { utmParams } from '../../../services/attribution';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-sign-in-form',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './sign-in-form.html',
  styleUrl: './sign-in-form.css',
})
export class SignInForm {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** Carried on to the sign-up link, so a campaign visitor who looks here first is still attributed. */
  protected readonly utm = utmParams(inject(ActivatedRoute).snapshot.queryParams);
  protected readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
    remember: [false],
  });

  constructor() {
    if (this.auth.isAuthenticated()) void this.router.navigateByUrl('/dashboard');
  }

  protected submit(): void {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const { username, password, remember } = this.form.getRawValue();
    this.auth.login(username.trim(), password, remember).subscribe({
      next: () => void this.router.navigateByUrl('/dashboard'),
      error: (error: HttpErrorResponse) => {
        this.error.set(error.status === 401
          ? 'That username and password do not match.'
          : 'The workspace could not be reached. Check that the API is running.');
        this.busy.set(false);
      },
    });
  }
}
