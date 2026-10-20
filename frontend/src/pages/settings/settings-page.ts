import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { rxResource } from '@angular/core/rxjs-interop';
import { ReactiveFormsModule, FormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Avatar } from '../../components/avatar/avatar';
import { WorkspaceShell } from '../../components/workspace-shell/workspace-shell';
import { AuthService } from '../../services/auth.service';
import { Account } from '../../services/models';
import { squareImageDataUrl } from '../../services/square-image';
import { WorkspaceApi } from '../../services/workspace-api';

@Component({
  selector: 'app-settings-page',
  imports: [ReactiveFormsModule, Avatar, RouterLink, DatePipe],
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
  private readonly shell = inject(WorkspaceShell);

  /** The picture chosen but not saved yet: undefined = unchanged, null = remove. */
  protected readonly pendingAvatar = signal<string | null | undefined>(undefined);
  protected readonly avatarMessage = signal('');
  protected readonly emailMessage = signal('');
  /** Personal access tokens, for the command-line tool and scripts. */
  protected readonly tokens = rxResource({ stream: () => this.api.apiTokens() });
  protected readonly tokenName = signal('');
  /** A token just made, shown once so it can be copied. */
  protected readonly newToken = signal<string | null>(null);
  protected readonly tokenCopied = signal(false);
  protected readonly tokenError = signal('');
  protected readonly form = this.formBuilder.nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
  });
  protected readonly deleteForm = this.formBuilder.nonNullable.group({
    password: ['', Validators.required],
  });
  protected readonly deleteError = signal('');
  protected readonly userNameForm = this.formBuilder.nonNullable.group({
    userName: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(64)]],
    password: ['', Validators.required],
  });
  protected readonly userNameMessage = signal('');

  constructor(private readonly api: WorkspaceApi) {}

  protected createToken(): void {
    const name = this.tokenName().trim();
    if (!name) return;
    this.tokenError.set('');
    this.api.createApiToken(name).subscribe({
      next: ({ token }) => {
        this.newToken.set(token);
        this.tokenCopied.set(false);
        this.tokenName.set('');
        this.tokens.reload();
      },
      error: (response: HttpErrorResponse) => this.tokenError.set(response.error?.error ?? 'Could not create the token.'),
    });
  }

  protected copyToken(): void {
    const token = this.newToken();
    if (token) void navigator.clipboard.writeText(token).then(() => this.tokenCopied.set(true));
  }

  protected revokeToken(id: number, name: string): void {
    if (!confirm(`Revoke "${name}"? Anything using it stops working at once.`)) return;
    this.api.revokeApiToken(id).subscribe({
      next: () => this.tokens.reload(),
      error: () => this.tokenError.set('Could not revoke the token.'),
    });
  }

  /** Saves straight away, as the checkbox shows; switches it back if saving fails. */
  protected setWeeklySummary(weeklySummary: boolean): void {
    this.account.update((account) => (account ? { ...account, weeklySummary } : account));
    this.api.setEmailPreferences(weeklySummary).subscribe({
      next: () => this.emailMessage.set(weeklySummary ? 'You will get the weekly summary.' : 'Weekly summary turned off.'),
      error: () => {
        this.account.update((account) => (account ? { ...account, weeklySummary: !weeklySummary } : account));
        this.emailMessage.set('Could not save. Please try again.');
      },
    });
  }

  ngOnInit(): void {
    this.api.currentAccount().subscribe({
      next: (account) => {
        this.account.set(account);
        this.userNameForm.reset({ userName: account.userName, password: '' });
      },
    });
  }

  protected changeUserName(): void {
    if (this.userNameForm.invalid || this.busy()) return;
    const userName = this.userNameForm.getRawValue().userName.trim();
    this.busy.set(true);
    this.userNameMessage.set('');
    this.auth.changeUserName(userName, this.userNameForm.getRawValue().password).subscribe({
      next: () => {
        this.account.update((account) => (account ? { ...account, userName } : account));
        this.userNameForm.reset({ userName, password: '' });
        this.userNameMessage.set('Username updated. Use it the next time you sign in.');
        this.shell.refreshAccount();
        this.busy.set(false);
      },
      error: (response: HttpErrorResponse) => {
        this.userNameMessage.set(response.error?.error ?? 'Could not change the username. Please try again.');
        this.busy.set(false);
      },
    });
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

  /** The picture to show: the unsaved choice if there is one, otherwise the saved picture. */
  protected avatarPreview(): string | null {
    const pending = this.pendingAvatar();
    return pending === undefined ? (this.account()?.avatarImage ?? null) : pending;
  }

  /** Small square WebP keeps the picture a few kilobytes; it travels with canvas presence updates. */
  protected async chooseAvatar(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.pendingAvatar.set(await squareImageDataUrl(file, 96, 'image/webp', 0.85));
      this.avatarMessage.set('');
    } catch {
      this.avatarMessage.set('That file could not be read as an image.');
    }
  }

  protected saveAvatar(): void {
    const image = this.pendingAvatar();
    if (image === undefined) return;
    this.api.setAvatar(image).subscribe({
      next: () => {
        this.account.update((account) => (account ? { ...account, avatarImage: image } : account));
        this.pendingAvatar.set(undefined);
        this.avatarMessage.set('Profile picture saved.');
        this.shell.refreshAccount();
      },
      error: () => this.avatarMessage.set('Could not save the picture. Please try again.'),
    });
  }
}
