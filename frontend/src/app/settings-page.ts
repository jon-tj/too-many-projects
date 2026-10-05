import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { Account } from './models';
import { WorkspaceApi } from './workspace-api';

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
  private readonly http = inject(HttpClient);
  protected readonly form = this.formBuilder.nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
  });

  constructor(private readonly api: WorkspaceApi) {}

  ngOnInit(): void {
    this.api.currentAccount().subscribe({ next: (account) => this.account.set(account) });
  }

  protected changePassword(): void {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.message.set('');
    this.error.set('');
    this.http.post('/api/auth/changePassword', this.form.getRawValue()).subscribe({
      next: () => {
        this.form.reset({ currentPassword: '', newPassword: '' });
        this.message.set('Password updated.');
        this.busy.set(false);
      },
      error: (response: HttpErrorResponse) => {
        const details = response.error?.errors as Record<string, string[]> | undefined;
        this.error.set(details ? Object.values(details).flat().join(' ') : 'Could not update the password. Check your current password and try again.');
        this.busy.set(false);
      },
    });
  }
}