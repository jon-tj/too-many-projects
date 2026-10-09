import { HttpClient } from '@angular/common/http';
import { Injectable, computed, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, finalize, map, shareReplay, switchMap, tap, throwError } from 'rxjs';
import { Attribution } from './attribution';

interface TokenResponse { accessToken: string; expiresIn: number; refreshToken: string; tokenType: string; }

/** The sign-up form's answers. */
export interface SignupDetails {
  displayName: string;
  userName: string;
  email: string;
  password: string;
  primaryUseCase: string;
  teamRole: string;
}

const ACCESS_TOKEN = 'workspace_access_token';
const REFRESH_TOKEN = 'workspace_refresh_token';

/**
 * Bearer tokens from the Identity API. "Remember me" keeps them in localStorage so they survive closing
 * the browser; otherwise they live in sessionStorage. Expired access tokens are renewed with the refresh token.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly tokenState = signal(localStorage.getItem(ACCESS_TOKEN) ?? sessionStorage.getItem(ACCESS_TOKEN));
  readonly token = this.tokenState.asReadonly();
  readonly isAuthenticated = computed(() => !!this.tokenState());
  private refreshing: Observable<string> | null = null;
  /** The password from the last sign-in, kept in memory only so a temporary password need not be typed twice. */
  private signInPassword: string | null = null;

  constructor(private readonly http: HttpClient, private readonly router: Router) {}

  login(username: string, password: string, remember: boolean): Observable<TokenResponse> {
    return this.http.post<TokenResponse>('/api/auth/login', { email: username.trim(), password }).pipe(
      tap((result) => {
        this.store(result, remember ? localStorage : sessionStorage);
        this.signInPassword = password;
      }),
    );
  }

  /** Creates the account (starting its trial), then signs in to it and stays signed in. */
  register(details: SignupDetails, attribution: Attribution): Observable<TokenResponse> {
    return this.http
      .post('/api/signup', { ...details, ...attribution })
      .pipe(switchMap(() => this.login(details.userName, details.password, true)));
  }

  /** Returns the password used to sign in, once; null after a reload or when already taken. */
  takeSignInPassword(): string | null {
    const password = this.signInPassword;
    this.signInPassword = null;
    return password;
  }

  /** Swaps the refresh token for new tokens. Concurrent callers share one request. */
  refresh(): Observable<string> {
    const storage = [localStorage, sessionStorage].find((entry) => entry.getItem(REFRESH_TOKEN));
    if (!storage) return throwError(() => new Error('No refresh token.'));

    this.refreshing ??= this.http
      .post<TokenResponse>('/api/auth/refresh', { refreshToken: storage.getItem(REFRESH_TOKEN) })
      .pipe(
        tap((result) => this.store(result, storage)),
        map((result) => result.accessToken),
        finalize(() => (this.refreshing = null)),
        shareReplay(1),
      );
    return this.refreshing;
  }

  /** Changing the password invalidates the refresh token, so this signs in again with the new password. */
  changePassword(userName: string, currentPassword: string, newPassword: string): Observable<TokenResponse> {
    const remember = this.isRemembered();
    return this.http
      .post('/api/account/password', { currentPassword, newPassword })
      .pipe(
        switchMap(() => this.login(userName, newPassword, remember)),
        tap(() => (this.signInPassword = null)),
      );
  }

  /** Changing the username also invalidates the refresh token, so this signs in again with the new name. */
  changeUserName(userName: string, password: string): Observable<TokenResponse> {
    const remember = this.isRemembered();
    return this.http
      .put('/api/account/username', { userName, password })
      .pipe(
        switchMap(() => this.login(userName, password, remember)),
        tap(() => (this.signInPassword = null)),
      );
  }

  /** Whether the current sign-in was made with "Remember me". */
  isRemembered(): boolean {
    return !!localStorage.getItem(REFRESH_TOKEN);
  }

  logout(): void {
    this.signInPassword = null;
    this.clear();
    this.tokenState.set(null);
    void this.router.navigateByUrl('/login');
  }

  private store(result: TokenResponse, storage: Storage): void {
    this.clear();
    storage.setItem(ACCESS_TOKEN, result.accessToken);
    storage.setItem(REFRESH_TOKEN, result.refreshToken);
    this.tokenState.set(result.accessToken);
  }

  private clear(): void {
    for (const storage of [localStorage, sessionStorage]) {
      storage.removeItem(ACCESS_TOKEN);
      storage.removeItem(REFRESH_TOKEN);
    }
  }
}
