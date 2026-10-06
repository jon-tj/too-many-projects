import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { rxResource } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import { WorkspaceApi } from '../../../services/workspace-api';

/** Shown after signing in with a temporary password, before the workspace opens. */
@Component({
  selector: 'app-change-password-form',
  imports: [ReactiveFormsModule],
  templateUrl: './change-password-form.html',
  styleUrl: './change-password-form.css',
})
export class ChangePasswordForm {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly api = inject(WorkspaceApi);
  protected readonly account = rxResource({ stream: () => this.api.currentAccount() });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** Set when arriving straight from sign-in, so the temporary password is not asked for again. */
  protected readonly knowsCurrentPassword: boolean;
  protected readonly form = inject(FormBuilder).nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', Validators.required],
    confirmPassword: ['', Validators.required],
  });

  constructor() {
    const signInPassword = this.auth.takeSignInPassword();
    this.knowsCurrentPassword = signInPassword !== null;
    if (signInPassword !== null) this.form.controls.currentPassword.setValue(signInPassword);
  }

  protected logout(): void {
    this.auth.logout();
  }

  protected submit(): void {
    const account = this.account.value();
    if (!account || this.form.invalid || this.busy()) return;
    const { currentPassword, newPassword, confirmPassword } = this.form.getRawValue();
    if (newPassword !== confirmPassword) {
      this.error.set('The new passwords do not match.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    this.auth.changePassword(account.userName, currentPassword, newPassword).subscribe({
      next: () => void this.router.navigateByUrl('/'),
      error: (response: HttpErrorResponse) => {
        this.error.set(response.error?.error ?? 'Could not update the password. Please try again.');
        this.busy.set(false);
      },
    });
  }
}
