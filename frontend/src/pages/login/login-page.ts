import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-login-page',
  imports: [ReactiveFormsModule],
  templateUrl: './login-page.html',
  styleUrl: './login-page.css',
})
export class LoginPage {
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly formBuilder = inject(FormBuilder);
  protected readonly form = this.formBuilder.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
    remember: [false],
  });

  constructor(
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {
    if (this.auth.isAuthenticated()) void this.router.navigateByUrl('/');
  }

  protected submit(): void {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    const { username, password, remember } = this.form.getRawValue();
    this.auth.login(username.trim(), password, remember).subscribe({
      next: () => void this.router.navigateByUrl('/'),
      error: (error: HttpErrorResponse) => {
        this.error.set(error.status === 401
          ? 'That username and password do not match.'
          : 'The workspace could not be reached. Check that the API is running.');
        this.busy.set(false);
      },
    });
  }
}