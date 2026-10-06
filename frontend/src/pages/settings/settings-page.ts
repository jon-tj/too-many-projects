import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { Account } from '../../services/models';
import { WorkspaceApi } from '../../services/workspace-api';

@Component({
  selector: 'app-settings-page',
  imports: [ReactiveFormsModule],
  templateUrl: './settings-page.html',
  styleUrl: './settings-page.css',
})
export class SettingsPage implements OnInit {
  protected readonly account = signal<Account | null>(null);
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly error = signal('');
  private readonly formBuilder = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  protected readonly form = this.formBuilder.nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
  });
  protected readonly deleteForm = this.formBuilder.nonNullable.group({
    password: ['', Validators.required],
  });
  protected readonly deleteError = signal('');

  constructor(private readonly api: WorkspaceApi) {}

  ngOnInit(): void {
    this.api.currentAccount().subscribe({ next: (account) => this.account.set(account) });
  }

  protected changePassword(): void {
    const account = this.account();
    if (!account || this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    this.error.set('');
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.auth.changePassword(account.userName, currentPassword, newPassword).subscribe({
      next: () => {
        this.form.reset({ currentPassword: '', newPassword: '' });
        this.message.set('Password updated.');
        this.busy.set(false);
      },
      error: (response: HttpErrorResponse) => {
        this.error.set(response.error?.error ?? 'Could not update the password. Please try again.');
        this.busy.set(false);
      },
    });
  }

  protected deleteAccount(): void {
    if (this.deleteForm.invalid || this.busy()) return;
    if (!confirm('Delete your account permanently? This cannot be undone.')) return;
    this.busy.set(true);
    this.deleteError.set('');
    this.api.deleteAccount(this.deleteForm.getRawValue().password).subscribe({
      next: () => this.auth.logout(),
      error: (response: HttpErrorResponse) => {
        this.deleteError.set(response.error?.error ?? 'Could not delete the account. Please try again.');
        this.busy.set(false);
      },
    });
  }
}
